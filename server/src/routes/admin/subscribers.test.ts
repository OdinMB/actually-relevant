import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

const mockSubscribers = vi.hoisted(() => ({ getSubscriberReconciliation: vi.fn() }))
const mockPrisma = vi.hoisted(() => ({ $disconnect: vi.fn() }))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/subscribers.js', () => mockSubscribers)
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')

const sampleReconciliation = {
  db: { total: 2, confirmed: 1, pending: 1 },
  plunk: { available: true, partial: false, truncated: false, total: 3, subscribed: 2, unsubscribed: 1, unsubscribedNotInDb: 1, error: null },
  mismatches: 1,
  rows: [{ email: 'a@x.com', dbStatus: 'confirmed', dbConfirmedAt: null, dbCreatedAt: null, plunkStatus: 'subscribed', plunkContactId: 'id', mismatch: false }],
}

describe('Admin Subscribers API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/admin/subscribers', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/subscribers')
      expect(res.status).toBe(401)
    })

    it('returns the reconciliation payload', async () => {
      mockSubscribers.getSubscriberReconciliation.mockResolvedValue(sampleReconciliation)

      const res = await request(app).get('/api/admin/subscribers').set(authHeader())

      expect(res.status).toBe(200)
      expect(res.body.db.confirmed).toBe(1)
      expect(res.body.plunk.available).toBe(true)
      expect(res.body.rows).toHaveLength(1)
    })

    it('returns 500 when the service throws', async () => {
      mockSubscribers.getSubscriberReconciliation.mockRejectedValue(new Error('boom'))

      const res = await request(app).get('/api/admin/subscribers').set(authHeader())

      expect(res.status).toBe(500)
    })
  })
})
