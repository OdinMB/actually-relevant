import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  refreshToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $disconnect: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const originalEnv = process.env.JWT_SECRET

beforeEach(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests'
  vi.clearAllMocks()
})

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.JWT_SECRET = originalEnv
  } else {
    delete process.env.JWT_SECRET
  }
})

const {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  cleanupExpiredTokens,
} = await import('./auth.js')
const { config } = await import('../config.js')

describe('hashPassword / verifyPassword', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('mypassword123')
    expect(hash).not.toBe('mypassword123')
    expect(hash).toMatch(/^\$2[aby]?\$/)
    expect(await verifyPassword('mypassword123', hash)).toBe(true)
  })

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })
})

describe('generateAccessToken / verifyAccessToken', () => {
  it('generates and verifies a JWT', () => {
    const token = generateAccessToken({ id: 'user-1', email: 'a@b.com', role: 'admin' })
    expect(typeof token).toBe('string')

    const payload = verifyAccessToken(token)
    expect(payload.userId).toBe('user-1')
    expect(payload.email).toBe('a@b.com')
    expect(payload.role).toBe('admin')
  })

  it('throws for invalid token', () => {
    expect(() => verifyAccessToken('not.a.valid.token')).toThrow()
  })

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET
    expect(() =>
      generateAccessToken({ id: 'user-1', email: 'a@b.com', role: 'admin' })
    ).toThrow('JWT_SECRET')
  })
})

describe('generateRefreshToken', () => {
  it('creates a refresh token in the database', async () => {
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1', token: 'abc' })

    const token = await generateRefreshToken('user-1')
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(20)
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        token: expect.any(String),
        expiresAt: expect.any(Date),
        familyId: expect.any(String),
      }),
    })
  })

  it('creates token with new familyId when none provided', async () => {
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1', token: 'abc' })

    await generateRefreshToken('user-1')
    const call1 = mockPrisma.refreshToken.create.mock.calls[0][0].data.familyId

    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2', token: 'def' })
    await generateRefreshToken('user-1')
    const call2 = mockPrisma.refreshToken.create.mock.calls[1][0].data.familyId

    // Each call should generate a unique familyId
    expect(typeof call1).toBe('string')
    expect(typeof call2).toBe('string')
    expect(call1).not.toBe(call2)
  })

  it('creates token with provided familyId', async () => {
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1', token: 'abc' })

    await generateRefreshToken('user-1', 'family-123')
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        familyId: 'family-123',
      }),
    })
  })
})

describe('rotateRefreshToken', () => {
  it('soft-rotates old token and creates new with same familyId', async () => {
    const user = { id: 'user-1', email: 'a@b.com', role: 'admin' }
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      token: 'old-token',
      userId: 'user-1',
      familyId: 'family-abc',
      rotatedAt: null,
      user,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    })
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2', token: 'new-token' })

    const result = await rotateRefreshToken('old-token')
    expect(result.accessToken).toBeDefined()
    expect(result.refreshToken).toBeDefined()

    // Soft-rotates atomically: only a row that is not yet rotated is claimed
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', rotatedAt: null },
      data: { rotatedAt: expect.any(Date) },
    })
    expect(mockPrisma.refreshToken.delete).not.toHaveBeenCalled()

    // New token should use same familyId
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-abc',
      }),
    })
  })

  it('throws for invalid token', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null)
    await expect(rotateRefreshToken('bad-token')).rejects.toThrow('Invalid refresh token')
  })

  it('throws for expired token and deletes it', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      token: 'expired-token',
      userId: 'user-1',
      familyId: 'family-abc',
      rotatedAt: null,
      user: { id: 'user-1', email: 'a@b.com', role: 'admin' },
      expiresAt: new Date(Date.now() - 1000),
    })
    mockPrisma.refreshToken.delete.mockResolvedValue({})

    await expect(rotateRefreshToken('expired-token')).rejects.toThrow('Refresh token expired')
    expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt-1' } })
  })

  it('detects reuse when token was rotated before the grace window and revokes entire family', async () => {
    const user = { id: 'user-1', email: 'a@b.com', role: 'admin' }
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      token: 'reused-token',
      userId: 'user-1',
      familyId: 'family-abc',
      rotatedAt: new Date(Date.now() - config.auth.refreshReuseGraceMs - 1000),
      user,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    })
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 })

    await expect(rotateRefreshToken('reused-token')).rejects.toThrow(
      'Refresh token reuse detected'
    )
  })

  it('reuse detection revokes all tokens in the family via deleteMany', async () => {
    const user = { id: 'user-1', email: 'a@b.com', role: 'admin' }
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      token: 'reused-token',
      userId: 'user-1',
      familyId: 'family-abc',
      rotatedAt: new Date(Date.now() - config.auth.refreshReuseGraceMs - 1000),
      user,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    })
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 })

    try {
      await rotateRefreshToken('reused-token')
    } catch {
      // expected
    }

    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { familyId: 'family-abc' },
    })
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled()
  })

  it('treats a token rotated within the grace window as a lost response, not theft', async () => {
    const user = { id: 'user-1', email: 'a@b.com', role: 'admin' }
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      token: 'just-rotated',
      userId: 'user-1',
      familyId: 'family-abc',
      rotatedAt: new Date(Date.now() - config.auth.refreshReuseGraceMs + 5000),
      user,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    })
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-3', token: 'newer' })

    const result = await rotateRefreshToken('just-rotated')

    expect(result.accessToken).toBeDefined()
    expect(result.refreshToken).toBeDefined()
    expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ familyId: 'family-abc' }),
    })
  })

  it('serves a request that lost the rotation race to a concurrent one from the same family', async () => {
    const user = { id: 'user-1', email: 'a@b.com', role: 'admin' }
    const row = {
      id: 'rt-1',
      token: 'raced',
      userId: 'user-1',
      familyId: 'family-abc',
      rotatedAt: null as Date | null,
      user,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    }
    mockPrisma.refreshToken.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, rotatedAt: new Date() })
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-3', token: 'newer' })

    const result = await rotateRefreshToken('raced')

    expect(result.refreshToken).toBeDefined()
    expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ familyId: 'family-abc' }),
    })
  })

  it('refuses a token that was revoked between its read and its rotation', async () => {
    mockPrisma.refreshToken.findUnique
      .mockResolvedValueOnce({
        id: 'rt-1',
        token: 'revoked-meanwhile',
        userId: 'user-1',
        familyId: 'family-abc',
        rotatedAt: null,
        user: { id: 'user-1', email: 'a@b.com', role: 'admin' },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      })
      .mockResolvedValueOnce(null)
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(rotateRefreshToken('revoked-meanwhile')).rejects.toThrow('Invalid refresh token')
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled()
  })
})

describe('revokeRefreshToken', () => {
  it('ends the whole login session: deletes every token of the presented token\'s family', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt-2', familyId: 'family-abc' })
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 })
    await revokeRefreshToken('some-token')
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { familyId: 'family-abc' } })
  })

  it('does nothing for an unknown token', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null)
    await revokeRefreshToken('unknown')
    expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled()
  })
})

describe('revokeAllUserTokens', () => {
  it('deletes all tokens for user', async () => {
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 })
    await revokeAllUserTokens('user-1')
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
  })
})

describe('cleanupExpiredTokens', () => {
  it('deletes tokens with expiresAt in the past', async () => {
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 5 })
    const count = await cleanupExpiredTokens()
    expect(count).toBe(5)
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    })
  })

  it('returns 0 when no expired tokens exist', async () => {
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 })
    const count = await cleanupExpiredTokens()
    expect(count).toBe(0)
  })
})
