import { Router } from 'express'
import { apiLimiter } from '../../middleware/rateLimit.js'
import storiesRouter from './stories.js'
import issuesRouter from './issues.js'
import feedRouter from './feed.js'
import subscribeRouter from './subscribe.js'
import sitemapRouter from './sitemap.js'
import homepageRouter from './homepage.js'
import docsRouter from './docs.js'
import sourcesRouter from './sources.js'
import feedbackRouter from './feedback.js'
import podcastRouter from './podcast.js'
import { storyImageRouter, storyPageRouter } from './storyPreview.js'
import newslettersRouter from './newsletters.js'
import feedFaviconRouter from './feedFavicon.js'

const router = Router()

// Before the shared limiter: podcast directories poll the feed, possibly all from one proxy
// address behind the /podcast.xml rewrite. The router rate-limits its JSON route itself.
router.use('/podcast', podcastRouter)
// Before the limiter for the same reason: the site's /stories/* rewrite proxies every story
// page view here (routes/public/storyPreview.ts).
router.use('/story-page', storyPageRouter)
// Before the limiter: every page of story cards loads a favicon per feed shown, and mail clients'
// image proxies fetch the newsletter's from few addresses (routes/public/feedFavicon.ts).
router.use('/feeds', feedFaviconRouter)

// Apply rate limiting to public API
router.use(apiLimiter)

router.use('/homepage', homepageRouter)
router.use('/stories', storyImageRouter)
router.use('/stories', storiesRouter)
router.use('/issues', issuesRouter)
router.use('/sources', sourcesRouter)
router.use('/feed', feedRouter)
router.use('/subscribe', subscribeRouter)
router.use('/sitemap.xml', sitemapRouter)
router.use('/docs', docsRouter)
router.use('/feedback', feedbackRouter)
router.use('/newsletters', newslettersRouter)

export default router
