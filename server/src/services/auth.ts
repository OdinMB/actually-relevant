import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes, randomUUID } from 'crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { UnauthorizedError } from '../utils/errors.js'

/**
 * The refresh token itself was rejected (unknown, expired, or reused after the grace window):
 * 401, and the route clears the cookie. Any other failure keeps the cookie so the client can retry.
 */
export class RefreshTokenRejectedError extends UnauthorizedError {}

export interface AccessTokenPayload {
  userId: string
  email: string
  role: string
}

function getJwtSecret(): string {
  const secret = config.auth.jwtSecret
  if (!secret) throw new Error('JWT_SECRET environment variable is not set')
  return secret
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptRounds)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// A hash of a random password at the same cost, computed once, so a login for an unknown email
// spends the same bcrypt time as one for a known email and cannot reveal which emails have accounts.
let dummyHash: Promise<string> | null = null

/**
 * Check a login password against the account's hash, or against a dummy hash when there is no
 * account (always false then), so both cases take the same time.
 */
export async function verifyLoginPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (hash) return bcrypt.compare(plain, hash)
  dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), config.auth.bcryptRounds)
  await bcrypt.compare(plain, await dummyHash)
  return false
}

export function generateAccessToken(user: { id: string; email: string; role: string }): string {
  const payload: AccessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  }
  return jwt.sign(payload, getJwtSecret(), { expiresIn: config.auth.accessTokenExpiry })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as AccessTokenPayload
}

export async function generateRefreshToken(userId: string, familyId?: string): Promise<string> {
  const token = randomBytes(40).toString('hex')
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenLifetimeMs)
  const family = familyId ?? randomUUID()

  await prisma.refreshToken.create({
    data: { token, userId, expiresAt, familyId: family },
  })

  return token
}

export async function rotateRefreshToken(oldToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const record = await prisma.refreshToken.findUnique({
    where: { token: oldToken },
    include: { user: true },
  })

  if (!record) throw new RefreshTokenRejectedError('Invalid refresh token')
  if (record.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: record.id } })
    throw new RefreshTokenRejectedError('Refresh token expired')
  }

  if (record.rotatedAt) {
    // Reuse detection: a token rotated long ago coming back is a sign of theft,
    // so the whole login session (family) is revoked. Within the grace window it
    // is a lost response or a second tab, and gets a fresh token in the family.
    if (!isWithinReuseGrace(record.rotatedAt)) {
      await prisma.refreshToken.deleteMany({ where: { familyId: record.familyId } })
      throw new RefreshTokenRejectedError('Refresh token reuse detected')
    }
    return issueTokenPair(record.user, record.familyId)
  }

  // Soft-rotate atomically: only one request can claim a not-yet-rotated row
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: record.id, rotatedAt: null },
    data: { rotatedAt: new Date() },
  })
  if (claimed.count === 0) {
    // A concurrent request rotated or revoked it between our read and write
    const current = await prisma.refreshToken.findUnique({ where: { id: record.id } })
    if (!current?.rotatedAt || !isWithinReuseGrace(current.rotatedAt)) {
      throw new RefreshTokenRejectedError('Invalid refresh token')
    }
  }

  return issueTokenPair(record.user, record.familyId)
}

function isWithinReuseGrace(rotatedAt: Date): boolean {
  return Date.now() - rotatedAt.getTime() <= config.auth.refreshReuseGraceMs
}

async function issueTokenPair(user: { id: string; email: string; role: string }, familyId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = generateAccessToken(user)
  const refreshToken = await generateRefreshToken(user.id, familyId)
  return { accessToken, refreshToken }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  // Logout ends the whole login session, so a predecessor token still inside
  // its reuse grace window cannot revive it.
  const record = await prisma.refreshToken.findUnique({ where: { token } })
  if (!record) return
  await prisma.refreshToken.deleteMany({ where: { familyId: record.familyId } })
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } })
}

export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
