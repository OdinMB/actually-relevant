import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

// Config is read when the module loads, so this file runs with one hop count.
// Supertest's loopback socket stands in for the last Render proxy.
process.env.TRUST_PROXY = '2'

const { default: app } = await import('../app.js')

describe('GET /health/client-ip', () => {
  it('resolves the visitor address with the configured hop count and matches Cloudflare', async () => {
    const res = await request(app)
      .get('/health/client-ip')
      .set('X-Forwarded-For', '198.51.100.4, 104.16.0.1')
      .set('CF-Connecting-IP', '198.51.100.4')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ip: '198.51.100.4',
      cloudflareIp: '198.51.100.4',
      forwardedFor: '198.51.100.4, 104.16.0.1',
      trustProxyHops: 2,
      matchesCloudflare: true,
    })
  })

  it('ignores a spoofed leading X-Forwarded-For entry', async () => {
    const res = await request(app)
      .get('/health/client-ip')
      .set('X-Forwarded-For', '203.0.113.7, 198.51.100.4, 104.16.0.1')
      .set('CF-Connecting-IP', '198.51.100.4')

    expect(res.body.ip).toBe('198.51.100.4')
    expect(res.body.matchesCloudflare).toBe(true)
  })

  it('reports a mismatch when the resolved address is not the Cloudflare one', async () => {
    const res = await request(app)
      .get('/health/client-ip')
      .set('X-Forwarded-For', '198.51.100.4, 104.16.0.1')
      .set('CF-Connecting-IP', '192.0.2.9')

    expect(res.body.matchesCloudflare).toBe(false)
  })

  it('returns null Cloudflare fields when the header is absent', async () => {
    const res = await request(app).get('/health/client-ip')

    expect(res.body.cloudflareIp).toBeNull()
    expect(res.body.matchesCloudflare).toBeNull()
    expect(res.body.forwardedFor).toBeNull()
  })

  it('forbids caching the response', async () => {
    const res = await request(app).get('/health/client-ip')

    expect(res.headers['cache-control']).toBe('no-store')
  })
})
