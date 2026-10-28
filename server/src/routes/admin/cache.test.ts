import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  issue: { findMany: vi.fn() },
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

describe('POST /api/admin/cache/clear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.issue.findMany.mockResolvedValue([])
  })

  it('requires authentication', async () => {
    const res = await request(app).post('/api/admin/cache/clear')
    expect(res.status).toBe(401)
  })

  it('names every public cache it emptied, with what each held', async () => {
    await request(app).get('/api/issues').expect(200)

    const res = await request(app).post('/api/admin/cache/clear').set(authHeader())

    expect(res.status).toBe(200)
    const names = res.body.caches.map((c: { name: string }) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'homepage',
        'issues',
        'sources',
        'rss-feeds',
        'sitemap',
        'podcast-feed',
        'related-stories',
        'story-preview-images',
        'story-preview-pages',
        'client-shell',
      ]),
    )
    expect(res.body.caches).toContainEqual({ name: 'issues', entries: 1 })
    expect(res.body.entries).toBeGreaterThanOrEqual(1)
  })

  it('makes the next public request read the database again', async () => {
    await request(app).post('/api/admin/cache/clear').set(authHeader())
    await request(app).get('/api/issues').expect(200)
    await request(app).get('/api/issues').expect(200)
    expect(mockPrisma.issue.findMany).toHaveBeenCalledTimes(1)

    await request(app).post('/api/admin/cache/clear').set(authHeader()).expect(200)
    await request(app).get('/api/issues').expect(200)

    expect(mockPrisma.issue.findMany).toHaveBeenCalledTimes(2)
  })
})
