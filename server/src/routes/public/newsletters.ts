/**
 * The newsletter's public web edition: the archive of published issues and one issue with its
 * stories (`.context/newsletter-podcast.md`, "Web edition"). Only issues whose admin status is
 * `published` appear; anything else is a 404.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateQuery } from '../../middleware/validate.js'
import { publicNewsletterQuerySchema } from '../../schemas/newsletter.js'
import { getPublishedIssue, listPublishedIssues } from '../../services/newsletterArchive.js'

const router = Router()

router.get('/', failsWith('Failed to load the newsletter archive'), validateQuery(publicNewsletterQuerySchema), async (req, res) => {
  const query = req.parsedQuery!
  const result = await listPublishedIssues(query.page ?? 1, query.pageSize ?? 20)
  res.set('Cache-Control', `public, max-age=${config.newsletterArchive.cacheMaxAge}`)
  res.json(result)
})

router.get('/:slug', failsWith('Failed to load the issue'), async (req, res) => {
  const issue = await getPublishedIssue(req.params.slug!)
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }
  res.set('Cache-Control', `public, max-age=${config.newsletterArchive.cacheMaxAge}`)
  res.json(issue)
})

export default router
