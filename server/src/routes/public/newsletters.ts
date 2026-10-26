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
import { getPublishedIssue, listPublishedIssues, newsletterIssueUrl } from '../../services/newsletterArchive.js'
import { NEWSLETTER_TOP_LABEL, rssChannelDescription } from '../../lib/aiLabelCopy.js'
import { buildFeed, setRssHeaders } from '../../lib/rssFeed.js'

/** Where the newsletter feed is served on the API (the client links `${API_BASE}/newsletters/feed.xml`). */
export const NEWSLETTER_FEED_PATH = '/api/newsletters/feed.xml'

const router = Router()

router.get('/', failsWith('Failed to load the newsletter archive'), validateQuery(publicNewsletterQuerySchema), async (req, res) => {
  const query = req.parsedQuery!
  const result = await listPublishedIssues(query.page ?? 1, query.pageSize ?? 20)
  res.set('Cache-Control', `public, max-age=${config.newsletterArchive.cacheMaxAge}`)
  res.json(result)
})

/**
 * RSS of the published issues, newest first: one item per issue, linking its web edition. RSS
 * readers never see the site's labels, so each item description is the issue's AI label.
 * Routed before `/:slug` (a slug never has a dot, but the order keeps it unambiguous).
 */
router.get('/feed.xml', failsWith('Failed to generate the newsletter feed'), async (_req, res) => {
  const { data } = await listPublishedIssues(1, config.feed.size)
  const feed = buildFeed({
    title: 'Actually Relevant — Newsletter',
    description: rssChannelDescription('Weekly newsletter'),
    feedPath: NEWSLETTER_FEED_PATH,
    link: `${config.siteUrl}/newsletter`,
  })
  for (const issue of data) {
    const url = newsletterIssueUrl(issue.slug)
    feed.addItem({
      title: issue.title,
      id: url,
      link: url,
      description: `${NEWSLETTER_TOP_LABEL.lead} ${NEWSLETTER_TOP_LABEL.text}`,
      date: new Date(issue.publishedAt),
    })
  }
  setRssHeaders(res)
  res.send(feed.rss2())
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
