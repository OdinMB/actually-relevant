import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockPublish = vi.hoisted(() => ({ getPublishedEpisodes: vi.fn(), getPublishedEpisode: vi.fn() }))
// Actually Uplifting is closed unless a test opens it; the main show is always open.
const uplifting = vi.hoisted(() => ({ open: false }))
// A limiter that refuses everything: whatever passes it was never rate-limited.
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
}))
vi.mock('../../services/podcastPublish.js', () => mockPublish)
vi.mock('../../services/podcastEdition.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/podcastEdition.js')>()),
  isEditionOpen: (edition: string) => edition === 'full' || uplifting.open,
}))

const { default: publicRouter } = await import('./index.js')
const { default: podcastRouter } = await import('./podcast.js')
const { invalidateFeedCache } = await import('../../services/podcastFeed.js')
const { PODCAST_EPISODE_AI_LINE } = await import('../../lib/aiLabelCopy.js')

const viaPublicApi = express().use('/api', publicRouter)
const podcastOnly = express().use('/api/podcast', podcastRouter)

const EPISODE = {
  id: 'podcast-1',
  title: 'W42: Clean air',
  summary: 'Two stories.',
  stories: [{ ref: 1, id: 's1', title: 'Air', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air', issue: 'Planet' }],
  kind: 'weekly' as const,
  edition: 'full' as const,
  humanEdited: false,
  audioUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3',
  audioBytes: 123456,
  durationSec: 360,
  transcriptUrl: null,
  chaptersUrl: null,
  publishedAt: new Date('2026-10-12T07:30:00Z'),
}
const UPLIFTING_EPISODE = { ...EPISODE, id: 'podcast-u1', title: 'W42: Good news', edition: 'uplifting' as const }

beforeEach(() => {
  vi.clearAllMocks()
  invalidateFeedCache()
  uplifting.open = false
  mockPublish.getPublishedEpisodes.mockImplementation(async (edition: string) => (edition === 'uplifting' ? [UPLIFTING_EPISODE] : [EPISODE]))
})

async function routerWithoutLimiter() {
  vi.resetModules()
  vi.doMock('../../middleware/rateLimit.js', () => ({ apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))
  vi.doMock('../../services/podcastPublish.js', () => mockPublish)
  const { default: router } = await import('./podcast.js')
  return express().use('/api/podcast', router)
}

describe('GET /api/podcast/feed.xml', () => {
  it("serves RSS with the story feed's caching headers", async () => {
    const res = await request(podcastOnly).get('/api/podcast/feed.xml')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/rss+xml; charset=utf-8')
    expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/)
    expect(res.text).toContain('<guid isPermaLink="false">podcast-1</guid>')
  })

  it('compresses the feed and answers a revalidation with 304', async () => {
    const res = await request(podcastOnly).get('/api/podcast/feed.xml').set('Accept-Encoding', 'gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['content-length']).toBeDefined()
    expect(res.headers['last-modified']).toBeDefined()
    const again = await request(podcastOnly).get('/api/podcast/feed.xml').set('Accept-Encoding', 'gzip').set('If-None-Match', res.headers['etag'])
    expect(again.status).toBe(304)
  })

  it('is mounted before the shared API rate limiter', async () => {
    const res = await request(viaPublicApi).get('/api/podcast/feed.xml')
    expect(res.status).toBe(200)
    // The limiter still guards the rest of the public API.
    expect((await request(viaPublicApi).get('/api/stories')).status).toBe(429)
  })

  it('serves the cached document without reading the database again', async () => {
    await request(podcastOnly).get('/api/podcast/feed.xml')
    await request(podcastOnly).get('/api/podcast/feed.xml')
    expect(mockPublish.getPublishedEpisodes).toHaveBeenCalledOnce()
  })

  it("lists the main show's episodes only", async () => {
    const res = await request(podcastOnly).get('/api/podcast/feed.xml')
    expect(mockPublish.getPublishedEpisodes).toHaveBeenCalledWith('full')
    expect(res.text).not.toContain('podcast-u1')
  })
})

describe('GET /api/podcast/uplifting/feed.xml', () => {
  it('answers 404 while Actually Uplifting is closed, reading no episode', async () => {
    const res = await request(podcastOnly).get('/api/podcast/uplifting/feed.xml')
    expect(res.status).toBe(404)
    expect(mockPublish.getPublishedEpisodes).not.toHaveBeenCalled()
  })

  it("serves the show's own feed once open, before the shared rate limiter", async () => {
    uplifting.open = true
    const res = await request(viaPublicApi).get('/api/podcast/uplifting/feed.xml')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/rss+xml; charset=utf-8')
    expect(res.text).toContain('<title>Actually Uplifting</title>')
    expect(res.text).toContain('<guid isPermaLink="false">podcast-u1</guid>')
    expect(res.text).not.toContain('<guid isPermaLink="false">podcast-1</guid>')
    expect(mockPublish.getPublishedEpisodes).toHaveBeenCalledWith('uplifting')
  })
})

describe('GET /api/podcast', () => {
  it('keeps the shared rate limiter on the JSON route', async () => {
    expect((await request(podcastOnly).get('/api/podcast')).status).toBe(429)
  })

  it('returns the show and its published episodes with their AI line and machine-readable marker', async () => {
    const res = await request(await routerWithoutLimiter()).get('/api/podcast')
    expect(res.status).toBe(200)
    expect(res.body.show.feedUrl).toMatch(/\/podcast\.xml$/)
    expect(res.body.episodes).toHaveLength(1)
    expect(res.body.episodes[0]).toMatchObject({
      id: 'podcast-1',
      edition: 'full',
      aiLine: PODCAST_EPISODE_AI_LINE,
      audioUrl: EPISODE.audioUrl,
      publishedAt: '2026-10-12T07:30:00.000Z',
      aiGenerated: { fields: ['title', 'summary', 'audioUrl', 'transcriptUrl'] },
    })
    expect(res.body.episodes[0].stories[0]).toEqual({ title: 'Air', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air' })
  })

  it("lists only the main show's episodes without a parameter, and says whether Actually Uplifting is public", async () => {
    const app = await routerWithoutLimiter()
    const closed = await request(app).get('/api/podcast')
    expect(mockPublish.getPublishedEpisodes).toHaveBeenCalledWith('full')
    expect(closed.body.upliftingShowOpen).toBe(false)
    uplifting.open = true
    expect((await request(app).get('/api/podcast')).body.upliftingShowOpen).toBe(true)
  })

  it('answers 404 for Actually Uplifting while it is closed', async () => {
    const res = await request(await routerWithoutLimiter()).get('/api/podcast?edition=uplifting')
    expect(res.status).toBe(404)
    expect(mockPublish.getPublishedEpisodes).not.toHaveBeenCalled()
  })

  it("returns Actually Uplifting's show and episodes once it is open", async () => {
    uplifting.open = true
    const res = await request(await routerWithoutLimiter()).get('/api/podcast?edition=uplifting')
    expect(res.status).toBe(200)
    expect(res.body.show).toMatchObject({ title: 'Actually Uplifting' })
    expect(res.body.show.feedUrl).toMatch(/\/podcast-uplifting\.xml$/)
    expect(res.body.episodes.map((e: { id: string; edition: string }) => [e.id, e.edition])).toEqual([['podcast-u1', 'uplifting']])
    expect(res.body.upliftingShowOpen).toBe(true)
  })

  it('answers 400 for an unknown show', async () => {
    const res = await request(await routerWithoutLimiter()).get('/api/podcast?edition=sports')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/podcast/episodes/:id', () => {
  const DIALOGUE = {
    episodeTitle: 'Clean air',
    episodeSummary: 'Two stories.',
    segments: [
      { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome.' }] },
      { kind: 'story', storyRef: 1, turns: [{ speaker: 'HOST_B', text: '[thoughtful] Air data.' }] },
      { kind: 'outro', storyRef: null, turns: [{ speaker: 'HOST_B', text: 'Bye.' }] },
    ],
  }

  it('keeps the shared rate limiter on the episode route', async () => {
    expect((await request(podcastOnly).get('/api/podcast/episodes/podcast-1')).status).toBe(429)
  })

  it('answers 404 for an episode that is not published', async () => {
    mockPublish.getPublishedEpisode.mockResolvedValue(null)
    const res = await request(await routerWithoutLimiter()).get('/api/podcast/episodes/podcast-2')
    expect(res.status).toBe(404)
    expect(mockPublish.getPublishedEpisode).toHaveBeenCalledWith('podcast-2')
  })

  it('returns only the public fields, the readable transcript and a marker that names the transcript', async () => {
    // Internal fields the service might carry must never reach the response.
    mockPublish.getPublishedEpisode.mockResolvedValue({ ...EPISODE, dialogue: DIALOGUE, lastError: 'boom', leaseOwner: 'proc-1' })
    const res = await request(await routerWithoutLimiter()).get('/api/podcast/episodes/podcast-1')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual([
      'aiGenerated',
      'aiLine',
      'audioBytes',
      'audioUrl',
      'durationSec',
      'edition',
      'id',
      'publishedAt',
      'stories',
      'summary',
      'title',
      'transcript',
      'transcriptUrl',
    ])
    expect(res.body.aiGenerated.fields).toContain('transcript')
    expect(res.body.transcript[2]).toEqual({
      story: { title: 'Air', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air' },
      turns: [{ speaker: 'Host B', text: 'Air data.' }],
    })
  })
})
