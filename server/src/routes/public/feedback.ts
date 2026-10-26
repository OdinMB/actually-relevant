import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateBody } from '../../middleware/validate.js'
import prisma from '../../lib/prisma.js'
import { createLogger } from '../../lib/logger.js'
import { hashFeedbackIp } from '../../lib/feedbackIpHash.js'
import { issueFormToken, verifyFormToken } from '../../lib/formToken.js'
import { verifyTurnstile, type TurnstileResult } from '../../lib/turnstile.js'
import { BadRequestError } from '../../utils/errors.js'
import { FEEDBACK_CATEGORIES } from '../../schemas/feedback.js'

const router = Router()
const log = createLogger('public:feedback')

const TURNSTILE_MESSAGES: Record<Exclude<TurnstileResult, 'ok'>, string> = {
  failed: "We couldn't verify that you're human. Please try again.",
  unavailable: 'Feedback is unavailable right now. Please try again later.',
}

const feedbackLimiter = rateLimit({
  windowMs: config.feedback.rateLimitWindowMs,
  max: config.feedback.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions. Please try again later.' },
})

const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  // The story a "Report an error" was sent from (.context/public-website.md, "Feedback"); must exist
  storyId: z.string().min(1).max(100).optional(),
  message: z.string().min(1).max(config.feedback.messageMaxLength),
  email: z.string().email().max(255).optional().or(z.literal('')),
  website: z.string().optional(), // honeypot field
  formToken: z.string().optional(),
  turnstileToken: z.string().max(4096).optional(),
})

// Issue a short-lived anti-bot form token when the form is rendered (the signup's gate,
// .context/subscription.md). The shared public limiter covers it.
router.get('/token', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ token: issueFormToken('feedback') })
})

router.post('/', failsWith('Something went wrong. Please try again.'), feedbackLimiter, validateBody(feedbackSchema), async (req, res) => {
  // Silently reject honeypot-filled submissions (return success to not tip off bots)
  if (req.body.website) {
    res.json({ success: true })
    return
  }

  // A missing, invalid, too-young or too-old form token, or one issued for the signup:
  // silent success, nothing stored, as for the signup.
  if (!verifyFormToken(req.body.formToken, 'feedback').ok) {
    log.info('rejected feedback: missing or invalid form token')
    res.json({ success: true })
    return
  }

  // Turnstile, before anything is stored. Skipped while TURNSTILE_SECRET_KEY is unset, in
  // production too (the signup refuses instead), so feedback works until the widget exists.
  const turnstile = await verifyTurnstile(req.body.turnstileToken, req.ip, { skipWithoutSecret: true })
  if (turnstile !== 'ok') {
    res.json({ success: false, message: TURNSTILE_MESSAGES[turnstile] })
    return
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const ipHash = hashFeedbackIp(ip)
  if (ipHash === null) {
    res.status(503).json({ error: 'Feedback is unavailable right now. Please try again later.' })
    return
  }

  const { category, message, email, storyId } = req.body as z.infer<typeof feedbackSchema>

  if (storyId) {
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { id: true } })
    if (!story) throw new BadRequestError('That story does not exist.')
  }

  await prisma.feedback.create({
    data: {
      category,
      message,
      email: email || null,
      ipHash,
      storyId: storyId ?? null,
    },
  })

  log.info({ category, hasEmail: !!email, hasStory: !!storyId }, 'feedback submitted')
  res.json({ success: true })
})

export default router
