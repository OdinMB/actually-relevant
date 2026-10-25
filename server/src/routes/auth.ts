import { Router, type Response } from 'express'
import { validateBody } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { authLimiter, refreshLimiter } from '../middleware/rateLimit.js'
import { loginSchema, changePasswordSchema } from '../schemas/auth.js'
import { getUserByEmail, changePassword } from '../services/user.js'
import {
  verifyLoginPassword,
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken,
  RefreshTokenRejectedError,
} from '../services/auth.js'
import { failsWith } from '../middleware/routeErrors.js'
import { getUserById } from '../services/user.js'
import { createLogger } from '../lib/logger.js'
import { config, type CookieSameSite } from '../config.js'

const log = createLogger('auth')

const router = Router()

const REFRESH_COOKIE = 'refresh_token'

function isSecureEnv(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** 'none' only while the API sits on a different site from the admin; see config.auth.cookieSameSite. */
function cookieSameSite(): CookieSameSite {
  return config.auth.cookieSameSite ?? (isSecureEnv() ? 'none' : 'strict')
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isSecureEnv(),
    sameSite: cookieSameSite(),
    maxAge: config.auth.refreshTokenLifetimeMs, // the cookie lives as long as the token it carries
    path: '/api/auth',
  })
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isSecureEnv(),
    sameSite: cookieSameSite(),
    path: '/api/auth',
  })
}

router.post('/login', failsWith('Login failed'), authLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body

  const user = await getUserByEmail(email)
  // Runs bcrypt even without an account, so response time does not reveal which emails exist
  const valid = await verifyLoginPassword(password, user?.passwordHash)
  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const accessToken = generateAccessToken(user)
  const refreshToken = await generateRefreshToken(user.id)

  setRefreshCookie(res, refreshToken)
  res.json({
    accessToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
})

router.post('/refresh', failsWith('Token refresh failed'), refreshLimiter, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (!token) {
    res.status(401).json({ error: 'No refresh token' })
    return
  }

  try {
    const result = await rotateRefreshToken(token)
    setRefreshCookie(res, result.refreshToken)
    res.json({ accessToken: result.accessToken })
  } catch (err) {
    // Clear the cookie only when the token itself was rejected (401 from the global handler). A
    // server-side failure (DB hiccup, restart mid-deploy) keeps it, so the client can retry.
    if (err instanceof RefreshTokenRejectedError) clearRefreshCookie(res)
    throw err
  }
})

router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE]
    if (token) {
      await revokeRefreshToken(token)
    }
    clearRefreshCookie(res)
    res.json({ message: 'Logged out' })
  } catch (err) {
    log.error({ err }, 'logout failed')
    clearRefreshCookie(res)
    res.json({ message: 'Logged out' })
  }
})

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing authorization header' })
      return
    }

    const token = authHeader.slice(7)
    const payload = verifyAccessToken(token)
    const user = await getUserById(payload.userId)
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    res.json(user)
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' })
  }
})

// A wrong current password is an UnauthorizedError (401) from changePassword
router.put('/password', failsWith('Password change failed'), requireAuth, validateBody(changePasswordSchema), async (req, res) => {
  await changePassword(req.user!.userId, req.body.currentPassword, req.body.newPassword)
  res.json({ message: 'Password changed' })
})

export default router
