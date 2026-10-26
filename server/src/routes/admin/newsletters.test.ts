import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, sampleNewsletter, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  newsletter: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  $disconnect: vi.fn(),
}))

// The moves themselves are tested against PostgreSQL (newsletterLifecycle.db.test.ts); here, which
// move each route calls and how a refusal is answered
const moves = vi.hoisted(() => ({
  editNewsletter: vi.fn(),
  publishNewsletter: vi.fn(),
  unpublishNewsletter: vi.fn(),
  deleteNewsletter: vi.fn(),
  assignStories: vi.fn(),
  selectStories: vi.fn(),
  generateContent: vi.fn(),
  generateHtml: vi.fn(),
  sendTest: vi.fn(),
  sendLive: vi.fn(),
  markSendFailed: vi.fn(),
}))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/llm.js', () => ({ getLLMByTier: vi.fn(), rateLimitDelay: vi.fn() }))
vi.mock('../../services/newsletterLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/newsletterLifecycle.js')>()),
  ...moves,
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')
const { NewsletterRefusedError, TestSegmentNotConfiguredError } = await import('../../services/newsletterLifecycle.js')
const { BadRequestError, NotFoundError } = await import('../../utils/errors.js')

const api = (path = '') => `/api/admin/newsletters/newsletter-1${path}`

describe('Admin Newsletters API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('reads and create', () => {
    it('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/admin/newsletters')
      expect(res.status).toBe(401)
    })

    it('returns paginated newsletters', async () => {
      mockPrisma.newsletter.findMany.mockResolvedValue([sampleNewsletter(), sampleNewsletter({ id: 'newsletter-2' })])
      mockPrisma.newsletter.count.mockResolvedValue(2)

      const res = await request(app).get('/api/admin/newsletters?status=published').set(authHeader())
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(2)
    })

    it('returns a single newsletter, or 404', async () => {
      mockPrisma.newsletter.findUnique.mockResolvedValueOnce(sampleNewsletter()).mockResolvedValueOnce(null)

      expect((await request(app).get(api()).set(authHeader())).body.title).toBe('Weekly Roundup #1')
      expect((await request(app).get(api()).set(authHeader())).status).toBe(404)
    })

    it('creates a newsletter, and refuses one without a title', async () => {
      mockPrisma.newsletter.create.mockResolvedValue(sampleNewsletter())

      expect((await request(app).post('/api/admin/newsletters').set(authHeader()).send({ title: 'Weekly Roundup #1' })).status).toBe(201)
      expect((await request(app).post('/api/admin/newsletters').set(authHeader()).send({})).status).toBe(400)
    })

    it('answers 500 with the list route text when the query fails', async () => {
      mockPrisma.newsletter.findMany.mockRejectedValue(new Error('db down'))
      mockPrisma.newsletter.count.mockRejectedValue(new Error('db down'))

      const res = await request(app).get('/api/admin/newsletters').set(authHeader())
      expect(res.body).toEqual({ error: 'Failed to fetch newsletters' })
    })
  })

  describe('PUT /:id', () => {
    it('edits the fields, then moves the status, and answers with the result', async () => {
      moves.editNewsletter.mockResolvedValue(sampleNewsletter({ title: 'Updated' }))
      moves.publishNewsletter.mockResolvedValue(sampleNewsletter({ title: 'Updated', status: 'published' }))

      const res = await request(app).put(api()).set(authHeader()).send({ title: 'Updated', status: 'published' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('published')
      expect(moves.editNewsletter).toHaveBeenCalledWith('newsletter-1', { title: 'Updated' })
      expect(moves.publishNewsletter).toHaveBeenCalledWith('newsletter-1')
      expect(moves.editNewsletter.mock.invocationCallOrder[0]).toBeLessThan(moves.publishNewsletter.mock.invocationCallOrder[0]!)
    })

    it('unpublishes with a status of draft, after an edit with no fields', async () => {
      moves.editNewsletter.mockResolvedValue(sampleNewsletter({ status: 'published' }))
      moves.unpublishNewsletter.mockResolvedValue(sampleNewsletter())

      const res = await request(app).put(api()).set(authHeader()).send({ status: 'draft' })

      expect(res.body.status).toBe('draft')
      expect(moves.editNewsletter).toHaveBeenCalledWith('newsletter-1', {})
      expect(moves.publishNewsletter).not.toHaveBeenCalled()
    })

    it('answers 409 with the reason when the issue is frozen, and moves no status', async () => {
      moves.editNewsletter.mockRejectedValue(new NewsletterRefusedError('frozen', 'This issue was sent to subscribers'))

      const res = await request(app).put(api()).set(authHeader()).send({ content: 'x', status: 'published' })

      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: 'This issue was sent to subscribers' })
      expect(moves.publishNewsletter).not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown newsletter', async () => {
      moves.editNewsletter.mockRejectedValue(new NotFoundError('Newsletter not found'))

      const res = await request(app).put(api()).set(authHeader()).send({ title: 'x' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Newsletter not found' })
    })
  })

  describe('moves', () => {
    it('calls each route its move with the issue id', async () => {
      const routes: [string, keyof typeof moves, unknown][] = [
        ['/assign', 'assignStories', sampleNewsletter()],
        ['/select', 'selectStories', sampleNewsletter()],
        ['/generate', 'generateContent', sampleNewsletter()],
        ['/send-test', 'sendTest', { id: 'send-1' }],
      ]
      for (const [path, move, result] of routes) {
        moves[move].mockResolvedValue(result)
        const res = await request(app).post(api(path)).set(authHeader())
        expect(res.status, path).toBe(200)
        expect(moves[move], path).toHaveBeenCalledWith('newsletter-1')
      }
    })

    it('answers the HTML build with the HTML', async () => {
      moves.generateHtml.mockResolvedValue('<p>hi</p>')
      expect((await request(app).post(api('/html')).set(authHeader())).body).toEqual({ html: '<p>hi</p>' })
    })

    it('sends live with the optional schedule', async () => {
      moves.sendLive.mockResolvedValue({ id: 'send-2' })

      await request(app).post(api('/send-live')).set(authHeader()).send({})
      await request(app).post(api('/send-live')).set(authHeader()).send({ scheduledFor: '2026-11-01T07:00:00.000Z' })

      expect(moves.sendLive).toHaveBeenNthCalledWith(1, 'newsletter-1', undefined)
      expect(moves.sendLive).toHaveBeenNthCalledWith(2, 'newsletter-1', '2026-11-01T07:00:00.000Z')
    })

    it('marks an unconfirmed send as not sent', async () => {
      moves.markSendFailed.mockResolvedValue({ id: 'send-2', status: 'failed' })

      const res = await request(app).post(api('/sends/send-2/mark-failed')).set(authHeader())

      expect(res.body.status).toBe('failed')
      expect(moves.markSendFailed).toHaveBeenCalledWith('newsletter-1', 'send-2')
    })

    it('deletes through the delete move', async () => {
      moves.deleteNewsletter.mockResolvedValue(undefined)
      expect((await request(app).delete(api()).set(authHeader())).status).toBe(204)
      expect(moves.deleteNewsletter).toHaveBeenCalledWith('newsletter-1')
    })
  })

  // Statuses and bodies the services' typed errors and the global handler give
  describe('error answers', () => {
    it('answers a refused move with 409 and its reason', async () => {
      moves.sendLive.mockRejectedValue(new NewsletterRefusedError('already_sent', 'This issue was already sent to subscribers'))
      moves.deleteNewsletter.mockRejectedValue(new NewsletterRefusedError('sent_issue', 'This issue was sent'))
      moves.sendTest.mockRejectedValue(new TestSegmentNotConfiguredError())

      for (const [method, path] of [
        ['post', '/send-live'],
        ['delete', ''],
        ['post', '/send-test'],
      ] as const) {
        const res = await request(app)[method](api(path)).set(authHeader())
        expect(res.status, path).toBe(409)
        expect(res.body.error, path).toEqual(expect.any(String))
      }
    })

    it('answers 400 and 404 with the service message', async () => {
      moves.generateContent.mockRejectedValue(new BadRequestError('No stories selected'))
      moves.selectStories.mockRejectedValue(new NotFoundError('Newsletter not found'))

      expect((await request(app).post(api('/generate')).set(authHeader())).body).toEqual({ error: 'No stories selected' })
      const res = await request(app).post(api('/select')).set(authHeader())
      expect(res.status).toBe(404)
    })

    it('answers 500 with the route text on an unexpected failure', async () => {
      // No recent stories is not a request error: it stays a 500, as before
      moves.assignStories.mockRejectedValue(new Error('No recent stories to assign'))

      const res = await request(app).post(api('/assign')).set(authHeader())
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to assign stories' })
    })
  })
})
