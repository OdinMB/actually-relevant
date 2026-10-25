import type { Request, Response, NextFunction } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { config } from '../config.js'
import { verifyAccessToken, type AccessTokenPayload } from '../services/auth.js'

export interface AuthUser {
  userId: string
  email: string
  role: string
}

declare global {
  namespace Express {
    interface Request {
      id?: string
      user?: AuthUser
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each route's own Zod schema shapes it; routes read it untyped
      parsedQuery?: Record<string, any>
    }
  }
}

/**
 * Try to authenticate via JWT access token.
 * Returns the payload if valid, null otherwise.
 */
function tryJwtAuth(token: string): AccessTokenPayload | null {
  try {
    return verifyAccessToken(token)
  } catch {
    return null
  }
}

/**
 * Whether the request carries the static PUBLIC_API_KEY as `Authorization: Bearer <key>`. A valid
 * key only raises the public API's rate limit (middleware/rateLimit.ts); it never authenticates
 * anyone. Unset or empty: no key is valid. Both sides are hashed to the same length first, so the
 * constant-time comparison does not reveal the key's length either.
 */
export function hasValidPublicApiKey(req: Request): boolean {
  const apiKey = config.auth.publicApiKey
  if (!apiKey) return false
  const token = extractBearerToken(req)
  if (token === null) return false

  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(token), digest(apiKey))
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

/**
 * Admin authentication middleware (JWT only).
 * Used for admin routes — API key is not accepted.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req)

  if (!token) {
    res.status(401).json({ error: 'Missing authorization header' })
    return
  }

  const jwtPayload = tryJwtAuth(token)
  if (jwtPayload) {
    req.user = {
      userId: jwtPayload.userId,
      email: jwtPayload.email,
      role: jwtPayload.role,
    }
    next()
    return
  }

  res.status(401).json({ error: 'Invalid credentials' })
}

/**
 * Role check middleware. Use after requireAuth.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}
