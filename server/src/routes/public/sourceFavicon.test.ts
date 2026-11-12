import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import helmet from 'helmet'
import request from 'supertest'

const mockGetSourceFavicon = vi.hoisted(() => vi.fn())
vi.mock('../../services/sourceFavicons.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/sourceFavicons.js')>()),
  getSourceFavicon: mockGetSourceFavicon,
}))
vi.mock('../../lib/prisma.js', () => ({ default: {} }))
// A limiter that refuses everything: whatever passes it was never rate-limited.
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
  searchLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { default: sourceFaviconRouter } = await import('./sourceFavicon.js')
const { default: publicRouter } = await import('./index.js')
const { config } = await import('../../config.js')

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9])
const ETAG = '"def456"'

// helmet() as app.ts applies it, so the test sees the header the route must replace
const app = express().use(helmet()).use('/api/source-favicons', sourceFaviconRouter)
const viaPublicApi = express().use('/api', publicRouter)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSourceFavicon.mockResolvedValue({ png: PNG, etag: ETAG })
})

describe('GET /api/source-favicons/:host', () => {
  it('serves the stored PNG, cacheable by browsers and embeddable from the site', async () => {
    const res = await request(app).get('/api/source-favicons/outlet.example.com').buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.favicon.httpCacheSeconds}`)
    expect(res.headers['etag']).toBe(ETAG)
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(res.body).toEqual(PNG)
    expect(mockGetSourceFavicon).toHaveBeenCalledWith('outlet.example.com')
  })

  it('answers 404 when none is stored for the host', async () => {
    mockGetSourceFavicon.mockResolvedValue(null)
    const res = await request(app).get('/api/source-favicons/outlet.example.com')
    expect(res.status).toBe(404)
    expect(res.headers['cache-control']).toBeUndefined()
  })

  it.each(['..%2F..%2Fetc', '127.0.0.1', 'Outlet.Example.com'])('answers 404 for %s, which is not a plain host name, without looking it up', async host => {
    const res = await request(app).get(`/api/source-favicons/${host}`)
    expect(res.status).toBe(404)
    expect(mockGetSourceFavicon).not.toHaveBeenCalled()
  })

  it('is served outside the shared rate limiter, like the feed favicons', async () => {
    // A researched story page asks for one icon per source
    const res = await request(viaPublicApi).get('/api/source-favicons/outlet.example.com')
    expect(res.status).toBe(200)
  })
})
