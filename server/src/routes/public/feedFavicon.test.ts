import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import helmet from 'helmet'
import request from 'supertest'

const mockGetFavicon = vi.hoisted(() => vi.fn())
vi.mock('../../services/faviconStore.js', () => ({ getFavicon: mockGetFavicon }))
vi.mock('../../lib/prisma.js', () => ({ default: {} }))
// A limiter that refuses everything: whatever passes it was never rate-limited.
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
  searchLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { default: feedFaviconRouter } = await import('./feedFavicon.js')
const { default: publicRouter } = await import('./index.js')
const { feedFaviconUrl } = await import('../../lib/feedFaviconUrl.js')
const { config } = await import('../../config.js')

const FEED_ID = '11111111-2222-4333-8444-555555555555'
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const ETAG = '"abc123"'

// helmet() as app.ts applies it, so the test sees the header the route must replace
const app = express().use(helmet()).use('/api/feeds', feedFaviconRouter)
const viaPublicApi = express().use('/api', publicRouter)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetFavicon.mockResolvedValue({ png: PNG, etag: ETAG })
})

describe('GET /api/feeds/:id/favicon', () => {
  it('serves the stored PNG, cacheable by browsers and embeddable from the site and in email', async () => {
    const res = await request(app).get(`/api/feeds/${FEED_ID}/favicon`).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.favicon.httpCacheSeconds}`)
    expect(res.headers['etag']).toBe(ETAG)
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(res.body).toEqual(PNG)
    expect(mockGetFavicon).toHaveBeenCalledWith(FEED_ID)
  })

  it('answers 304 without the body when the browser already has this favicon', async () => {
    const res = await request(app).get(`/api/feeds/${FEED_ID}/favicon`).set('If-None-Match', ETAG)
    expect(res.status).toBe(304)
    expect(res.body).toEqual({})
  })

  it('answers 404 when the feed has no stored favicon', async () => {
    mockGetFavicon.mockResolvedValue(null)
    const res = await request(app).get(`/api/feeds/${FEED_ID}/favicon`)
    expect(res.status).toBe(404)
    expect(res.headers['cache-control']).toBeUndefined()
  })

  it('answers 404 for an id that is not a UUID, without looking it up', async () => {
    const res = await request(app).get('/api/feeds/..%2F..%2Fetc/favicon')
    expect(res.status).toBe(404)
    expect(mockGetFavicon).not.toHaveBeenCalled()
  })

  it('serves the address the newsletter links to, outside the shared rate limiter', async () => {
    // A page of story cards asks for a favicon per feed: they must not use up the visitor's API budget
    const res = await request(viaPublicApi).get(new URL(feedFaviconUrl(FEED_ID)).pathname)
    expect(res.status).toBe(200)
    expect(new URL(feedFaviconUrl(FEED_ID)).origin).toBe(new URL(config.apiUrl).origin)
  })
})
