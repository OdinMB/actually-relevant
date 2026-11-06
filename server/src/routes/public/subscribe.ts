import { Router, type RequestHandler } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../../config.js'
import { validateBody } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import * as subscribeService from '../../services/subscribe.js'
import { switchEdition } from '../../services/editionSwitch.js'
import { EmailValidationError, ConfirmationEmailError, ConfirmationLinkError } from '../../services/subscribe.js'
import { issueFormToken, verifyFormToken } from '../../lib/formToken.js'
import { verifyTurnstile, type TurnstileResult } from '../../lib/turnstile.js'
import { createLogger } from '../../lib/logger.js'

const router = Router()
const log = createLogger('public:subscribe')

const CHECK_EMAIL_MESSAGE = 'Check your email to confirm your subscription.'

const TURNSTILE_MESSAGES: Record<Exclude<TurnstileResult, 'ok'>, string> = {
  failed: "We couldn't verify that you're human. Please try again.",
  unavailable: 'Signups are unavailable right now. Please try again later.',
}

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

// Unknown keys (an old client's firstName) are stripped by zod and never reach the service.
const subscribeSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
  website: z.string().optional(), // honeypot — humans never fill this
  formToken: z.string().optional(),
  turnstileToken: z.string().max(4096).optional(),
  // The edition chosen in the form, offered only while the editions are open (ADR-0052)
  edition: z.enum(['full', 'uplifting']).optional(),
})

const confirmSchema = z.object({
  token: z.string().min(1).max(100),
  email: z.string().trim().email().max(255),
})

// The footer switch link's page posts the contact id Plunk filled into the link (`c`) and the
// edition it offers (`to`); a Plunk id is short, so a long value is refused before Plunk is asked
const editionSwitchSchema = z.object({
  contactId: z.string().trim().min(1).max(100),
  edition: z.enum(['full', 'uplifting']),
})

/**
 * The one signup switch (`SUBSCRIPTIONS_ENABLED`, closed unless 'true'). While paused,
 * the token and signup routes refuse with 503 + SIGNUPS_PAUSED and nothing happens;
 * confirming an already-sent link keeps working.
 */
const requireSignupsOpen: RequestHandler = (_req, res, next) => {
  if (!config.subscribe.enabled) {
    res.status(503).json({ error: 'Newsletter signups are paused.', code: 'SIGNUPS_PAUSED' })
    return
  }
  next()
}

// Issue a short-lived anti-bot form token when the form is rendered. `editionChoice`: the form
// offers the two editions, which it does only while they are open.
router.get('/token', requireSignupsOpen, lightLimiter, (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ token: issueFormToken('subscribe'), editionChoice: config.newsletter.editionsOpen })
})

router.post('/', requireSignupsOpen, subscribeLimiter, subscribeDailyLimiter, validateBody(subscribeSchema), async (req, res) => {
  // Silently accept honeypot-filled submissions (return success so bots aren't tipped off).
  if (req.body.website) {
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
    return
  }

  // Require a valid, appropriately-aged form token. Missing/invalid → silent accept,
  // no Plunk call. This trips naive bots; a script can still fetch a token, which
  // is why Turnstile follows.
  if (!verifyFormToken(req.body.formToken, 'subscribe').ok) {
    log.info('rejected subscribe: missing or invalid form token')
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
    return
  }

  // Turnstile, before any side effect. Unlike the two silent gates above, a person
  // can fail it, so they are told.
  const turnstile = await verifyTurnstile(req.body.turnstileToken, req.ip)
  if (turnstile !== 'ok') {
    res.json({ success: false, message: TURNSTILE_MESSAGES[turnstile] })
    return
  }

  try {
    // A signup over the hourly limit is queued and gets this same reply, as does a
    // still-subscribed or throttled address, so the reply never tells them apart.
    await subscribeService.subscribe({ email: req.body.email, edition: req.body.edition })
    res.json({ success: true, message: CHECK_EMAIL_MESSAGE })
  } catch (err) {
    // Surface real failures to the visitor rather than falsely claiming the email
    // was sent. (A still-subscribed or throttled address returns success earlier,
    // so this path can't leak subscription status — these are genuine errors.)
    if (err instanceof EmailValidationError || err instanceof ConfirmationEmailError) {
      res.json({ success: false, message: err.message })
      return
    }
    log.error({ err }, 'subscribe error')
    res.json({ success: false, message: 'Something went wrong. Please try again.' })
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
  } catch (err) {
    // No address or token in the log (`.context/logging.md`, "Personal data")
    log.warn({ err }, 'confirmation failed')
    const reason = err instanceof ConfirmationLinkError ? err.reason : 'invalid'
    res.json({ success: false, reason })
  }
})

// A reader's click on the footer switch link's page (`services/editionSwitch.ts`). Each switch reads
// and writes a Plunk contact, so it has the signup's per-minute limit as well as the light one.
// Refusals are EditionSwitchErrors with a `code`, which the global handler answers.
router.post(
  '/edition',
  failsWith('Switching editions failed. Please try again later.'),
  lightLimiter,
  subscribeLimiter,
  validateBody(editionSwitchSchema),
  async (req, res) => {
    await switchEdition(req.body.contactId, req.body.edition)
    res.json({ success: true, edition: req.body.edition })
  },
)

export default router
