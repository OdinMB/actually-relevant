import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockPublish = vi.hoisted(() => ({ getPublishedEpisodes: vi.fn() }))
// A limiter that refuses everything: whatever passes it was never rate-limited.
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
}))
vi.mock('../../services/podcastPublish.js', () => mockPublish)

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
  humanEdited: false,
  audioUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3',
  audioBytes: 123456,
  durationSec: 360,
  transcriptUrl: null,
  publishedAt: new Date('2026-10-12T07:30:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateFeedCache()
  mockPublish.getPublishedEpisodes.mockResolvedValue([EPISODE])
})

describe('GET /api/podcast/feed.xml', () => {
  it('serves RSS with the story feed\'s caching headers', async () => {
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
    const again = await request(podcastOnly).get('/api/podcast/feed.xml')
      .set('Accept-Encoding', 'gzip').set('If-None-Match', res.headers['etag'])
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
})

describe('GET /api/podcast', () => {
  it('keeps the shared rate limiter on the JSON route', async () => {
    expect((await request(podcastOnly).get('/api/podcast')).status).toBe(429)
  })

  it('returns the show and its published episodes with their AI line and machine-readable marker', async () => {
    vi.resetModules()
    vi.doMock('../../middleware/rateLimit.js', () => ({ apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))
    vi.doMock('../../services/podcastPublish.js', () => mockPublish)
    const { default: router } = await import('./podcast.js')
    const res = await request(express().use('/api/podcast', router)).get('/api/podcast')
    expect(res.status).toBe(200)
    expect(res.body.show.feedUrl).toMatch(/\/podcast\.xml$/)
    expect(res.body.episodes).toHaveLength(1)
    expect(res.body.episodes[0]).toMatchObject({
      id: 'podcast-1',
      aiLine: PODCAST_EPISODE_AI_LINE,
      audioUrl: EPISODE.audioUrl,
      publishedAt: '2026-10-12T07:30:00.000Z',
      aiGenerated: { fields: ['title', 'summary', 'audioUrl', 'transcriptUrl'] },
    })
    expect(res.body.episodes[0].stories[0]).toEqual({ title: 'Air', publisher: 'Nation', sourceUrl: 'https://news.example/1', slug: 'air' })
  })
})
