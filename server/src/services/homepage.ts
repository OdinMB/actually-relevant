/**
 * The homepage's data (issues plus the newest published stories of each top-level issue in three
 * emotion buckets), kept warm in memory: rebuilt every `config.homepage.refreshMs` and at startup,
 * so a visitor gets the last copy at once instead of waiting for the database (.context/public-website.md).
 */
import { config } from '../config.js'
import { withAiGeneratedMarker, type AiStoryText } from '../lib/aiProvenance.js'
import { registerPublicCache } from '../lib/publicCaches.js'
import { RefreshingValue } from '../lib/refreshingValue.js'
import * as issueService from './issue.js'
import { getHomepageData } from './publicStories.js'

// Issue slugs in display order for homepage
const HOMEPAGE_ISSUE_SLUGS = ['human-development', 'planet-climate', 'existential-threats', 'science-technology']
const STORIES_PER_BUCKET = 7

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

async function buildHomepage() {
  const [issues, storyData] = await Promise.all([issueService.getPublicIssues(), getHomepageData(HOMEPAGE_ISSUE_SLUGS, STORIES_PER_BUCKET)])
  return { issues, storiesByIssue: markBuckets(storyData.storiesByIssue) }
}

const homepage = new RefreshingValue('homepage', config.homepage.refreshMs, buildHomepage)
registerPublicCache('homepage', homepage)

/** The homepage data: the warm copy at once, or a load when there is none yet. */
export function getHomepage() {
  return homepage.get()
}

/** Load the homepage data now and keep rebuilding it in the background (server start). */
export function startHomepageRefresh(): void {
  homepage.start()
}

export function stopHomepageRefresh(): void {
  homepage.stop()
}
