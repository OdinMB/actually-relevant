import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createHmac } from 'crypto'
import { TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

// Deterministic form tokens: only 'valid-token' verifies, and only for the feedback form.
const mockFormToken = vi.hoisted(() => ({
  issueFormToken: vi.fn((form: string) => `issued-${form}`),
  verifyFormToken: vi.fn((t: string | undefined | null, form: string) => ({ ok: t === 'valid-token' && form === 'feedback' })),
}))
vi.mock('../../lib/formToken.js', () => mockFormToken)

const mockVerifyTurnstile = vi.hoisted(() => vi.fn())
vi.mock('../../lib/turnstile.js', () => ({
  verifyTurnstile: (...args: any[]) => mockVerifyTurnstile(...args),
}))

const mockPrisma = vi.hoisted(() => ({
  feedback: {
    create: vi.fn(),
  },
  story: {
    findUnique: vi.fn(),
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
vi.mock('../../lib/feedbackIpHash.js', async importOriginal => {
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

/** A submission that passes the bot gate unless the body overrides its tokens. */
function post(body: Record<string, unknown>) {
  return request(app)
    .post('/api/feedback')
    .send({ formToken: 'valid-token', turnstileToken: 'ts-token', ...body })
}

describe('Public Feedback API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyTurnstile.mockResolvedValue('ok')
  })

  describe('GET /api/feedback/token', () => {
    it('issues an uncached form token for the feedback form', async () => {
      const res = await request(app).get('/api/feedback/token')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ token: 'issued-feedback' })
      expect(res.headers['cache-control']).toBe('no-store')
      expect(mockFormToken.issueFormToken).toHaveBeenCalledWith('feedback')
    })
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

      const res = await post({ category: 'general', message: 'Great site!' })

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

      const res = await post({ category: 'bug', message: 'Something broke', email: 'user@test.com' })

      expect(res.status).toBe(200)
      expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'bug',
          email: 'user@test.com',
        }),
      })
    })

    it('silently rejects honeypot submissions', async () => {
      const res = await post({ category: 'general', message: 'Bot message', website: 'http://spam.com' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
      expect(hashFeedbackIp).not.toHaveBeenCalled()
      expect(mockVerifyTurnstile).not.toHaveBeenCalled()
    })

    it('returns 400 for missing category', async () => {
      const res = await post({ message: 'No category' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for empty message', async () => {
      const res = await post({ category: 'general', message: '' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid category', async () => {
      const res = await post({ category: 'invalid', message: 'Test' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid email format', async () => {
      const res = await post({ category: 'general', message: 'Test', email: 'not-an-email' })

      expect(res.status).toBe(400)
    })

    it('returns 400 for message exceeding max length', async () => {
      const res = await post({ category: 'general', message: 'a'.repeat(2001) })

      expect(res.status).toBe(400)
    })

    it('stores the HMAC of the visitor IP under the secret', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-3' })

      await post({ category: 'general', message: 'Test' }).set('X-Forwarded-For', '198.51.100.4')

      const call = mockPrisma.feedback.create.mock.calls[0][0]
      expect(call.data.ipHash).toBe(createHmac('sha256', TEST_IP_HASH_SECRET).update('198.51.100.4').digest('hex'))
    })

    it('refuses with 503 and stores nothing when the hash secret is missing', async () => {
      vi.mocked(hashFeedbackIp).mockReturnValueOnce(null)

      const res = await post({ category: 'general', message: 'Test' })

      expect(res.status).toBe(503)
      expect(res.body.error).toEqual(expect.any(String))
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
    })

    it('treats empty email string as null', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-4' })

      await post({ category: 'general', message: 'Test', email: '' })

      expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: null }),
      })
    })

    it('stores no story for feedback sent without one', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-5' })
      await post({ category: 'general', message: 'Test' })
      expect(mockPrisma.story.findUnique).not.toHaveBeenCalled()
      expect(mockPrisma.feedback.create.mock.calls[0][0].data.storyId).toBeNull()
    })
  })

  describe('POST /api/feedback bot gate', () => {
    it.each([
      ['missing', undefined],
      ['invalid', 'forged-token'],
    ])('silently accepts a %s form token and stores nothing', async (_label, formToken) => {
      const res = await post({ category: 'general', message: 'Test', formToken })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
      expect(mockVerifyTurnstile).not.toHaveBeenCalled()
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
    })

    it('checks the form token against the feedback form, so a signup token does not pass', async () => {
      await post({ category: 'general', message: 'Test' })
      expect(mockFormToken.verifyFormToken).toHaveBeenCalledWith('valid-token', 'feedback')
    })

    it('verifies Turnstile with the visitor IP, skipping it while no secret is set', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-8' })

      await post({ category: 'general', message: 'Test' }).set('X-Forwarded-For', '198.51.100.4')

      expect(mockVerifyTurnstile).toHaveBeenCalledWith('ts-token', '198.51.100.4', { skipWithoutSecret: true })
      expect(mockPrisma.feedback.create).toHaveBeenCalled()
    })

    it('tells a visitor who fails the human check, and stores nothing', async () => {
      mockVerifyTurnstile.mockResolvedValue('failed')

      const res = await post({ category: 'general', message: 'Test' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: false, message: "We couldn't verify that you're human. Please try again." })
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
    })

    it('refuses while siteverify is unreachable (fail closed), and stores nothing', async () => {
      mockVerifyTurnstile.mockResolvedValue('unavailable')

      const res = await post({ category: 'general', message: 'Test' })

      expect(res.body).toEqual({ success: false, message: 'Feedback is unavailable right now. Please try again later.' })
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
    })

    it('rejects an overlong Turnstile token', async () => {
      const res = await post({ category: 'general', message: 'Test', turnstileToken: 'a'.repeat(4097) })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/feedback with a story ("Report an error")', () => {
    it('stores a correction tied to the story it was sent from', async () => {
      mockPrisma.story.findUnique.mockResolvedValue({ id: 'story-1' })
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-6' })

      const res = await post({ category: 'correction', message: 'The date is wrong', storyId: 'story-1' })

      expect(res.status).toBe(200)
      expect(mockPrisma.story.findUnique).toHaveBeenCalledWith({ where: { id: 'story-1' }, select: { id: true } })
      expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: 'correction', message: 'The date is wrong', storyId: 'story-1' }),
      })
    })

    it('refuses a story that does not exist, and stores nothing', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(null)

      const res = await post({ category: 'correction', message: 'Wrong', storyId: 'nope' })

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'That story does not exist.' })
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled()
    })

    it('accepts the correction category without a story too', async () => {
      mockPrisma.feedback.create.mockResolvedValue({ id: 'fb-7' })
      const res = await post({ category: 'correction', message: 'A typo on the about page' })
      expect(res.status).toBe(200)
    })

    it('rejects an overlong story id', async () => {
      const res = await post({ category: 'correction', message: 'x', storyId: 'a'.repeat(101) })
      expect(res.status).toBe(400)
      expect(mockPrisma.story.findUnique).not.toHaveBeenCalled()
    })
  })
})
