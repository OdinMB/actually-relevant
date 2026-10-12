import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createHmac } from 'crypto'
import { TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

const mockPrisma = vi.hoisted(() => ({
  feedback: {
    create: vi.fn(),
  },
  $disconnect: vi.fn(),
}))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

// The real hash, behind a spy, so one test can make it report a missing secret.
vi.mock('../../lib/feedbackIpHash.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/feedbackIpHash.js')>()
  return { hashFeedbackIp: vi.fn(actual.hashFeedbackIp) }
})

const TEST_IP_HASH_SECRET = 'test-feedback-ip-hash-secret'

// Set before the app (and config) load; dotenv/config never overrides a set variable.
process.env.PUBLIC_API_KEY = TEST_API_KEY
process.env.FEEDBACK_IP_HASH_SECRET = TEST_IP_HASH_SECRET
process.env.TRUST_PROXY = '1'

const { default: app } = await import('../../app.js')
const { hashFeedbackIp } = await import('../../lib/feedbackIpHash.js')

describe('Public Feedback API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/feedback', () => {
    it('creates feedback successfully', async () => {
      mockPrisma.feedback.create.mockResolvedValue({
        id: 'fb-1',
        category: 'general',
        message: 'Great site!',
        email: null,
        status: 'unread',
      })

      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: 'Great site!' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'general',
          message: 'Great site!',
          email: null,
          ipHash: expect.any(String),
        }),
      })
    })

    it('accepts feedback with email', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-2' })

      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'bug', message: 'Something broke', email: 'user@test.com' })

      expect(res.status).toBe(200)
      expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'bug',
          email: 'user@test.com',
        }),
      })
    })

    it('silently rejects honeypot submissions', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: 'Bot message', website: 'http://spam.com' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
      expect(hashFeedbackIp).not.toHaveBeenCalled()
    })

    it('returns 400 for missing category', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ message: 'No category' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for empty message', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: '' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid category', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'invalid', message: 'Test' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: 'Test', email: 'not-an-email' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for message exceeding max length', async () => {
      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: 'a'.repeat(2001) })

      expect(res.status).toBe(400)
    })

    it('stores the HMAC of the visitor IP under the secret', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-3' })

      await request(app)
        .post('/api/feedback')
        .set('X-Forwarded-For', '198.51.100.4')
        .send({ category: 'general', message: 'Test' })

      const call = mockPrisma.feedback.create.mock.calls[0][0]
      expect(call.data.ipHash).toBe(
        createHmac('sha256', TEST_IP_HASH_SECRET).update('198.51.100.4').digest('hex'),
      )
    })

    it('refuses with 503 and stores nothing when the hash secret is missing', async () => {
      vi.mocked(hashFeedbackIp).mockReturnValueOnce(null)

      const res = await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: 'Test' })

      expect(res.status).toBe(503)
      expect(res.body.error).toEqual(expect.any(String))
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
    })

    it('treats empty email string as null', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-4' })

      await request(app)
        .post('/api/feedback')
        .send({ category: 'general', message: 'Test', email: '' })

      expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: null }),
      })
    })
  })
})
