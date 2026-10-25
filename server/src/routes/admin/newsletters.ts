import { Router } from 'express'
import { createReadStream, unlinkSync } from 'fs'
import { createLogger } from '../../lib/logger.js'
import * as newsletterService from '../../services/newsletter.js'
import * as lifecycle from '../../services/newsletterLifecycle.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { expensiveOpLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { createNewsletterSchema, updateNewsletterSchema, newsletterQuerySchema, sendLiveSchema } from '../../schemas/newsletter.js'

// Reads go to newsletter.ts; every write is a move of newsletterLifecycle.ts. Errors: the services
// throw ServiceErrors ("Newsletter not found" 404, "No stories selected" 400, a refused move
// (NewsletterRefusedError) or TestSegmentNotConfiguredError 409, …) and the global handler in
// app.ts answers; failsWith() names each route's 500 text and its Prisma not-found text.
const router = Router()
const log = createLogger('newsletters')
const newsletterNotFound = { notFound: 'Newsletter not found' }

router.get('/', failsWith('Failed to fetch newsletters'), validateQuery(newsletterQuerySchema), async (req, res) => {
  res.json(await newsletterService.getNewsletters(req.parsedQuery || {}))
})

router.get('/:id', failsWith('Failed to fetch newsletter'), async (req, res) => {
  const newsletter = await newsletterService.getNewsletterById(req.params.id!)
  if (!newsletter) {
    res.status(404).json({ error: 'Newsletter not found' })
    return
  }
  res.json(newsletter)
})

router.post('/', failsWith('Failed to create newsletter'), validateBody(createNewsletterSchema), async (req, res) => {
  res.status(201).json(await newsletterService.createNewsletter(req.body))
})

// The fields, then the status: two moves, so a sent issue can be unpublished but not edited
router.put('/:id', failsWith('Failed to update newsletter', newsletterNotFound), validateBody(updateNewsletterSchema), async (req, res) => {
  const id = req.params.id!
  const { status, ...fields } = req.body as { status?: 'draft' | 'published' } & lifecycle.NewsletterEdit
  let newsletter = await lifecycle.editNewsletter(id, fields)
  if (status === 'published') newsletter = await lifecycle.publishNewsletter(id)
  else if (status === 'draft') newsletter = await lifecycle.unpublishNewsletter(id)
  res.json(newsletter)
})

router.delete('/:id', failsWith('Failed to delete newsletter', newsletterNotFound), async (req, res) => {
  await lifecycle.deleteNewsletter(req.params.id!)
  res.status(204).send()
})

router.post('/:id/assign', failsWith('Failed to assign stories', newsletterNotFound), async (req, res) => {
  res.json(await lifecycle.assignStories(req.params.id!))
})

router.post('/:id/select', failsWith('Failed to select stories', newsletterNotFound), expensiveOpLimiter, async (req, res) => {
  res.json(await lifecycle.selectStories(req.params.id!))
})

router.post('/:id/generate', failsWith('Failed to generate newsletter content', newsletterNotFound), expensiveOpLimiter, async (req, res) => {
  res.json(await lifecycle.generateContent(req.params.id!))
})

router.post('/:id/carousel', failsWith('Failed to generate carousel images', newsletterNotFound), async (req, res) => {
  const zipPath = await newsletterService.generateCarouselForNewsletter(req.params.id!)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename=carousel_images.zip')
  const stream = createReadStream(zipPath)
  stream.on('error', err => {
    log.error({ err, zipPath }, 'failed to stream carousel images')
    res.destroy(err)
  })
  stream.pipe(res)
  stream.on('end', () => {
    try {
      unlinkSync(zipPath)
    } catch {
      /* ignore */
    }
  })
})

// --- HTML generation ---

router.post('/:id/html', failsWith('Failed to generate HTML content', newsletterNotFound), async (req, res) => {
  res.json({ html: await lifecycle.generateHtml(req.params.id!) })
})

// --- Send endpoints ---

router.post('/:id/send-test', failsWith('Failed to send test newsletter', newsletterNotFound), async (req, res) => {
  res.json(await lifecycle.sendTest(req.params.id!))
})

router.post('/:id/send-live', failsWith('Failed to send live newsletter', newsletterNotFound), validateBody(sendLiveSchema), async (req, res) => {
  res.json(await lifecycle.sendLive(req.params.id!, req.body.scheduledFor))
})

// --- Send history & stats ---

router.get('/:id/sends', failsWith('Failed to fetch sends'), async (req, res) => {
  res.json(await newsletterService.getNewsletterSends(req.params.id!))
})

router.post('/:id/sends/:sendId/refresh-stats', failsWith('Failed to refresh stats'), async (req, res) => {
  res.json(await newsletterService.refreshSendStats(req.params.sendId!))
})

/** An editor checked Plunk: the unconfirmed live send did not go out (409 for any other send). */
router.post('/:id/sends/:sendId/mark-failed', failsWith('Failed to mark the send as not sent'), async (req, res) => {
  res.json(await lifecycle.markSendFailed(req.params.id!, req.params.sendId!))
})

export default router
