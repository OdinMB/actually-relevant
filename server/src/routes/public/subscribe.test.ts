import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { TEST_API_KEY } from '../../test/helpers.js'

// Rate limiters become pass-through so they don't interfere with assertions.
vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}))

// Deterministic form-token behavior: only 'valid-token' verifies.
vi.mock('../../lib/formToken.js', () => ({
  issueFormToken: () => 'issued-token',
  verifyFormToken: (t: string | undefined | null) => ({ ok: t === 'valid-token' }),
}))

const mockSubscribe = vi.hoisted(() => vi.fn())
const mockConfirm = vi.hoisted(() => vi.fn())

class EmailValidationError extends Error {}
class EmailVerificationUnavailableError extends Error {}

vi.mock('../../services/subscribe.js', () => ({
  subscribe: (...args: any[]) => mockSubscribe(...args),
  confirmSubscription: (...args: any[]) => mockConfirm(...args),
  EmailValidationError,
  EmailVerificationUnavailableError,
}))

const mockPrisma = vi.hoisted(() => ({ $disconnect: vi.fn() }))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({
  crawlFeed: vi.fn(),
  crawlAllDueFeeds: vi.fn(),
  crawlUrl: vi.fn(),
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')

describe('Public Subscribe API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockResolvedValue(undefined)
    mockConfirm.mockResolvedValue(undefined)
  })

  describe('GET /api/subscribe/token', () => {
    it('issues a token and forbids caching', async () => {
      const res = await request(app).get('/api/subscribe/token')

      expect(res.status).toBe(200)
      expect(res.body.token).toBeTruthy()
      expect(res.headers['cache-control']).toBe('no-store')
    })

    it('is reachable cross-origin (open CORS so the public form can fetch it anywhere)', async () => {
      const res = await request(app)
        .get('/api/subscribe/token')
        .set('Origin', 'https://not-an-allowlisted-origin.example')

      expect(res.status).toBe(200)
      expect(res.headers['access-control-allow-origin']).toBe('*')
    })
  })

  describe('POST /api/subscribe', () => {
    it('subscribes with a valid form token', async () => {
      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'user@example.com', formToken: 'valid-token' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockSubscribe).toHaveBeenCalledWith(expect.objectContaining({ email: 'user@example.com' }))
    })

    it('silently rejects honeypot-filled submissions', async () => {
      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'bot@example.com', website: 'http://spam.com', formToken: 'valid-token' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('silently rejects when the form token is missing', async () => {
      const res = await request(app).post('/api/subscribe').send({ email: 'bot@example.com' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('silently rejects when the form token is invalid', async () => {
      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'bot@example.com', formToken: 'wrong' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('returns success:false with the message on EmailValidationError', async () => {
      mockSubscribe.mockRejectedValue(new EmailValidationError('Please enter a valid email address.'))

      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'user@example.com', formToken: 'valid-token' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toMatch(/valid email/i)
    })

    it('returns success:false when verification is unavailable', async () => {
      mockSubscribe.mockRejectedValue(new EmailVerificationUnavailableError('temporarily unavailable'))

      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'user@example.com', formToken: 'valid-token' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toMatch(/unavailable/i)
    })

    it('returns 400 for an invalid email format', async () => {
      const res = await request(app)
        .post('/api/subscribe')
        .send({ email: 'not-an-email', formToken: 'valid-token' })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/subscribe/confirm (backward-compat redirect)', () => {
    it('redirects to the client page without confirming', async () => {
      const res = await request(app).get('/api/subscribe/confirm').query({ token: 'abc', email: 'u@example.com' })

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('/subscribed')
      expect(res.headers.location).toContain('token=abc')
      expect(res.headers.location).toContain('email=u%40example.com')
      expect(mockConfirm).not.toHaveBeenCalled()
    })

    it('redirects with error=invalid when params are missing', async () => {
      const res = await request(app).get('/api/subscribe/confirm')

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('error=invalid')
      expect(mockConfirm).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/subscribe/confirm', () => {
    it('confirms the subscription', async () => {
      const res = await request(app)
        .post('/api/subscribe/confirm')
        .send({ token: 'abc', email: 'u@example.com' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockConfirm).toHaveBeenCalledWith('abc', 'u@example.com')
    })

    it('reports expired links', async () => {
      mockConfirm.mockRejectedValue(new Error('Confirmation link has expired'))

      const res = await request(app)
        .post('/api/subscribe/confirm')
        .send({ token: 'abc', email: 'u@example.com' })

      expect(res.body).toEqual({ success: false, reason: 'expired' })
    })

    it('reports invalid links', async () => {
      mockConfirm.mockRejectedValue(new Error('Invalid confirmation link'))

      const res = await request(app)
        .post('/api/subscribe/confirm')
        .send({ token: 'abc', email: 'u@example.com' })

      expect(res.body).toEqual({ success: false, reason: 'invalid' })
    })
  })
})
