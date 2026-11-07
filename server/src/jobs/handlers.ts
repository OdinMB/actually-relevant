import { runCrawlFeeds } from './crawlFeeds.js'
import { runPreassessStories } from './preassessStories.js'
import { runAssessStories } from './assessStories.js'
import { runSelectStories } from './selectStories.js'
import { runPublishStories } from './publishStories.js'
import { runBlueskyUpdateMetrics } from './blueskyUpdateMetrics.js'
import { runGenerateNewsletter, runGenerateUpliftingNewsletter } from './generateNewsletter.js'
import { runPublishNewsletter, runPublishUpliftingNewsletter } from './publishNewsletter.js'
import { runSocialAutoPost } from './socialAutoPost.js'
import { runMastodonUpdateMetrics } from './mastodonUpdateMetrics.js'
import { runGeneratePodcast, runGenerateUpliftingPodcast } from './generatePodcast.js'
import { runPublishPodcast, runPublishUpliftingPodcast } from './publishPodcast.js'
import { runPollPlunkActivity } from './pollPlunkActivity.js'
import { runCleanupOldStories } from './cleanupOldStories.js'
import { runSendQueuedConfirmations } from './sendQueuedConfirmations.js'

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
  publish_newsletter: () => runPublishNewsletter(),
  // Actually Uplifting's weekly issue (ADR-0052): the same handlers, for the other edition
  generate_uplifting_newsletter: runGenerateUpliftingNewsletter,
  publish_uplifting_newsletter: () => runPublishUpliftingNewsletter(),
  generate_podcast: () => runGeneratePodcast(),
  publish_podcast: () => runPublishPodcast(),
  // The Actually Uplifting podcast: the same handlers, for the other show (no-ops while it is closed)
  generate_uplifting_podcast: () => runGenerateUpliftingPodcast(),
  publish_uplifting_podcast: () => runPublishUpliftingPodcast(),
  poll_plunk_activity: () => runPollPlunkActivity(),
  send_queued_confirmations: runSendQueuedConfirmations,
  cleanup_old_stories: async () => {
    await runCleanupOldStories()
  },
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
  'publish_newsletter',
  'generate_uplifting_newsletter',
  'publish_uplifting_newsletter',
  'generate_podcast',
  'publish_podcast',
  'generate_uplifting_podcast',
  'publish_uplifting_podcast',
  'poll_plunk_activity',
  'send_queued_confirmations',
  'cleanup_old_stories',
]
