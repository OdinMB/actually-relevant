import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
}))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')
const { aiGeneratedMarker } = await import('../../lib/aiProvenance.js')

/** The marker as JSON serializes it: the route must attach exactly this. */
function expectedMarker(story: Parameters<typeof aiGeneratedMarker>[0]) {
  return JSON.parse(JSON.stringify(aiGeneratedMarker(story)))
}

const publicStory = {
  id: 'story-1',
  sourceUrl: 'https://example.com/article',
  title: 'Published Article',
  datePublished: new Date('2024-01-15'),
  dateCrawled: new Date('2024-01-14'),
  status: 'published',
  relevancePre: 7,
  relevance: 9,
  emotionTag: 'uplifting',
  summary: 'A test summary',
  quote: 'A notable quote',
  marketingBlurb: 'Read this article',
  relevanceReasons: 'Very relevant',
  antifactors: 'None',
  feed: {
    title: 'Test Feed',
    issue: { name: 'AI & Technology', slug: 'ai-technology' },
  },
}

describe('Public Stories API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/stories', () => {
    it('returns published stories without auth', async () => {
      mockPrisma.story.findMany.mockResolvedValue([publicStory])
      mockPrisma.story.count.mockResolvedValue(1)

      const res = await request(app).get('/api/stories')
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].title).toBe('Published Article')
      expect(res.body.total).toBe(1)
      expect(res.body.page).toBe(1)
    })

    it('supports issueSlug filter', async () => {
      mockPrisma.story.findMany.mockResolvedValue([])
      mockPrisma.story.count.mockResolvedValue(0)

      const res = await request(app).get('/api/stories?issueSlug=ai-technology')
      expect(res.status).toBe(200)
    })

    it('supports search filter', async () => {
      mockPrisma.story.findMany.mockResolvedValue([publicStory])
      mockPrisma.story.count.mockResolvedValue(1)

      const res = await request(app).get('/api/stories?search=Published')
      expect(res.status).toBe(200)
    })

    it('rejects search queries longer than 200 characters', async () => {
      const longQuery = 'a'.repeat(201)
      const res = await request(app).get(`/api/stories?search=${longQuery}`)
      expect(res.status).toBe(400)
    })

    it('supports pagination', async () => {
      mockPrisma.story.findMany.mockResolvedValue([])
      mockPrisma.story.count.mockResolvedValue(50)

      const res = await request(app).get('/api/stories?page=2&pageSize=10')
      expect(res.status).toBe(200)
      expect(res.body.page).toBe(2)
      expect(res.body.pageSize).toBe(10)
    })

    it('ignores positivity param (filtering is client-side)', async () => {
      mockPrisma.story.findMany.mockResolvedValue([publicStory])
      mockPrisma.story.count.mockResolvedValue(1)

      const res = await request(app).get('/api/stories?positivity=100')
      // Should still return all stories, positivity is not a server concern
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
    })

    it('does not expose internal AI fields', async () => {
      mockPrisma.story.findMany.mockResolvedValue([publicStory])
      mockPrisma.story.count.mockResolvedValue(1)

      const res = await request(app).get('/api/stories')
      expect(res.status).toBe(200)
      // These internal fields should not be present
      expect(res.body.data[0].relevanceCalculation).toBeUndefined()
      expect(res.body.data[0].sourceContent).toBeUndefined()
    })

    it('marks the AI-generated fields of each listed story', async () => {
      mockPrisma.story.findMany.mockResolvedValue([publicStory])
      mockPrisma.story.count.mockResolvedValue(1)

      const res = await request(app).get('/api/stories')
      expect(res.body.data[0].aiGenerated).toEqual(expectedMarker(publicStory))
    })

    describe('incremental sync filters', () => {
      /** The where clause the listing query ran with. */
      function lastWhere() {
        return mockPrisma.story.findMany.mock.calls.at(-1)![0].where
      }

      it('filters on datePublished and relevance', async () => {
        mockPrisma.story.findMany.mockResolvedValue([publicStory])
        mockPrisma.story.count.mockResolvedValue(1)

        const res = await request(app).get(
          '/api/stories?publishedSince=2026-10-01T00:00:00Z&publishedBefore=2026-10-08T12:00:00%2B02:00&minRelevance=7',
        )
        expect(res.status).toBe(200)
        expect(lastWhere()).toEqual({
          status: 'published',
          AND: [
            { datePublished: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-10-08T10:00:00Z') } },
            { relevance: { gte: 7 } },
          ],
        })
        // count runs on the same filter, so total and pages describe the filtered set
        expect(mockPrisma.story.count.mock.calls.at(-1)![0].where).toEqual(lastWhere())
      })

      it('accepts publishedSince on its own', async () => {
        mockPrisma.story.findMany.mockResolvedValue([])
        mockPrisma.story.count.mockResolvedValue(0)

        const res = await request(app).get('/api/stories?publishedSince=2026-10-01T00:00:00.000Z')
        expect(res.status).toBe(200)
        expect(lastWhere().AND).toEqual([{ datePublished: { gte: new Date('2026-10-01T00:00:00Z') } }])
      })

      it.each([
        ['publishedSince=yesterday', 'publishedSince'],
        ['publishedSince=2026-10-01', 'publishedSince'],
        ['publishedBefore=2026-13-01T00:00:00Z', 'publishedBefore'],
        ['minRelevance=0', 'minRelevance'],
        ['minRelevance=11', 'minRelevance'],
        ['minRelevance=7.5', 'minRelevance'],
        ['minRelevance=high', 'minRelevance'],
      ])('rejects %s with a 400 naming the parameter', async (qs, field) => {
        const res = await request(app).get(`/api/stories?${qs}`)
        expect(res.status).toBe(400)
        expect(res.body.error).toBe('Invalid query parameters')
        expect(res.body.details.fieldErrors[field]).toBeDefined()
        expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
      })

      it('rejects a publishedSince that is not earlier than publishedBefore', async () => {
        const res = await request(app).get(
          '/api/stories?publishedSince=2026-10-08T00:00:00Z&publishedBefore=2026-10-08T00:00:00Z',
        )
        expect(res.status).toBe(400)
        expect(res.body.details.fieldErrors.publishedBefore).toEqual(['publishedSince must be earlier than publishedBefore'])
      })

      it('rejects the filters combined with search, which does not apply them', async () => {
        const res = await request(app).get('/api/stories?search=climate&minRelevance=7')
        expect(res.status).toBe(400)
        expect(res.body.details.fieldErrors.search[0]).toContain('cannot be combined with search')
        expect(mockPrisma.$queryRaw).not.toHaveBeenCalled()
      })
    })

    it('marks the AI-generated fields of search results', async () => {
      mockPrisma.story.findMany.mockResolvedValue([publicStory])

      const res = await request(app).get('/api/stories?search=Published')
      expect(res.status).toBe(200)
      expect(res.body.data[0].aiGenerated).toEqual(expectedMarker(publicStory))
    })
  })

  describe('GET /api/stories/:slug/related', () => {
    it('marks the AI-generated fields of related stories', async () => {
      // Source story, then a candidate pool small enough to skip the LLM re-rank
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'source', title: 'Source', title_label: null }])
        .mockResolvedValueOnce([{ id: 'story-1', title: 'Published Article', title_label: null }])
      mockPrisma.story.findMany.mockResolvedValue([publicStory])

      const res = await request(app).get('/api/stories/source-slug/related')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0].aiGenerated).toEqual(expectedMarker(publicStory))
    })
  })

  describe('GET /api/stories/:id', () => {
    it('returns a single published story', async () => {
      mockPrisma.story.findFirst.mockResolvedValue(publicStory)

      const res = await request(app).get('/api/stories/story-1')
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Published Article')
      expect(res.body.feed).toBeDefined()
    })

    it('marks the AI-generated fields of the story', async () => {
      mockPrisma.story.findFirst.mockResolvedValue(publicStory)

      const res = await request(app).get('/api/stories/story-1')
      expect(res.body.aiGenerated).toEqual(expectedMarker(publicStory))
    })

    it('returns 404 for non-published story', async () => {
      mockPrisma.story.findFirst.mockResolvedValue(null)

      const res = await request(app).get('/api/stories/not-published')
      expect(res.status).toBe(404)
    })
  })
})
