import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import helmet from 'helmet'
import request from 'supertest'

const mockPrisma = vi.hoisted(() => ({ story: { findFirst: vi.fn() } }))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
// A limiter that refuses everything: whatever passes it was never rate-limited.
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
  searchLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { storyImageRouter, storyPageRouter } = await import('./storyPreview.js')
const { default: publicRouter } = await import('./index.js')
const { _resetStoryPreviewCaches } = await import('../../services/storyPreview.js')
const { config } = await import('../../config.js')
const { IPTC_TRAINED_ALGORITHMIC_MEDIA } = await import('../../lib/aiProvenance.js')

// helmet() as app.ts applies it, so the test sees the headers the route must remove
const app = express()
  .use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] } } }))
  .use('/api/stories', storyImageRouter)
  .use('/api/story-page', storyPageRouter)
const viaPublicApi = express().use('/api', publicRouter)

/** A prerendered index.html, shaped like the client build's (Helmet-owned tags marked data-rh). */
const SHELL = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8" />
    <meta name="author" content="Actually Relevant" />
    <meta name="fediverse:creator" content="@actuallyrelevant@mastodon.social" />
    <title>Actually Relevant - News That Matters to Humanity</title>
    <meta data-rh="true" name="description" content="Homepage description" />
    <meta data-rh="true" property="og:title" content="Homepage" />
    <meta data-rh="true" property="og:image" content="https://actuallyrelevant.news/images/og-image.png" />
    <meta data-rh="true" name="twitter:image" content="https://actuallyrelevant.news/images/og-image.png" />
    <link data-rh="true" rel="canonical" href="https://actuallyrelevant.news/" />
    <script data-rh="true" type="application/ld+json">{"@type":"WebSite"}</script>
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  </head><body><div id="root"><main>Homepage</main></div></body></html>`

const STORY = {
  slug: 'clean-air',
  title: 'Cities cut "smog" <fast>',
  titleLabel: 'Air & Health',
  sourceTitle: 'Original title',
  summary: 'A summary that is AI-written.',
  datePublished: new Date('2026-10-12T07:30:00Z'),
  sourceDatePublished: new Date('2026-10-11T07:30:00Z'),
  issue: { name: 'Planet & Climate' },
  feed: { title: 'Nation Feed', displayTitle: 'Nation', issue: null },
}

const fetchMock = vi.fn()

function shellResponse(html = SHELL, status = 200, headers: Record<string, string> = { etag: '"v1"' }) {
  return new Response(status === 304 ? null : html, { status, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetStoryPreviewCaches()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(shellResponse())
  mockPrisma.story.findFirst.mockResolvedValue(STORY)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/stories/:slug/og.png', () => {
  it('returns a 1200x630 AI-marked PNG for a published story, cached in memory and over HTTP', async () => {
    const res = await request(app).get('/api/stories/clean-air/og.png').buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.storyPreview.imageCacheSeconds}`)
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    const png = res.body as Buffer
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(png.includes(`DigitalSourceType="${IPTC_TRAINED_ALGORITHMIC_MEDIA}"`)).toBe(true)

    await request(app).get('/api/stories/clean-air/og.png')
    expect(mockPrisma.story.findFirst).toHaveBeenCalledOnce()
  })

  it('looks up published stories only, and 404s otherwise', async () => {
    mockPrisma.story.findFirst.mockResolvedValue(null)
    const res = await request(app).get('/api/stories/draft-story/og.png')
    expect(res.status).toBe(404)
    expect(mockPrisma.story.findFirst.mock.calls[0][0].where).toEqual({ slug: 'draft-story', status: 'published' })
  })

  it('stays behind the shared rate limiter', async () => {
    expect((await request(viaPublicApi).get('/api/stories/clean-air/og.png')).status).toBe(429)
  })
})

describe('GET /api/story-page/:slug', () => {
  it("injects the story's escaped title, description, canonical, og and twitter tags into the shell", async () => {
    const res = await request(app).get('/api/story-page/clean-air')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    const html = res.text
    const title = 'Air &amp; Health: Cities cut &quot;smog&quot; &lt;fast&gt;'
    expect(html).toContain(`<title>${title} - Actually Relevant</title>`)
    expect(html).toContain(`<meta data-rh="true" property="og:title" content="${title}" />`)
    expect(html).toContain('<meta data-rh="true" name="description" content="A summary that is AI-written." />')
    expect(html).toContain('<link data-rh="true" rel="canonical" href="https://actuallyrelevant.news/stories/clean-air" />')
    expect(html).toContain('<meta data-rh="true" property="og:url" content="https://actuallyrelevant.news/stories/clean-air" />')
    expect(html).toContain(`<meta data-rh="true" property="og:image" content="${config.apiUrl}/api/stories/clean-air/og.png" />`)
    expect(html).toContain(`<meta data-rh="true" name="twitter:image" content="${config.apiUrl}/api/stories/clean-air/og.png" />`)
    expect(html).toContain('<meta data-rh="true" property="og:type" content="article" />')
    expect(html).toContain('<meta data-rh="true" name="twitter:card" content="summary_large_image" />')
    // The homepage's own tags are gone, so each tag appears once
    expect(html).not.toContain('Homepage description')
    expect(html).not.toContain('og-image.png')
    expect(html).not.toContain('"@type":"WebSite"')
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.match(/property="og:image"/g)).toHaveLength(1)
    // Everything else in the shell is kept: the app's script, the author meta and the body
    expect(html).toContain('<script type="module" crossorigin src="/assets/index-abc123.js"></script>')
    expect(html).toContain('<meta name="author" content="Actually Relevant" />')
    // The Mastodon byline is the shell's, so story pages keep it
    expect(html).toContain('<meta name="fediverse:creator" content="@actuallyrelevant@mastodon.social" />')
    expect(html).toContain('<div id="root"><main>Homepage</main></div>')
  })

  it("drops the API's security policy, which would block the site's own scripts", async () => {
    const res = await request(app).get('/api/story-page/clean-air')
    expect(res.headers['content-security-policy']).toBeUndefined()
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.storyPreview.pageCacheSeconds}`)
  })

  it('returns the unmodified shell with 200 for a story that is not published', async () => {
    mockPrisma.story.findFirst.mockResolvedValue(null)
    const res = await request(app).get('/api/story-page/missing')
    expect(res.status).toBe(200)
    expect(res.text).toBe(SHELL)
  })

  it('returns the unmodified shell when the database fails', async () => {
    mockPrisma.story.findFirst.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/story-page/clean-air')
    expect(res.status).toBe(200)
    expect(res.text).toBe(SHELL)
  })

  it("returns the shell for any deeper path, never the API's JSON 404", async () => {
    const res = await request(app).get('/api/story-page/')
    expect(res.status).toBe(200)
    expect(res.text).toBe(SHELL)
  })

  it('fetches the shell from the static site once and reuses it', async () => {
    await request(app).get('/api/story-page/clean-air')
    await request(app).get('/api/story-page/other')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(config.storyPreview.shellUrl)
  })

  it('keeps serving the last good shell when a revalidation fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await request(app).get('/api/story-page/missing')
      vi.setSystemTime(Date.now() + (config.storyPreview.shellCacheSeconds + 1) * 1000)
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
      mockPrisma.story.findFirst.mockResolvedValue(null)
      const res = await request(app).get('/api/story-page/missing')
      expect(res.status).toBe(200)
      expect(res.text).toBe(SHELL)
    } finally {
      vi.useRealTimers()
    }
  })

  it("revalidates with the shell's ETag and keeps it on 304", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await request(app).get('/api/story-page/missing')
      vi.setSystemTime(Date.now() + (config.storyPreview.shellCacheSeconds + 1) * 1000)
      fetchMock.mockResolvedValue(shellResponse('', 304))
      mockPrisma.story.findFirst.mockResolvedValue(null)
      const res = await request(app).get('/api/story-page/missing')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"')
      expect(res.text).toBe(SHELL)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to serve something that is not the client shell', async () => {
    fetchMock.mockResolvedValue(shellResponse('<html><body>Error page</body></html>'))
    const res = await request(app).get('/api/story-page/clean-air')
    expect(res.status).toBe(503)
  })

  it('is mounted before the shared rate limiter', async () => {
    expect((await request(viaPublicApi).get('/api/story-page/clean-air')).status).toBe(200)
  })
})
