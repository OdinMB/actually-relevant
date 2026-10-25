import { Router } from 'express'
import * as feedService from '../../services/feed.js'
import { fetchFavicon, fetchAllFavicons } from '../../services/favicon.js'
import { crawlFeed, crawlAllDueFeeds } from '../../services/crawler.js'
import { validateBody } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { createFeedSchema, updateFeedSchema } from '../../schemas/feed.js'

// Errors: an issueId naming no issue is a BadRequestError (400) from the feed service; the global
// handler in app.ts answers it, and failsWith() names each route's 500 and Prisma texts.
const router = Router()
const feedErrors = { notFound: 'Feed not found', duplicate: 'A feed with this RSS URL already exists' }

router.get('/', failsWith('Failed to fetch feeds'), async (req, res) => {
  const filters: { issueId?: string; active?: boolean } = {}
  if (req.query.issueId) filters.issueId = req.query.issueId as string
  if (req.query.active !== undefined) filters.active = req.query.active === 'true'
  res.json(await feedService.getFeeds(filters))
})

router.get('/quality', failsWith('Failed to fetch quality metrics'), async (_req, res) => {
  const metrics = await feedService.getAllFeedQualityMetrics()
  // Convert Map to plain object for JSON serialization
  const obj: Record<string, feedService.FeedQualityMetrics> = {}
  for (const [id, m] of metrics) obj[id] = m
  res.json(obj)
})

router.get('/:id', failsWith('Failed to fetch feed'), async (req, res) => {
  const feed = await feedService.getFeedById(req.params.id!)
  if (!feed) {
    res.status(404).json({ error: 'Feed not found' })
    return
  }
  res.json(feed)
})

router.post('/', failsWith('Failed to create feed', feedErrors), validateBody(createFeedSchema), async (req, res) => {
  res.status(201).json(await feedService.createFeed(req.body))
})

router.put('/:id', failsWith('Failed to update feed', feedErrors), validateBody(updateFeedSchema), async (req, res) => {
  res.json(await feedService.updateFeed(req.params.id!, req.body))
})

router.delete('/:id', failsWith('Failed to delete feed', feedErrors), async (req, res) => {
  const result = await feedService.deleteFeed(req.params.id!)
  const message = result.action === 'deleted' ? 'Feed deleted' : 'Feed deactivated (has linked stories)'
  res.json({ action: result.action, message })
})

router.post('/:id/crawl', failsWith('Failed to crawl feed'), async (req, res) => {
  const feed = await feedService.getFeedById(req.params.id!)
  if (!feed) {
    res.status(404).json({ error: 'Feed not found' })
    return
  }
  res.json(await crawlFeed(req.params.id!))
})

router.post('/:id/favicon', failsWith('Failed to fetch favicon'), async (req, res) => {
  const feed = await feedService.getFeedById(req.params.id!)
  if (!feed) {
    res.status(404).json({ error: 'Feed not found' })
    return
  }
  res.json(await fetchFavicon(feed.id, feed.rssUrl, feed.url, true))
})

router.post('/fetch-favicons', failsWith('Failed to fetch favicons'), async (_req, res) => {
  res.json(await fetchAllFavicons())
})

router.post('/crawl-all', failsWith('Failed to crawl feeds'), async (_req, res) => {
  res.json(await crawlAllDueFeeds())
})

export default router
