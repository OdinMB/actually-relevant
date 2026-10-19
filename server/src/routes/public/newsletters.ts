/**
 * The newsletter's public web edition: the archive of published issues and one issue with its
 * stories (`.context/newsletter-podcast.md`, "Web edition"). Only issues whose admin status is
 * `published` appear; anything else is a 404.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { createLogger } from '../../lib/logger.js'
import { validateQuery } from '../../middleware/validate.js'
import { publicNewsletterQuerySchema } from '../../schemas/newsletter.js'
import { getPublishedIssue, listPublishedIssues } from '../../services/newsletterArchive.js'

const router = Router()
const log = createLogger('public:newsletters')

router.get('/', validateQuery(publicNewsletterQuerySchema), async (req, res) => {
  try {
    const query = req.parsedQuery!
    const result = await listPublishedIssues(query.page ?? 1, query.pageSize ?? 20)
    res.set('Cache-Control', `public, max-age=${config.newsletterArchive.cacheMaxAge}`)
    res.json(result)
  } catch (err) {
    log.error({ err }, 'failed to list newsletter issues')
    res.status(500).json({ error: 'Failed to load the newsletter archive' })
  }
})

router.get('/:slug', async (req, res) => {
  try {
    const issue = await getPublishedIssue(req.params.slug)
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' })
      return
    }
    res.set('Cache-Control', `public, max-age=${config.newsletterArchive.cacheMaxAge}`)
    res.json(issue)
  } catch (err) {
    log.error({ err, slug: req.params.slug }, 'failed to load a newsletter issue')
    res.status(500).json({ error: 'Failed to load the issue' })
  }
})

export default router
