import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../../config.js'
import { validateBody } from '../../middleware/validate.js'
import * as subscribeService from '../../services/subscribe.js'
import { EmailValidationError, EmailVerificationUnavailableError } from '../../services/subscribe.js'
import { issueFormToken, verifyFormToken } from '../../lib/formToken.js'
import { createLogger } from '../../lib/logger.js'

const router = Router()
const log = createLogger('public:subscribe')

const CHECK_EMAIL_MESSAGE = 'Check your email to confirm your subscription.'

// Burst limiter for the costly signup POST (creates pending row + sends email).
const subscribeLimiter = rateLimit({
  windowMs: config.subscribe.rateLimitWindowMs,
  max: config.subscribe.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many subscription attempts. Please try again later.' },
})

// Sustained per-IP cap on top of the burst limiter, to blunt rotating-burst bots.
const subscribeDailyLimiter = rateLimit({
  windowMs: config.subscribe.rateLimitDailyWindowMs,
  max: config.subscribe.rateLimitDailyMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many subscription attempts. Please try again later.' },
})

// Generous limiter for cheap/benign endpoints (token issuance + confirm click).
// A single page visit may fetch a token a few times (navigation, StrictMode, retry),
// so this must not be as tight as the signup burst limiter.
const lightLimiter = rateLimit({
  windowMs: config.rateLimit.publicWindowMs,
  max: config.rateLimit.publicMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const subscribeSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  firstName: z.string().max(100).optional(),
  website: z.string().optional(), // honeypot — humans never fill this
  formToken: z.string().optional(),
})

const confirmSchema = z.object({
  token: z.string().min(1).max(100),
  email: z.string().email().max(255),
})

// Issue a short-lived anti-bot form token when the form is rendered.
router.get('/token', lightLimiter, (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ token: issueFormToken() })
})

router.post('/', subscribeLimiter, subscribeDailyLimiter, validateBody(subscribeSchema), async (req, res) => {
  // Silently accept honeypot-filled submissions (return success so bots aren't tipped off).
  if (req.body.website) {
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
    return
  }

  // Require a valid, appropriately-aged form token. Missing/invalid → silent accept,
  // no Plunk call. This blocks scripts that POST directly without loading the form.
  if (!verifyFormToken(req.body.formToken).ok) {
    log.info('rejected subscribe: missing or invalid form token')
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
    return
  }

  try {
    const { email, firstName } = req.body
    await subscribeService.subscribe({ email, firstName })
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
  } catch (err) {
    if (err instanceof EmailValidationError || err instanceof EmailVerificationUnavailableError) {
      res.json({ success: false, message: err.message })
      return
    }
    log.error({ err }, 'subscribe error')
    // Still return success to avoid leaking whether an email exists
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
  }
})

// Backward-compat for already-sent emails whose links point here. This NO LONGER
// confirms — it only redirects to the client confirmation page (scanner-safe).
// Confirmation happens via POST /confirm (a human button click).
router.get('/confirm', lightLimiter, (req, res) => {
  const { token, email } = req.query as { token?: string; email?: string }
  const url = new URL('/subscribed', config.clientUrl)
  if (!token || !email) {
    url.searchParams.set('error', 'invalid')
  } else {
    url.searchParams.set('token', token)
    url.searchParams.set('email', email)
  }
  res.redirect(url.toString())
})

router.post('/confirm', lightLimiter, validateBody(confirmSchema), async (req, res) => {
  const { token, email } = req.body
  try {
    await subscribeService.confirmSubscription(token, email)
    res.json({ success: true })
  } catch (err: any) {
    log.warn({ err, email }, 'confirmation failed')
    const reason = err?.message === 'Confirmation link has expired' ? 'expired' : 'invalid'
    res.json({ success: false, reason })
  }
})

export default router
