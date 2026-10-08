import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const mockStore = vi.hoisted(() => ({
  listNotices: vi.fn(),
  countUnseenNotices: vi.fn(),
  markNoticeSeen: vi.fn(),
  markNoticesSeen: vi.fn(),
}))

vi.mock('../../lib/prisma.js', () => ({ default: { $disconnect: vi.fn() } }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))
vi.mock('../../services/adminNotices.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/adminNotices.js')>()),
  ...mockStore,
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')

const notice = {
  id: 'n-1', source: 'plunk', severity: 'critical', title: 'Spam complaint in Plunk', message: 'm', link: '/admin/subscribers',
  dedupeKey: 'plunk:e1_complaint', count: 1, firstOccurredAt: '2026-10-08T10:00:00.000Z', lastOccurredAt: '2026-10-08T10:00:00.000Z', seenAt: null,
}

describe('Admin Notices API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/admin/notices')).status).toBe(401)
    expect((await request(app).post('/api/admin/notices/seen')).status).toBe(401)
  })

  describe('GET /api/admin/notices', () => {
    it('lists with the source and unseen filters and pagination, with the unseen count', async () => {
      mockStore.listNotices.mockResolvedValueOnce({ items: [notice], total: 30, unseenCount: 4 })
      const res = await request(app).get('/api/admin/notices?source=plunk&show=unseen&page=2&limit=10').set(authHeader())
      expect(res.status).toBe(200)
      expect(mockStore.listNotices).toHaveBeenCalledWith({ source: 'plunk', unseenOnly: true }, 2, 10)
      expect(res.body).toEqual({ items: [notice], total: 30, unseenCount: 4, page: 2, limit: 10 })
    })

    it('defaults to every notice of every source, 25 a page', async () => {
      mockStore.listNotices.mockResolvedValueOnce({ items: [], total: 0, unseenCount: 0 })
      await request(app).get('/api/admin/notices').set(authHeader())
      expect(mockStore.listNotices).toHaveBeenCalledWith({ source: undefined, unseenOnly: false }, 1, 25)
    })

    it('refuses an unknown source', async () => {
      const res = await request(app).get('/api/admin/notices?source=chat').set(authHeader())
      expect(res.status).toBe(400)
      expect(mockStore.listNotices).not.toHaveBeenCalled()
    })
  })

  it('GET /count returns the unseen and unseen-critical counts', async () => {
    mockStore.countUnseenNotices.mockResolvedValueOnce({ unseen: 3, unseenCritical: 1 })
    const res = await request(app).get('/api/admin/notices/count').set(authHeader())
    expect(res.body).toEqual({ unseen: 3, unseenCritical: 1 })
  })

  describe('POST /api/admin/notices/:id/seen', () => {
    it('marks one notice seen and returns it', async () => {
      mockStore.markNoticeSeen.mockResolvedValueOnce({ ...notice, seenAt: '2026-10-08T11:00:00.000Z' })
      const res = await request(app).post('/api/admin/notices/n-1/seen').set(authHeader())
      expect(res.status).toBe(200)
      expect(mockStore.markNoticeSeen).toHaveBeenCalledWith('n-1')
      expect(res.body.seenAt).toBe('2026-10-08T11:00:00.000Z')
    })

    it('answers 404 for an unknown id', async () => {
      mockStore.markNoticeSeen.mockResolvedValueOnce(null)
      expect((await request(app).post('/api/admin/notices/nope/seen').set(authHeader())).status).toBe(404)
    })
  })

  describe('POST /api/admin/notices/seen', () => {
    it('marks all seen without a source', async () => {
      mockStore.markNoticesSeen.mockResolvedValueOnce(7)
      const res = await request(app).post('/api/admin/notices/seen').set(authHeader()).send({})
      expect(res.body).toEqual({ affected: 7 })
      expect(mockStore.markNoticesSeen).toHaveBeenCalledWith(undefined)
    })

    it('marks only one source seen when given one', async () => {
      mockStore.markNoticesSeen.mockResolvedValueOnce(2)
      await request(app).post('/api/admin/notices/seen').set(authHeader()).send({ source: 'podcast' })
      expect(mockStore.markNoticesSeen).toHaveBeenCalledWith('podcast')
    })
  })
})
