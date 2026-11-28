import { runCrawlFeeds } from './crawlFeeds.js'
import { runPreassessStories } from './preassessStories.js'
import { runAssessStories } from './assessStories.js'
import { runSelectStories } from './selectStories.js'
import { runResearchStories } from './researchStories.js'
import { runPublishStories } from './publishStories.js'
import { owesPublishedStories, runBuildStoryContext } from './buildStoryContext.js'
import { runResearchPassJob } from './researchPass.js'
import { runLinkOverviewsJob } from './linkOverviews.js'
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
import { runChain } from './chains.js'

export const JOB_HANDLERS: Record<string, () => Promise<void>> = {
  // Chains run their steps in order (chains.ts); the steps below them have no schedule of their own
  intake_chain: () => runChain('intake_chain'),
  daily_edition_chain: () => runChain('daily_edition_chain'),
  newsletter_chain: () => runChain('newsletter_chain'),
  podcast_chain: () => runChain('podcast_chain'),
  crawl_feeds: runCrawlFeeds,
  preassess_stories: runPreassessStories,
  assess_stories: runAssessStories,
  select_stories: runSelectStories,
  research_stories: runResearchStories,
  publish_stories: runPublishStories,
  // Run on its own, both of its parts in one run (SPLIT_STEPS below)
  build_story_context: () => runBuildStoryContext('all'),
  // Seeded disabled, its enabling refused until its evals meet their bars (services/researchPassGate.ts)
  research_pass: runResearchPassJob,
  // Seeded disabled; its enabling is refused only while its eval gate is closed (services/overviewGate.ts)
  link_overviews: () => runLinkOverviewsJob(),
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

/** A chain step whose work comes in two parts (chains.ts), each a run of the step's own job. */
export interface SplitStep {
  /** At the step's place in its chain. */
  atStep: () => Promise<void>
  /** Once the chain's last step has run, while the step is on and `due` finds work for it. */
  atEnd: () => Promise<void>
  /** Whether `atEnd` has work: a run with none would only take the step's last run's place on the Jobs page. */
  due: () => Promise<boolean>
}

/**
 * The chain steps that split their work (`.context/scheduler.md`, "Chains"); run on its own, such a
 * job's handler above does both parts at once.
 */
export const SPLIT_STEPS: Readonly<Record<string, SplitStep>> = {
  // The cards of the stories about to be published before publishing; those of the published stories
  // it still owes after it, so publishing never waits for them (.context/story-context.md, "The step")
  build_story_context: {
    atStep: () => runBuildStoryContext('to-publish'),
    atEnd: () => runBuildStoryContext('published'),
    due: owesPublishedStories,
  },
}

/**
 * The order the boot catch-up runs overdue jobs in, one after another (scheduler.ts): each stage
 * before the stages that consume its output. A job missing here runs last. Same order as the
 * admin's JOB_PIPELINE_ORDER (client/src/lib/constants.ts); the server does not import shared/.
 */
export const JOB_PIPELINE_ORDER: readonly string[] = [
  'intake_chain',
  'crawl_feeds',
  'preassess_stories',
  'assess_stories',
  'daily_edition_chain',
  'select_stories',
  'research_stories',
  'publish_stories',
  'build_story_context',
  'research_pass',
  'link_overviews',
  'social_auto_post',
  'bluesky_update_metrics',
  'mastodon_update_metrics',
  'newsletter_chain',
  'generate_newsletter',
  'publish_newsletter',
  'generate_uplifting_newsletter',
  'publish_uplifting_newsletter',
  'podcast_chain',
  'generate_podcast',
  'generate_uplifting_podcast',
  'publish_podcast',
  'publish_uplifting_podcast',
  'poll_plunk_activity',
  'send_queued_confirmations',
  'cleanup_old_stories',
]
