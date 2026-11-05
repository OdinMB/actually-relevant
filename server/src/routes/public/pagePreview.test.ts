import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import helmet from 'helmet'
import request from 'supertest'

const mockPrisma = vi.hoisted(() => ({
  story: { findFirst: vi.fn(), findMany: vi.fn() },
  newsletter: { findFirst: vi.fn() },
  podcast: { findFirst: vi.fn() },
  issue: { findFirst: vi.fn() },
}))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
// A limiter that refuses everything: whatever passes it was never rate-limited.
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
  searchLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { storyPageRouter } = await import('./storyPreview.js')
const { pagePreviewRouter } = await import('./pagePreview.js')
const { default: publicRouter } = await import('./index.js')
const { _resetStoryPreviewCaches } = await import('../../services/storyPreview.js')
const { previewTargetOf } = await import('../../services/pagePreviews.js')
const { PAGE_PREVIEW_MOUNT } = await import('../../lib/linkPreviewPaths.js')
const { config } = await import('../../config.js')

// helmet() as app.ts applies it, so the test sees the headers the route must remove
const app = express()
  .use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] } } }))
  .use('/api/story-page', storyPageRouter)
  .use('/api/page', pagePreviewRouter)
const viaPublicApi = express().use('/api', publicRouter)

/** A prerendered index.html, shaped like the client build's (Helmet-owned tags marked data-rh). */
const SHELL = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8" />
    <meta name="author" content="Actually Relevant" />
    <title>Actually Relevant - News That Matters to Humanity</title>
    <meta data-rh="true" name="description" content="Homepage description" />
    <meta data-rh="true" property="og:title" content="Homepage" />
    <meta data-rh="true" property="og:image" content="https://actuallyrelevant.news/images/og-image.png" />
    <link data-rh="true" rel="canonical" href="https://actuallyrelevant.news/" />
    <script data-rh="true" type="application/ld+json">{"@type":"WebSite"}</script>
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  </head><body><div id="root"><main>Homepage</main></div></body></html>`

/** The shell with the homepage's own tags removed and `tags` in their place, as the route writes it. */
function shellWith(tags: string[]): string {
  return [
    '<!DOCTYPE html><html lang="en"><head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="author" content="Actually Relevant" />',
    '    <script type="module" crossorigin src="/assets/index-abc123.js"></script>',
    `    ${tags.join('\n    ')}`,
    '  </head><body><div id="root"><main>Homepage</main></div></body></html>',
  ].join('\n')
}

const meta = (attr: 'name' | 'property', key: string, content: string) => `<meta data-rh="true" ${attr}="${key}" content="${content}" />`
const NEWSLETTER_IMAGE = `${config.apiUrl}/api/section-images/newsletter.png`
const NEWSLETTER_AI_IMAGE = `${config.apiUrl}/api/section-images/newsletter-issue.png`
const PODCAST_IMAGE = `${config.apiUrl}/api/section-images/podcast.png`

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

/** An issue's stored markdown: three marked story headings, in the email's order. */
const ISSUE_CONTENT = [
  '# Planet & Climate {planet-climate}',
  '',
  '## Cities cut smog {story:s1}',
  '{feed:f1} Nation · [original article](https://news.example/1)',
  '',
  '## Rivers & lakes <recover> {story:s2}',
  '',
  '## A story nobody rated {story:s3}',
].join('\n')

const ISSUE = {
  slug: 'week-43-2026',
  title: 'Week 43, 2026',
  content: ISSUE_CONTENT,
  publishedAt: new Date('2026-10-25T09:00:00Z'),
  createdAt: new Date('2026-10-24T09:00:00Z'),
}

const ISSUE_STORIES = [
  { id: 's1', slug: 'clean-air', relevance: 6 },
  { id: 's2', slug: 'rivers', relevance: 9 },
  { id: 's3', slug: 'unrated', relevance: null },
]

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  _resetStoryPreviewCaches()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => new Response(SHELL, { status: 200, headers: { etag: '"v1"' } }))
  mockPrisma.story.findFirst.mockResolvedValue(STORY)
  mockPrisma.story.findMany.mockResolvedValue(ISSUE_STORIES)
  mockPrisma.newsletter.findFirst.mockResolvedValue(ISSUE)
  mockPrisma.podcast.findFirst.mockResolvedValue(null)
  mockPrisma.issue.findFirst.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('story pages', () => {
  it('serves the story page byte for byte as before the shared link-preview module', async () => {
    const title = 'Air &amp; Health: Cities cut &quot;smog&quot; &lt;fast&gt;'
    const image = `${config.apiUrl}/api/stories/clean-air/og.png`
    const url = `${config.siteUrl}/stories/clean-air`
    const res = await request(app).get('/api/story-page/clean-air')
    expect(res.status).toBe(200)
    expect(res.text).toBe(
      shellWith([
        `<title>${title} - Actually Relevant</title>`,
        '<meta data-rh="true" name="description" content="A summary that is AI-written." />',
        `<link data-rh="true" rel="canonical" href="${url}" />`,
        '<meta data-rh="true" property="og:type" content="article" />',
        '<meta data-rh="true" property="og:site_name" content="Actually Relevant" />',
        `<meta data-rh="true" property="og:title" content="${title}" />`,
        '<meta data-rh="true" property="og:description" content="A summary that is AI-written." />',
        `<meta data-rh="true" property="og:url" content="${url}" />`,
        `<meta data-rh="true" property="og:image" content="${image}" />`,
        '<meta data-rh="true" property="og:image:type" content="image/png" />',
        '<meta data-rh="true" property="og:image:width" content="1200" />',
        '<meta data-rh="true" property="og:image:height" content="630" />',
        '<meta data-rh="true" property="article:author" content="RelevanceAI by Actually Relevant" />',
        '<meta data-rh="true" property="article:published_time" content="2026-10-12T07:30:00.000Z" />',
        '<meta data-rh="true" name="twitter:card" content="summary_large_image" />',
        `<meta data-rh="true" name="twitter:title" content="${title}" />`,
        '<meta data-rh="true" name="twitter:description" content="A summary that is AI-written." />',
        `<meta data-rh="true" name="twitter:image" content="${image}" />`,
      ]),
    )
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.storyPreview.pageCacheSeconds}`)
  })

  it('leaves out the published time of a story that has none, as before', async () => {
    mockPrisma.story.findFirst.mockResolvedValue({ ...STORY, datePublished: null })
    const html = (await request(app).get('/api/story-page/clean-air')).text
    expect(html).not.toContain('article:published_time')
    expect(html).toContain('<meta data-rh="true" property="article:author" content="RelevanceAI by Actually Relevant" />')
  })

  it('takes the first path segment as the slug, as before', async () => {
    await request(app).get('/api/story-page/clean-air/anything')
    expect(mockPrisma.story.findFirst.mock.calls[0][0].where).toEqual({ slug: 'clean-air', status: 'published' })
  })

  it('serves the same page under the shared mount', async () => {
    const own = (await request(app).get('/api/story-page/clean-air')).text
    _resetStoryPreviewCaches()
    expect((await request(app).get('/api/page/stories/clean-air')).text).toBe(own)
  })
})

describe('newsletter issue pages', () => {
  const DESCRIPTION = 'Week 43, 2026 of the Actually Relevant weekly newsletter: the stories that matter to humanity this week, to read on the web.'

  it("previews an issue by the email's subject line, with the newsletter image that carries the AI badge", async () => {
    const res = await request(app).get('/api/page/newsletter/week-43-2026')
    expect(res.status).toBe(200)
    const title = 'Week 43, 2026 - Actually Relevant Newsletter'
    // The card title carries the lead story's AI headline, so the card's image carries the AI label
    const cardTitle = 'Week 43: Rivers &amp; lakes &lt;recover&gt;'
    const description = DESCRIPTION
    const url = `${config.siteUrl}/newsletter/week-43-2026`
    expect(res.text).toBe(
      shellWith([
        `<title>${title}</title>`,
        meta('name', 'description', description),
        `<link data-rh="true" rel="canonical" href="${url}" />`,
        meta('property', 'og:type', 'article'),
        meta('property', 'og:site_name', 'Actually Relevant'),
        meta('property', 'og:title', cardTitle),
        meta('property', 'og:description', description),
        meta('property', 'og:url', url),
        meta('property', 'og:image', NEWSLETTER_AI_IMAGE),
        meta('property', 'og:image:type', 'image/png'),
        meta('property', 'og:image:width', '1200'),
        meta('property', 'og:image:height', '630'),
        meta('property', 'article:published_time', '2026-10-25T09:00:00.000Z'),
        meta('name', 'twitter:card', 'summary_large_image'),
        meta('name', 'twitter:title', cardTitle),
        meta('name', 'twitter:description', description),
        meta('name', 'twitter:image', NEWSLETTER_AI_IMAGE),
      ]),
    )
    // Only story pages carry an article author
    expect(res.text).not.toContain('article:author')
    expect(mockPrisma.newsletter.findFirst.mock.calls[0][0].where).toMatchObject({ status: 'published', slug: 'week-43-2026' })
    expect(mockPrisma.story.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['s1', 's2', 's3'] }, status: 'published', slug: { not: null } })
  })

  it('leads with the most relevant story that still has a page', async () => {
    mockPrisma.story.findMany.mockResolvedValue([ISSUE_STORIES[0], ISSUE_STORIES[2]])
    const html = (await request(app).get('/api/page/newsletter/week-43-2026')).text
    expect(html).toContain(meta('property', 'og:title', 'Week 43: Cities cut smog'))
    expect(html).toContain(meta('property', 'og:image', NEWSLETTER_AI_IMAGE))
  })

  it("keeps the page's title and the plain newsletter image when none of its stories has a page", async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    const html = (await request(app).get('/api/page/newsletter/week-43-2026')).text
    expect(html).toContain(meta('property', 'og:title', 'Week 43, 2026 - Actually Relevant Newsletter'))
    expect(html).toContain(meta('name', 'description', DESCRIPTION))
    expect(html).toContain(meta('property', 'og:description', DESCRIPTION))
    expect(html).toContain(meta('name', 'twitter:description', DESCRIPTION))
    expect(html).toContain(meta('property', 'og:image', NEWSLETTER_IMAGE))
    expect(html).toContain(meta('property', 'og:image:type', 'image/png'))
    expect(html).toContain(meta('name', 'twitter:image', NEWSLETTER_IMAGE))
    expect(html).not.toContain('newsletter-issue.png')
  })

  it('reads no stories for an issue whose headings carry no story markers', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValue({ ...ISSUE, content: '## Cities cut smog\n\nText.', publishedAt: null })
    const html = (await request(app).get('/api/page/newsletter/week-43-2026')).text
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
    expect(html).toContain(meta('property', 'og:title', 'Week 43, 2026 - Actually Relevant Newsletter'))
    expect(html).toContain(meta('property', 'og:description', DESCRIPTION))
    // An issue without a first-publication date is dated by its creation, as on its page
    expect(html).toContain(meta('property', 'article:published_time', '2026-10-24T09:00:00.000Z'))
  })

  it('returns the unchanged shell for an issue that is not published', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValue(null)
    const res = await request(app).get('/api/page/newsletter/draft')
    expect(res.status).toBe(200)
    expect(res.text).toBe(SHELL)
  })

  it('returns the unchanged shell, reading nothing, for a deeper path', async () => {
    expect((await request(app).get('/api/page/newsletter/week-43-2026/extra')).text).toBe(SHELL)
    expect((await request(app).get('/api/page/newsletter')).text).toBe(SHELL)
    expect(mockPrisma.newsletter.findFirst).not.toHaveBeenCalled()
  })
})

describe('podcast transcript pages', () => {
  const EPISODE = { id: 'ep-1', title: 'W43: Clean "air"', episodeSummary: 'Two hosts talk about cleaner air.', publishedAt: new Date('2026-10-24T07:00:00Z') }

  it("previews a published episode's transcript as its page's Helmet sets it, the summary behind the AI label", async () => {
    mockPrisma.podcast.findFirst.mockResolvedValue(EPISODE)
    const res = await request(app).get('/api/page/podcast/ep-1/transcript')
    const title = 'Transcript: W43: Clean &quot;air&quot; - Actually Relevant'
    const description = 'AI: Two hosts talk about cleaner air.'
    const url = `${config.siteUrl}/podcast/ep-1/transcript`
    expect(res.text).toBe(
      shellWith([
        `<title>${title}</title>`,
        meta('name', 'description', description),
        `<link data-rh="true" rel="canonical" href="${url}" />`,
        meta('property', 'og:type', 'article'),
        meta('property', 'og:site_name', 'Actually Relevant'),
        meta('property', 'og:title', title),
        meta('property', 'og:description', description),
        meta('property', 'og:url', url),
        meta('property', 'og:image', PODCAST_IMAGE),
        meta('property', 'og:image:type', 'image/png'),
        meta('property', 'og:image:width', '1200'),
        meta('property', 'og:image:height', '630'),
        meta('property', 'article:published_time', '2026-10-24T07:00:00.000Z'),
        meta('name', 'twitter:card', 'summary_large_image'),
        meta('name', 'twitter:title', title),
        meta('name', 'twitter:description', description),
        meta('name', 'twitter:image', PODCAST_IMAGE),
      ]),
    )
    // The public rule: published, ready, voiced, not a dry run
    expect(mockPrisma.podcast.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'ep-1', status: 'published', stage: 'ready', dryRun: false })
  })

  it('cuts the labeled description, not the summary alone, to the description limits', async () => {
    const summary = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    mockPrisma.podcast.findFirst.mockResolvedValue({ ...EPISODE, episodeSummary: summary })
    const html = (await request(app).get('/api/page/podcast/ep-1/transcript')).text
    const description = `AI: ${summary}`
    expect(html).toContain(meta('name', 'description', description.slice(0, 160)))
    expect(html).toContain(meta('property', 'og:description', description.slice(0, 200)))
    expect(html).toContain(meta('name', 'twitter:description', description.slice(0, 200)))
  })

  it('returns the unchanged shell for an episode that is not published', async () => {
    expect((await request(app).get('/api/page/podcast/ep-2/transcript')).text).toBe(SHELL)
  })

  it('returns the unchanged shell, reading nothing, for any other podcast path', async () => {
    expect((await request(app).get('/api/page/podcast/ep-1')).text).toBe(SHELL)
    expect((await request(app).get('/api/page/podcast/ep-1/transcript/more')).text).toBe(SHELL)
    expect(mockPrisma.podcast.findFirst).not.toHaveBeenCalled()
  })
})

describe('topic pages', () => {
  it("previews a topic that is not prerendered as IssuePage's Helmet sets it, without a canonical link", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ slug: 'air-quality', name: 'Air & Water', intro: '', description: 'Cleaner air and water for everyone.' })
    const res = await request(app).get('/api/page/issues/air-quality')
    const title = 'Air &amp; Water - Actually Relevant'
    const url = `${config.siteUrl}/issues/air-quality`
    const image = `${config.apiUrl}/api/section-images/issues/air-quality.png`
    expect(res.text).toBe(
      shellWith([
        `<title>${title}</title>`,
        meta('name', 'description', 'Cleaner air and water for everyone.'),
        meta('property', 'og:type', 'website'),
        meta('property', 'og:site_name', 'Actually Relevant'),
        meta('property', 'og:title', title),
        meta('property', 'og:description', 'Cleaner air and water for everyone.'),
        meta('property', 'og:url', url),
        meta('property', 'og:image', image),
        meta('property', 'og:image:type', 'image/png'),
        meta('property', 'og:image:width', '1200'),
        meta('property', 'og:image:height', '630'),
        meta('name', 'twitter:card', 'summary_large_image'),
        meta('name', 'twitter:title', title),
        meta('name', 'twitter:description', 'Cleaner air and water for everyone.'),
        meta('name', 'twitter:image', image),
      ]),
    )
    expect(mockPrisma.issue.findFirst.mock.calls[0][0].where).toEqual({ slug: 'air-quality' })
  })

  it('describes a topic by its intro when it has one', async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ slug: 'air-quality', name: 'Air', intro: 'The intro.', description: 'The description.' })
    const html = (await request(app).get('/api/page/issues/air-quality')).text
    expect(html).toContain(meta('name', 'description', 'The intro.'))
  })

  it('returns the unchanged shell for a topic that does not exist', async () => {
    expect((await request(app).get('/api/page/issues/nothing-here')).text).toBe(SHELL)
  })
})

describe('the shared page route', () => {
  it('returns the unchanged shell, reading nothing, for a path with no previewed page', async () => {
    for (const path of ['/api/page/', '/api/page/compare', '/api/page/constructor/x', '/api/page/toString/x']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(200)
      expect(res.text, path).toBe(SHELL)
    }
    expect(mockPrisma.newsletter.findFirst).not.toHaveBeenCalled()
  })

  it('names no page for a path segment it cannot decode', () => {
    // Express refuses such a path itself (400) before the route runs; the lookup stays safe on its own
    expect(previewTargetOf('/newsletter/%E0%A4%A')).toBeNull()
    expect(previewTargetOf('/stories/clean-air/%E0%A4%A')?.key).toBe('/stories/clean-air')
    expect(previewTargetOf('/newsletter/week%2043')?.key).toBe('/newsletter/week 43')
  })

  it('returns the unchanged shell when the database fails', async () => {
    mockPrisma.newsletter.findFirst.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/page/newsletter/week-43-2026')
    expect(res.status).toBe(200)
    expect(res.text).toBe(SHELL)
  })

  it("drops the API's security policy and caches the page briefly", async () => {
    const res = await request(app).get('/api/page/newsletter/week-43-2026')
    expect(res.headers['content-security-policy']).toBeUndefined()
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined()
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.storyPreview.pageCacheSeconds}`)
  })

  it('reads a page once while its rendering is cached, and fetches the shell once for every kind of page', async () => {
    await request(app).get('/api/page/newsletter/week-43-2026')
    await request(app).get('/api/page/newsletter/week-43-2026')
    await request(app).get('/api/story-page/clean-air')
    expect(mockPrisma.newsletter.findFirst).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('answers 503 while no shell has ever been fetched', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await request(app).get('/api/page/newsletter/week-43-2026')
    expect(res.status).toBe(503)
    expect(res.headers['retry-after']).toBe('10')
  })

  it('is mounted where the rewrites point, before the shared rate limiter', async () => {
    const res = await request(viaPublicApi).get(`${PAGE_PREVIEW_MOUNT}/newsletter/week-43-2026`)
    expect(res.status).toBe(200)
    expect(res.text).toContain(meta('property', 'og:title', 'Week 43: Rivers &amp; lakes &lt;recover&gt;'))
  })
})
