/**
 * Public podcast endpoints: each show's RSS feed that podcast directories poll (`/podcast.xml` and
 * `/podcast-uplifting.xml` on the site, through Render rewrites), a show with its published episodes
 * as JSON for `/podcast` and `/podcast/uplifting`, and one published episode with its readable
 * transcript for `/podcast/:id/transcript`. Actually Uplifting's feed and JSON answer 404 while the
 * show is closed (`podcastEdition.ts`).
 * Mounted before the shared `apiLimiter` (`routes/public/index.ts`): behind the rewrite every
 * directory crawler may arrive from one proxy address, and a shared bucket would answer them 429.
 * The feed's in-process cache carries that load; the JSON routes keep the limiter.
 */
import { Router, type Request, type Response } from 'express'
import type { PodcastEdition } from '@prisma/client'
import { config } from '../../config.js'
import { sendRepresentation } from '../../lib/httpRepresentation.js'
import { apiLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateQuery } from '../../middleware/validate.js'
import { podcastEditionQuerySchema } from '../../schemas/podcast.js'
import { isEditionOpen } from '../../services/podcastEdition.js'
import { getFeed } from '../../services/podcastFeed.js'
import { getPublishedEpisode, getPublishedEpisodes } from '../../services/podcastPublish.js'
import { podcastShowInfo, toPublicEpisode, toPublicEpisodeDetail } from '../../services/podcastShow.js'

const router = Router()

const showNotFound = (res: Response) => res.status(404).json({ error: 'Podcast not found' })

/** The show's feed; a closed show has none. */
function serveFeed(edition: PodcastEdition) {
  return async (req: Request, res: Response) => {
    if (!isEditionOpen(edition)) {
      showNotFound(res)
      return
    }
    const feed = await getFeed(edition, () => getPublishedEpisodes(edition))
    sendRepresentation(req, res, feed, {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${config.feed.cacheMaxAge}`,
    })
  }
}

router.get('/feed.xml', failsWith('Failed to generate feed'), serveFeed('full'))
router.get('/uplifting/feed.xml', failsWith('Failed to generate feed'), serveFeed('uplifting'))

// One show (the main one without `?edition=`) with its published episodes; `upliftingShowOpen` lets
// the pages link the other show only once it is public.
router.get('/', failsWith('Failed to load the podcast'), apiLimiter, validateQuery(podcastEditionQuerySchema), async (req, res) => {
  const edition: PodcastEdition = req.parsedQuery?.edition ?? 'full'
  if (!isEditionOpen(edition)) {
    showNotFound(res)
    return
  }
  const { title, description, feedUrl, artworkUrl, listenLinks } = podcastShowInfo(edition)
  const episodes = await getPublishedEpisodes(edition)
  res.json({
    show: { title, description, feedUrl, artworkUrl, listenLinks },
    episodes: episodes.map(toPublicEpisode),
    upliftingShowOpen: isEditionOpen('uplifting'),
  })
})

// One published episode with its readable transcript, for its transcript page; 404 unless published.
router.get('/episodes/:id', failsWith('Failed to load the episode'), apiLimiter, async (req, res) => {
  const episode = await getPublishedEpisode(req.params.id!)
  if (episode) res.json(toPublicEpisodeDetail(episode))
  else res.status(404).json({ error: 'Episode not found' })
})

export default router
