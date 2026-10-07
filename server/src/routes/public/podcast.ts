/**
 * Public podcast endpoints: the RSS feed that podcast directories poll (`/podcast.xml` on the site,
 * through a Render rewrite), the show with its published episodes as JSON for `/podcast`, and one
 * published episode with its readable transcript for `/podcast/:id/transcript`.
 * Mounted before the shared `apiLimiter` (`routes/public/index.ts`): behind the rewrite every
 * directory crawler may arrive from one proxy address, and a shared bucket would answer them 429.
 * The feed's in-process cache carries that load; the JSON routes keep the limiter.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { sendRepresentation } from '../../lib/httpRepresentation.js'
import { createLogger } from '../../lib/logger.js'
import { apiLimiter } from '../../middleware/rateLimit.js'
import { getFeed } from '../../services/podcastFeed.js'
import { getPublishedEpisode, getPublishedEpisodes } from '../../services/podcastPublish.js'
import { podcastShowInfo, toPublicEpisode, toPublicEpisodeDetail } from '../../services/podcastShow.js'

const router = Router()
const log = createLogger('podcast-feed')

router.get('/feed.xml', async (req, res) => {
  try {
    const feed = await getFeed(getPublishedEpisodes)
    sendRepresentation(req, res, feed, {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${config.feed.cacheMaxAge}`,
    })
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

// One published episode with its readable transcript, for its transcript page; 404 unless published.
router.get('/episodes/:id', apiLimiter, async (req, res) => {
  try {
    const episode = await getPublishedEpisode(req.params.id)
    if (episode) res.json(toPublicEpisodeDetail(episode))
    else res.status(404).json({ error: 'Episode not found' })
  } catch (err) {
    log.error({ err, podcastId: req.params.id }, 'failed to load a podcast episode')
    res.status(500).json({ error: 'Failed to load the episode' })
  }
})

export default router
