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
