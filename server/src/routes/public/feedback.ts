import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateBody } from '../../middleware/validate.js'
import prisma from '../../lib/prisma.js'
import { createLogger } from '../../lib/logger.js'
import { hashFeedbackIp } from '../../lib/feedbackIpHash.js'
import { BadRequestError } from '../../utils/errors.js'
import { FEEDBACK_CATEGORIES } from '../../schemas/feedback.js'

const router = Router()
const log = createLogger('public:feedback')

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
})

router.post('/', failsWith('Something went wrong. Please try again.'), feedbackLimiter, validateBody(feedbackSchema), async (req, res) => {
  // Silently reject honeypot-filled submissions (return success to not tip off bots)
  if (req.body.website) {
    res.json({ success: true })
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
