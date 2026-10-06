/**
 * Public podcast endpoints: the RSS feed that podcast directories poll (`/podcast.xml` on the site,
 * through a Render rewrite) and the show with its published episodes as JSON for `/podcast`.
 * Mounted before the shared `apiLimiter` (`routes/public/index.ts`): behind the rewrite every
 * directory crawler may arrive from one proxy address, and a shared bucket would answer them 429.
 * The feed's in-process cache carries that load; the JSON route keeps the limiter.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { createLogger } from '../../lib/logger.js'
import { apiLimiter } from '../../middleware/rateLimit.js'
import { getFeedXml } from '../../services/podcastFeed.js'
import { getPublishedEpisodes } from '../../services/podcastPublish.js'
import { podcastShowInfo, toPublicEpisode } from '../../services/podcastShow.js'

const router = Router()
const log = createLogger('podcast-feed')

router.get('/feed.xml', async (_req, res) => {
  try {
    const xml = await getFeedXml(getPublishedEpisodes)
    res.set('Content-Type', 'application/rss+xml; charset=utf-8')
    res.set('Cache-Control', `public, max-age=${config.feed.cacheMaxAge}`)
    res.send(xml)
  } catch (err) {
    log.error({ err }, 'failed to generate the podcast feed')
    res.status(500).json({ error: 'Failed to generate feed' })
  }
})

router.get('/', apiLimiter, async (_req, res) => {
  try {
    const { title, description, feedUrl, artworkUrl, listenLinks } = podcastShowInfo()
    const episodes = await getPublishedEpisodes()
    res.json({ show: { title, description, feedUrl, artworkUrl, listenLinks }, episodes: episodes.map(toPublicEpisode) })
  } catch (err) {
    log.error({ err }, 'failed to list podcast episodes')
    res.status(500).json({ error: 'Failed to load the podcast' })
  }
})

export default router
