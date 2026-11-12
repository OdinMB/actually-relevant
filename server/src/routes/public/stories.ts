import { Router } from 'express'
import * as storyService from '../../services/story.js'
import { getStoryAppearances } from '../../services/storyAppearances.js'
import { validateQuery } from '../../middleware/validate.js'
import { searchLimiter } from '../../middleware/rateLimit.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { publicStoryQuerySchema, relatedStoriesQuerySchema } from '../../schemas/story.js'
import { config } from '../../config.js'
import { withAiGeneratedDetailMarker, withAiGeneratedMarker } from '../../lib/aiProvenance.js'

const router = Router()

// Apply stricter rate limit when search triggers OpenAI embedding calls
router.get(
  '/',
  failsWith('Failed to fetch stories'),
  (req, res, next) => {
    if (req.query.search) return searchLimiter(req, res, next)
    next()
  },
  validateQuery(publicStoryQuerySchema),
  async (req, res) => {
    const query = req.parsedQuery!
    const emotionTags = query.emotionTags
      ? query.emotionTags
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean)
      : undefined
    const result = await storyService.getPublishedStories({
      page: query.page,
      pageSize: query.pageSize,
      issueSlug: query.issueSlug,
      search: query.search,
      emotionTags,
      publishedSince: query.publishedSince ? new Date(query.publishedSince) : undefined,
      publishedBefore: query.publishedBefore ? new Date(query.publishedBefore) : undefined,
      minRelevance: query.minRelevance,
    })
    res.set('Cache-Control', 'public, max-age=60')
    res.json({ ...result, data: result.data.map(withAiGeneratedMarker) })
  },
)

router.get('/:slug/cluster', failsWith('Failed to fetch cluster members'), async (req, res) => {
  const result = await storyService.getClusterMembers(req.params.slug!)
  res.set('Cache-Control', 'public, max-age=300')
  res.json(result ?? { sources: [] })
})

router.get('/:slug/related', failsWith('Failed to fetch related stories'), validateQuery(relatedStoriesQuerySchema), async (req, res) => {
  const stories = await storyService.getRelatedStories(req.params.slug!, req.parsedQuery!.limit)
  res.set('Cache-Control', `public, max-age=${config.relatedStories.httpCacheSeconds}`)
  res.json(stories.map(withAiGeneratedMarker))
})

// The newsletter issue and podcast episode the story was in, for the end of its page; as fresh as their own lists
router.get('/:slug/appearances', failsWith('Failed to fetch story appearances'), async (req, res) => {
  const appearances = await getStoryAppearances(req.params.slug!)
  res.set('Cache-Control', 'public, max-age=300')
  res.json(appearances)
})

router.get('/:slug', failsWith('Failed to fetch story'), async (req, res) => {
  const story = await storyService.getPublishedStoryBySlug(req.params.slug!)
  if (!story) {
    // Check if this slug belongs to a non-primary cluster member and redirect to primary
    const redirectSlug = await storyService.getClusterRedirectSlug(req.params.slug!)
    if (redirectSlug) {
      res.set('Cache-Control', 'public, max-age=300')
      res.redirect(302, `/api/stories/${redirectSlug}`)
      return
    }
    res.status(404).json({ error: 'Story not found' })
    return
  }
  res.set('Cache-Control', 'public, max-age=60')
  res.json(withAiGeneratedDetailMarker(story))
})

export default router
