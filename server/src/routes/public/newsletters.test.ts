import { describe, it, expect, vi, beforeEach } from 'vitest'
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

const app = express().use('/api/newsletters', newslettersRouter)

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
      { slug: 'week-42-2026', title: 'Week 42, 2026', publishedAt: new Date('2026-10-18T09:00:00Z'), createdAt: new Date('2026-10-17T04:00:00Z'), selectedStoryIds: ['s1', 's2'] },
    ])
    mockPrisma.newsletter.count.mockResolvedValue(1)

    const res = await request(app).get('/api/newsletters?page=1&pageSize=10')

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/)
    expect(res.body).toEqual({
      data: [{ slug: 'week-42-2026', title: 'Week 42, 2026', publishedAt: '2026-10-18T09:00:00.000Z', storyCount: 2 }],
      total: 1, page: 1, pageSize: 10, totalPages: 1,
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
})

describe('GET /api/newsletters/:slug', () => {
  it('returns a published issue with its AI label, web markdown, stories and AI marker', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValue({
      slug: 'week-42-2026', title: 'Week 42, 2026', content: CONTENT,
      publishedAt: new Date('2026-10-18T09:00:00Z'), createdAt: new Date(), selectedStoryIds: ['s1', 's2'],
    })
    mockPrisma.story.findMany.mockResolvedValue([
      { id: 's1', slug: 'clean-air', status: 'published', title: 'Cities cut smog', titleLabel: 'Air', sourceTitle: 'Smog falls', sourceUrl: 'https://news.example/1', feed: { title: 'Nation Feed', displayTitle: 'Nation' } },
      { id: 's2', slug: 'gone', status: 'rejected', title: null, titleLabel: null, sourceTitle: 'Old', sourceUrl: 'https://news.example/2', feed: { title: 'Other', displayTitle: null } },
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
      { headline: 'Cities cut smog', title: 'Cities cut smog', titleLabel: 'Air', sourceTitle: 'Smog falls', sourceUrl: 'https://news.example/1', publisher: 'Nation', slug: 'clean-air' },
      // A story that is no longer published keeps its headline but loses its link
      { headline: 'Old', title: null, titleLabel: null, sourceTitle: 'Old', sourceUrl: 'https://news.example/2', publisher: 'Other', slug: null },
    ])
    expect(res.body.aiGenerated).toEqual({ fields: ['content', 'stories'], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA })
  })

  it('404s for an issue that is not published', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValue(null)
    const res = await request(app).get('/api/newsletters/week-43-2026')
    expect(res.status).toBe(404)
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
  })
})
