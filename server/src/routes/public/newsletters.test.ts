import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'express-async-errors'
import express from 'express'
import request from 'supertest'

const mockPrisma = vi.hoisted(() => ({
  newsletter: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  story: { findMany: vi.fn() },
}))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))

const { default: newslettersRouter } = await import('./newsletters.js')
const { NEWSLETTER_TOP_LABEL } = await import('../../lib/aiLabelCopy.js')
const { IPTC_TRAINED_ALGORITHMIC_MEDIA } = await import('../../lib/aiProvenance.js')
const { errorHandler } = await import('../../middleware/routeErrors.js')

const app = express().use('/api/newsletters', newslettersRouter).use(errorHandler)

const CONTENT = [
  'A hopeful week.',
  '',
  '---',
  '',
  '# Planet & Climate {planet-climate}',
  '',
  '## Cities cut smog',
  '{feed:feed-1} Nation · [original article](https://news.example/1) · [relevance analysis](https://actuallyrelevant.news/stories/clean-air)',
  '',
  'Why it matters.',
].join('\n')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/newsletters', () => {
  it('lists published issues only, newest first, with caching headers', async () => {
    mockPrisma.newsletter.findMany.mockResolvedValue([
      {
        slug: 'week-42-2026',
        title: 'Week 42, 2026',
        publishedAt: new Date('2026-10-18T09:00:00Z'),
        createdAt: new Date('2026-10-17T04:00:00Z'),
        selectedStoryIds: ['s1', 's2'],
      },
    ])
    mockPrisma.newsletter.count.mockResolvedValue(1)

    const res = await request(app).get('/api/newsletters?page=1&pageSize=10')

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/)
    expect(res.body).toEqual({
      data: [{ slug: 'week-42-2026', title: 'Week 42, 2026', publishedAt: '2026-10-18T09:00:00.000Z', storyCount: 2 }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    })
    const args = mockPrisma.newsletter.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ status: 'published', slug: { not: null } })
    expect(args.orderBy[0]).toEqual({ publishedAt: 'desc' })
    // The draft's content never leaves the database through this route
    expect(args.select.content).toBeUndefined()
  })

  it('rejects a page size above the limit', async () => {
    expect((await request(app).get('/api/newsletters?pageSize=500')).status).toBe(400)
  })

  it('answers 500 with its own text when the archive cannot be read', async () => {
    mockPrisma.newsletter.findMany.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/newsletters')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to load the newsletter archive' })
  })
})

describe('GET /api/newsletters/feed.xml', () => {
  it('is an RSS feed of the published issues, each linking its web edition and carrying the AI label', async () => {
    mockPrisma.newsletter.findMany.mockResolvedValue([
      { slug: 'week-42-2026', title: 'Week 42, 2026', publishedAt: new Date('2026-10-18T09:00:00Z'), createdAt: new Date(), selectedStoryIds: ['s1'] },
      { slug: 'week-41-2026', title: 'Week 41 & more', publishedAt: null, createdAt: new Date('2026-10-11T09:00:00Z'), selectedStoryIds: [] },
    ])
    mockPrisma.newsletter.count.mockResolvedValue(2)

    const res = await request(app).get('/api/newsletters/feed.xml')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/rss+xml; charset=utf-8')
    expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/)
    const args = mockPrisma.newsletter.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ status: 'published', slug: { not: null } })
    expect(args.select.content).toBeUndefined()

    const xml: string = res.text
    expect(xml).toContain('<rss version="2.0"')
    const channel = xml.replace(/<item>[\s\S]*?<\/item>/g, '')
    expect(channel).toContain('Weekly newsletter: news that matters to humanity. Written and curated by AI.')
    expect(channel).toContain('https://actuallyrelevant.news/newsletter')
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]!)
    expect(items).toHaveLength(2)
    expect(items[0]).toContain('<link>https://actuallyrelevant.news/newsletter/week-42-2026</link>')
    expect(items[0]).toContain('Sun, 18 Oct 2026 09:00:00 GMT')
    expect(items[0]).toContain(`${NEWSLETTER_TOP_LABEL.lead} ${NEWSLETTER_TOP_LABEL.text}`)
    expect(items[1]).toContain('<title><![CDATA[Week 41 & more]]></title>')
    expect(items[1]).toContain('Sun, 11 Oct 2026 09:00:00 GMT')
    for (const item of items) expect(item).toContain(NEWSLETTER_TOP_LABEL.text)
  })

  it('is a valid empty feed before the first issue is published', async () => {
    mockPrisma.newsletter.findMany.mockResolvedValue([])
    mockPrisma.newsletter.count.mockResolvedValue(0)
    const res = await request(app).get('/api/newsletters/feed.xml')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<channel>')
    expect(res.text).not.toContain('<item>')
  })

  it('answers 500 with its own text when the archive cannot be read', async () => {
    mockPrisma.newsletter.findMany.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/newsletters/feed.xml')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to generate the newsletter feed' })
  })
})

describe('GET /api/newsletters/:slug', () => {
  it('returns a published issue with its AI label, web markdown, stories and AI marker', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValue({
      slug: 'week-42-2026',
      title: 'Week 42, 2026',
      content: CONTENT,
      publishedAt: new Date('2026-10-18T09:00:00Z'),
      createdAt: new Date(),
      selectedStoryIds: ['s1', 's2'],
    })
    mockPrisma.story.findMany.mockResolvedValue([
      {
        id: 's1',
        slug: 'clean-air',
        status: 'published',
        title: 'Cities cut smog',
        titleLabel: 'Air',
        sourceTitle: 'Smog falls',
        sourceUrl: 'https://news.example/1',
        feed: { title: 'Nation Feed', displayTitle: 'Nation' },
      },
      {
        id: 's2',
        slug: 'gone',
        status: 'rejected',
        title: null,
        titleLabel: null,
        sourceTitle: 'Old',
        sourceUrl: 'https://news.example/2',
        feed: { title: 'Other', displayTitle: null },
      },
    ])

    const res = await request(app).get('/api/newsletters/week-42-2026')

    expect(res.status).toBe(200)
    expect(mockPrisma.newsletter.findFirst.mock.calls[0][0].where).toEqual({ status: 'published', slug: 'week-42-2026' })
    expect(res.body.aiLabel).toEqual(NEWSLETTER_TOP_LABEL)
    expect(res.body.content).toContain('# Planet & Climate\n')
    expect(res.body.content).not.toContain('{feed:')
    expect(res.body.content).not.toContain('{planet-climate}')
    expect(res.body.content).toContain('Nation · [original article]')
    expect(res.body.stories).toEqual([
      {
        headline: 'Cities cut smog',
        title: 'Cities cut smog',
        titleLabel: 'Air',
        sourceTitle: 'Smog falls',
        sourceUrl: 'https://news.example/1',
        publisher: 'Nation',
        slug: 'clean-air',
      },
      // A story that is no longer published keeps its headline but loses its link
      { headline: 'Old', title: null, titleLabel: null, sourceTitle: 'Old', sourceUrl: 'https://news.example/2', publisher: 'Other', slug: null },
    ])
    expect(res.body.aiGenerated).toEqual({ fields: ['content', 'stories'], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA })
  })

  it('matches a marked heading to its story by id, after the story was renamed or the heading edited', async () => {
    const content = [
      '## Smog falls in 40 cities {story:s1}',
      '{feed:feed-1} Nation · [original article](https://news.example/1)',
      '',
      '## Old unmarked heading',
      'Other · [original article](https://news.example/2)',
    ].join('\n')
    mockPrisma.newsletter.findFirst.mockResolvedValue({
      slug: 'week-42-2026',
      title: 'Week 42, 2026',
      content,
      publishedAt: new Date('2026-10-18T09:00:00Z'),
      createdAt: new Date(),
      // s1 was dropped from the shortlist after generation; s2 is unmarked
      selectedStoryIds: ['s2'],
    })
    const storyRow = (id: string, title: string) => ({
      id,
      slug: id,
      status: 'published',
      title,
      titleLabel: null,
      sourceTitle: `Source ${id}`,
      sourceUrl: `https://news.example/${id}`,
      feed: { title: 'Feed', displayTitle: null },
    })
    mockPrisma.story.findMany.mockResolvedValue([storyRow('s1', 'A title renamed later'), storyRow('s2', 'Old unmarked heading')])

    const res = await request(app).get('/api/newsletters/week-42-2026')

    expect(mockPrisma.story.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['s1', 's2'] } })
    expect(res.body.content).toContain('## Smog falls in 40 cities\n')
    expect(res.body.stories.map((s: { slug: string; headline: string }) => [s.slug, s.headline])).toEqual([
      ['s1', 'Smog falls in 40 cities'],
      ['s2', 'Old unmarked heading'],
    ])
  })

  it('404s for an issue that is not published', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValue(null)
    const res = await request(app).get('/api/newsletters/week-43-2026')
    expect(res.status).toBe(404)
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
  })

  it('answers 500 with its own text when the issue cannot be read', async () => {
    mockPrisma.newsletter.findFirst.mockRejectedValue(new Error('db down'))
    const res = await request(app).get('/api/newsletters/week-42-2026')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Failed to load the issue' })
  })
})
