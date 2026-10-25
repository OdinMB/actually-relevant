import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { TEST_API_KEY } from './test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

// Mock prisma to avoid DB connections
const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    groupBy: vi.fn(),
  },
  issue: { findMany: vi.fn(), findUnique: vi.fn() },
  feed: { findMany: vi.fn(), findUnique: vi.fn() },
  newsletter: { findMany: vi.fn(), findUnique: vi.fn() },
  podcast: { findMany: vi.fn(), findUnique: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  jobRun: { findMany: vi.fn(), findUnique: vi.fn() },
  refreshToken: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  $disconnect: vi.fn(),
  $transaction: vi.fn((args: any) => (Array.isArray(args) ? Promise.all(args) : args())),
}))

vi.mock('./lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))
vi.mock('./services/analysis.js', () => ({
  preAssessStories: vi.fn(),
  assessStory: vi.fn(),
  selectStories: vi.fn(),
  bulkPreAssess: vi.fn(),
  bulkAssess: vi.fn(),
  bulkSelect: vi.fn(),
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('./app.js')

describe('App error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('404 handler', () => {
    it('returns 404 JSON for unmatched GET route', async () => {
      const res = await request(app).get('/api/nonexistent-route')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Not found' })
    })

    it('returns 404 JSON for unmatched POST route', async () => {
      const res = await request(app).post('/api/nonexistent-route')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Not found' })
    })

    it('returns 404 for routes outside /api prefix', async () => {
      const res = await request(app).get('/completely-unknown-path')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Not found' })
    })
  })

  describe('500 error handler', () => {
    it('returns 500 JSON when CORS rejects an origin on restricted endpoint', async () => {
      // The CORS middleware throws "Not allowed by CORS" for disallowed origins
      // on non-public endpoints (subscribe, auth, admin).
      // Public read endpoints (stories, issues, homepage, feed, docs) allow all origins.
      const res = await request(app).post('/api/subscribe').set('Origin', 'https://evil-site.com')

      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Internal server error' })
    })
  })
})

describe('X-Request-Id', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('keeps a well-formed incoming id', async () => {
    const res = await request(app).get('/api/nonexistent-route').set('X-Request-Id', 'cf-trace.123_abc-XYZ')
    expect(res.headers['x-request-id']).toBe('cf-trace.123_abc-XYZ')
  })

  it.each(['has spaces in it', 'a'.repeat(65), 'x"}{"injected":"1', 'line\tbreak'])('replaces %j with a fresh UUID', async value => {
    const res = await request(app).get('/api/nonexistent-route').set('X-Request-Id', value)
    expect(res.headers['x-request-id']).toMatch(UUID)
  })

  it('generates one when none is sent', async () => {
    const res = await request(app).get('/api/nonexistent-route')
    expect(res.headers['x-request-id']).toMatch(UUID)
  })
})

describe('CORS', () => {
  it.each([
    '/api/feed',
    '/api/feed/some-issue',
    '/api/stories',
    '/api/subscribe/token',
    '/api/podcast/feed.xml',
    '/api/newsletters',
    '/api/newsletters/week-42-2026',
  ])('opens %s to any origin', async path => {
    const res = await request(app).options(path).set('Origin', 'https://widget.example.com')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it.each(['/api/feedback', '/api/feeds', '/api/storiesx', '/api/subscribe', '/api/newslettersx', '/api/admin/newsletters'])(
    'keeps %s restricted even though it starts like a public path',
    async path => {
      const res = await request(app).post(path).set('Origin', 'https://evil-site.com')
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.status).toBe(500) // "Not allowed by CORS"
    },
  )
})
