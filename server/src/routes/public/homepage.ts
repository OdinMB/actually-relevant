import { Router } from 'express'
import * as storyService from '../../services/story.js'
import * as issueService from '../../services/issue.js'
import { TTLCache, cached } from '../../lib/cache.js'
import { withAiGeneratedMarker, type AiStoryText } from '../../lib/aiProvenance.js'
import { failsWith } from '../../middleware/routeErrors.js'

const router = Router()

// Cache homepage data for 1 minute
const HOMEPAGE_TTL = 60 * 1000
const homepageCache = new TTLCache<unknown>(HOMEPAGE_TTL)

// Issue slugs in display order for homepage
const HOMEPAGE_ISSUE_SLUGS = ['human-development', 'planet-climate', 'existential-threats', 'science-technology']

interface EmotionBuckets<S> {
  uplifting: S[]
  calm: S[]
  negative: S[]
}

/** Add the machine-readable aiGenerated marker to every story in every emotion bucket. */
function markBuckets<S extends AiStoryText>(storiesByIssue: Record<string, EmotionBuckets<S>>) {
  return Object.fromEntries(
    Object.entries(storiesByIssue).map(([slug, { uplifting, calm, negative }]) => [
      slug,
      {
        uplifting: uplifting.map(withAiGeneratedMarker),
        calm: calm.map(withAiGeneratedMarker),
        negative: negative.map(withAiGeneratedMarker),
      },
    ]),
  )
}

router.get('/', failsWith('Failed to fetch homepage data'), async (_req, res) => {
  const data = await cached(homepageCache, 'homepage-data', async () => {
    // Fetch issues and stories in parallel
    const [issues, storyData] = await Promise.all([issueService.getPublicIssues(), storyService.getHomepageData(HOMEPAGE_ISSUE_SLUGS, 7)])

    return {
      issues,
      storiesByIssue: markBuckets(storyData.storiesByIssue),
    }
  })

  res.set('Cache-Control', 'public, max-age=60')
  res.json(data)
})

export default router
