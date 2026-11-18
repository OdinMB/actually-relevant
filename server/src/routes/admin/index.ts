import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import issueRouter from './issues.js'
import feedRouter from './feeds.js'
import storyRouter from './stories.js'
import jobRouter from './jobs.js'
import newsletterRouter from './newsletters.js'
import subscriberRouter from './subscribers.js'
import podcastRouter from './podcasts.js'
import userRouter from './users.js'
import clusterRouter from './clusters.js'
import blueskyRouter from './bluesky.js'
import mastodonRouter from './mastodon.js'
import feedbackRouter from './feedback.js'
import noticeRouter from './notices.js'
import cacheRouter from './cache.js'
import researchRouter from './research.js'
import researchPassRouter from './researchPass.js'
import spendingRouter from './spending.js'
import storyContextRouter from './storyContext.js'
import overviewRouter from './overviews.js'

const router = Router()

// All admin routes require authentication + admin or editor role
router.use(requireAuth, requireRole('admin', 'editor'))

router.use('/issues', issueRouter)
router.use('/feeds', feedRouter)
router.use('/stories', storyRouter)
// A story's context cards: /stories/:id/context (.context/story-context.md, "Admin")
router.use('/stories', storyContextRouter)
router.use('/jobs', jobRouter)
router.use('/newsletters', newsletterRouter)
router.use('/subscribers', subscriberRouter)
router.use('/podcasts', podcastRouter)
router.use('/users', userRouter)
router.use('/clusters', clusterRouter)
router.use('/bluesky', blueskyRouter)
router.use('/mastodon', mastodonRouter)
router.use('/feedback', feedbackRouter)
router.use('/notices', noticeRouter)
router.use('/cache', cacheRouter)
router.use('/research', researchRouter)
// Research passes, research's and context's successor (.context/research-passes.md, "Admin routes")
router.use('/research-passes', researchPassRouter)
// Ongoing-story overviews: the list, one overview, a story's block, editor actions and undo (.context/overviews.md, "Admin")
router.use('/overviews', overviewRouter)
router.use('/spending', spendingRouter)

export default router
