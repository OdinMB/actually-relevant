import { runCrawlFeeds } from './crawlFeeds.js'
import { runPreassessStories } from './preassessStories.js'
import { runAssessStories } from './assessStories.js'
import { runSelectStories } from './selectStories.js'
import { runPublishStories } from './publishStories.js'
import { runBlueskyUpdateMetrics } from './blueskyUpdateMetrics.js'
import { runGenerateNewsletter } from './generateNewsletter.js'
import { runSocialAutoPost } from './socialAutoPost.js'
import { runMastodonUpdateMetrics } from './mastodonUpdateMetrics.js'
import { runGeneratePodcast } from './generatePodcast.js'
import { runPublishPodcast } from './publishPodcast.js'

export const JOB_HANDLERS: Record<string, () => Promise<void>> = {
  crawl_feeds: runCrawlFeeds,
  preassess_stories: runPreassessStories,
  assess_stories: runAssessStories,
  select_stories: runSelectStories,
  publish_stories: runPublishStories,
  social_auto_post: runSocialAutoPost,
  bluesky_update_metrics: runBlueskyUpdateMetrics,
  generate_newsletter: runGenerateNewsletter,
  mastodon_update_metrics: runMastodonUpdateMetrics,
  // Called with no argument: the handlers' `now` parameter is for tests.
  generate_podcast: () => runGeneratePodcast(),
  publish_podcast: () => runPublishPodcast(),
}

/**
 * The order the boot catch-up runs overdue jobs in, one after another (scheduler.ts): each stage
 * before the stages that consume its output. A job missing here runs last. Same order as the
 * admin's JOB_PIPELINE_ORDER (client/src/lib/constants.ts); the server does not import shared/.
 */
export const JOB_PIPELINE_ORDER: readonly string[] = [
  'crawl_feeds',
  'preassess_stories',
  'assess_stories',
  'select_stories',
  'publish_stories',
  'social_auto_post',
  'bluesky_update_metrics',
  'mastodon_update_metrics',
  'generate_newsletter',
  'generate_podcast',
  'publish_podcast',
]
