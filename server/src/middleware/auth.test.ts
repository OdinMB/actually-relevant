import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

// Mock the auth service to avoid needing JWT_SECRET in tests
const mockVerifyAccessToken = vi.hoisted(() => vi.fn())
vi.mock('../services/auth.js', () => ({
  verifyAccessToken: mockVerifyAccessToken,
}))

const { requireAuth, hasValidPublicApiKey, requireRole } = await import('./auth.js')

describe('requireAuth (JWT only)', () => {
  let req: Partial<Request>
  let res: Partial<Response>
  let next: NextFunction
  let jsonFn: ReturnType<typeof vi.fn>
  let statusFn: ReturnType<typeof vi.fn>
  const originalKey = process.env.PUBLIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    jsonFn = vi.fn()
    statusFn = vi.fn().mockReturnValue({ json: jsonFn })
    req = { headers: {} }
    res = { status: statusFn, json: jsonFn } as any
    next = vi.fn()
  })

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.PUBLIC_API_KEY = originalKey
    } else {
      delete process.env.PUBLIC_API_KEY
    }
  })

  it('returns 401 for missing authorization header', () => {
    req.headers = {}
    requireAuth(req as Request, res as Response, next)
    expect(statusFn).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('authenticates via JWT access token', () => {
    mockVerifyAccessToken.mockReturnValue({
      userId: 'user-1',
      email: 'admin@test.com',
      role: 'admin',
    })
    req.headers = { authorization: 'Bearer valid-jwt-token' }

    requireAuth(req as Request, res as Response, next)

    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual({
      userId: 'user-1',
      email: 'admin@test.com',
      role: 'admin',
    })
  })

  it('rejects API key — admin routes are JWT only', () => {
    process.env.PUBLIC_API_KEY = 'test-api-key-123'
    mockVerifyAccessToken.mockImplementation(() => {
      throw new Error('invalid')
    })
    req.headers = { authorization: 'Bearer test-api-key-123' }

    requireAuth(req as Request, res as Response, next)

    expect(statusFn).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for invalid JWT', () => {
    mockVerifyAccessToken.mockImplementation(() => {
      throw new Error('invalid')
    })
    req.headers = { authorization: 'Bearer bad-token' }

    requireAuth(req as Request, res as Response, next)

    expect(statusFn).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('hasValidPublicApiKey', () => {
  const originalKey = process.env.PUBLIC_API_KEY
  const withAuth = (authorization?: string) => ({ headers: authorization === undefined ? {} : { authorization } }) as Request

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.PUBLIC_API_KEY = originalKey
    } else {
      delete process.env.PUBLIC_API_KEY
    }
  })

  it('accepts the PUBLIC_API_KEY sent as a Bearer token', () => {
    process.env.PUBLIC_API_KEY = 'test-api-key-123'
    expect(hasValidPublicApiKey(withAuth('Bearer test-api-key-123'))).toBe(true)
  })

  it('refuses a wrong key, including one of a different length or a prefix of the real one', () => {
    process.env.PUBLIC_API_KEY = 'test-api-key-123'
    expect(hasValidPublicApiKey(withAuth('Bearer wrong-key-000000'))).toBe(false)
    expect(hasValidPublicApiKey(withAuth('Bearer x'))).toBe(false)
    expect(hasValidPublicApiKey(withAuth('Bearer test-api-key-12'))).toBe(false)
    expect(hasValidPublicApiKey(withAuth('Bearer '))).toBe(false)
  })

  it('refuses a request without a Bearer header', () => {
    process.env.PUBLIC_API_KEY = 'test-api-key-123'
    expect(hasValidPublicApiKey(withAuth())).toBe(false)
    expect(hasValidPublicApiKey(withAuth('test-api-key-123'))).toBe(false)
  })

  it('accepts nothing while PUBLIC_API_KEY is unset or empty', () => {
    delete process.env.PUBLIC_API_KEY
    expect(hasValidPublicApiKey(withAuth('Bearer '))).toBe(false)
    process.env.PUBLIC_API_KEY = ''
    expect(hasValidPublicApiKey(withAuth('Bearer '))).toBe(false)
  })
})

describe('requireRole', () => {
  let req: Partial<Request>
  let res: Partial<Response>
  let next: NextFunction
  let jsonFn: ReturnType<typeof vi.fn>
  let statusFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    jsonFn = vi.fn()
    statusFn = vi.fn().mockReturnValue({ json: jsonFn })
    req = { headers: {} }
    res = { status: statusFn, json: jsonFn } as any
    next = vi.fn()
  })

  it('allows matching role', () => {
    ;(req as any).user = { userId: 'u1', email: 'a@b.com', role: 'admin' }
    requireRole('admin')(req as Request, res as Response, next)
    expect(next).toHaveBeenCalled()
  })

  it('allows one of multiple roles', () => {
    ;(req as any).user = { userId: 'u1', email: 'a@b.com', role: 'editor' }
    requireRole('admin', 'editor')(req as Request, res as Response, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 403 for non-matching role', () => {
    ;(req as any).user = { userId: 'u1', email: 'a@b.com', role: 'viewer' }
    requireRole('admin')(req as Request, res as Response, next)
    expect(statusFn).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when no user is set', () => {
    requireRole('admin')(req as Request, res as Response, next)
    expect(statusFn).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })
})
