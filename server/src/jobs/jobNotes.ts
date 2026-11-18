/**
 * What the admin Jobs page says about each job (`GET /api/admin/jobs`, `.context/scheduler.md`):
 * a note behind the job's info icon, in plain words, on what it does and the rules its name does
 * not tell (limits, what it skips or waits on, its relation to other jobs), and a warning shown under
 * the job's name for a state the owner must notice. Every value that comes from config is read from
 * it at each call. The text names no setting, code or file: the people who run the site read it.
 */
import { config } from '../config.js'
import type { RunUsage } from '../lib/runUsage.js'
import { PASS_EVAL_GATE } from '../services/researchPassGate.js'
import { researchSwitchOff } from '../services/researchSwitch.js'
import { failureShareExceeded, failureShareLine } from './failureShare.js'

export interface JobNotes {
  /** What the job does and its rules that are not obvious; null for a job without one. */
  note: string | null
  /** A state the owner must notice now, such as a job that can do nothing; null when there is none. */
  warning: string | null
}

/** What the notes read of the job's row. */
export interface JobRowState {
  /** What the last finished run spent and counted; null before one, or after an interrupted one. */
  lastRunUsage: RunUsage | null
}

const NO_ROW: JobRowState = { lastRunUsage: null }

/** "1 day", "30 days", "44,000 characters". */
const count = (n: number, unit: string, units = `${unit}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? unit : units}`

/** "Europe/Berlin" → "Berlin". */
const zoneCity = (zone: string) => (zone.split('/').pop() ?? zone).replace(/_/g, ' ')

const twoDigits = (hour: number) => String(hour).padStart(2, '0')

function researchNote(): string {
  const { perRun, concurrency, maxWaitMinutes } = config.research.pipeline
  return (
    'Researches each selected story further and applies the result: the story gets its researched version and keeps its own rating. ' +
    'It is rejected only when research finds it is old news or its main claim is contradicted, and when research cannot produce a usable version, the story publishes as it was. ' +
    `While this job is enabled, Publish Stories waits for a story's research, but only up to ${count(maxWaitMinutes, 'minute')} after the story was selected. ` +
    `It takes up to ${count(perRun, 'story', 'stories')} a run, ${concurrency} at once. ` +
    `Once the month's research budget of $${config.research.monthlyCapUsd} is spent, stories publish without research. ` +
    'Disabling the job stops it from starting more stories, and publishing stops waiting. A run started by hand applies its results too, even while the job is disabled.'
  )
}

function researchPassNote(): string {
  const { perRun, concurrency, failedStoriesMin } = config.research.pass
  const { share, minItems } = config.jobs.failureShare
  const switchOn = PASS_EVAL_GATE
    ? 'It cannot be enabled until its quality checks meet their bars and the owner switches it on.'
    : 'It can be enabled only once web search is set up.'
  return (
    'Researches each selected story in one pass: it searches the web, checks every fact against its source, rewrites the story from what holds up and builds its context cards, ' +
    'taking the place of Research Stories and Build Story Context. A story is rejected only when the pass finds it is old news or its main claim is contradicted, ' +
    'and when the pass cannot produce a usable version, the story publishes as it was. ' +
    `While this job is enabled, Publish Stories waits for a story's pass, in the daily edition too, but only up to ${count(config.research.pipeline.maxWaitMinutes, 'minute')} after the story was selected. ` +
    `It takes up to ${count(perRun, 'story', 'stories')} a run, ${concurrency} at once, and its passes share the month's research budget of $${config.research.monthlyCapUsd}; once that is spent, stories publish without a pass. ` +
    `When more than ${Math.round(share * 100)}% of at least ${minItems} checked items fail in a run, a warning shows here and a notice is recorded; ` +
    `so is a notice when more than ${Math.round(share * 100)}% of at least ${failedStoriesMin} stories fail. Nothing pauses. ` +
    'Enabling it switches Research Stories and Build Story Context off, and neither can be enabled while it is on; to go back, disable it and enable those two. ' +
    `"Run now" does nothing while the job is disabled. ${switchOn}`
  )
}

/** Why the research step can do nothing now, or null while research is on. */
function researchWarning(): string | null {
  const off = researchSwitchOff()
  if (!off) return null
  const why =
    off.cause === 'no-key'
      ? 'the Tavily key is not set'
      : `${off.models.join(', ')} ${off.models.length === 1 ? 'has' : 'have'} no price on record, so the cost of a run cannot be counted`
  return `Research is off: ${why}. Nothing is researched, and publishing does not wait for it.`
}

function assessNote(): string {
  const grouping = config.dedup.enabled
    ? ` Each analyzed story is then compared with the stories crawled in the last ${count(config.dedup.timeWindowDays, 'day')}, and reports of the same event are grouped so that only one of them is published.`
    : ''
  return `Fully analyzes each pre-assessed story whose first rating reaches its issue's Min Pre-Rating (otherwise ${config.assess.fullAssessmentThreshold}), and rejects the rest.${grouping}`
}

function publishNewsletterNote(): string {
  const audience = config.newsletter.editionsOpen ? "the full edition's subscribers" : 'all subscribers'
  return (
    `Sends this week's automatic issue to ${audience}, but only once it is built and its test email has gone out. ` +
    "If you move Generate Newsletter's schedule, move this one too. Issues made by hand are never sent by it, and every run leaves a notice saying what it did."
  )
}

function generatePodcastNote(): string {
  const { generateWindowEndHourUtc, maxAttemptsPerWeek, monthlyTtsCharCap } = config.podcast
  return (
    `Makes this week's episode on Fridays, from midnight to ${twoDigits(generateWindowEndHourUtc)}:00 UTC, and does nothing on other days. ` +
    'Each run continues where the last one stopped, and it leaves alone an episode a person is reviewing. ' +
    `After ${count(maxAttemptsPerWeek, 'failed run')} in a week, the episode is blocked until it is resumed by hand; some problems, such as reaching the voicing limit, block it at once. ` +
    `Voicing also stops at the monthly limit of ${count(monthlyTtsCharCap, 'character')}, shared by both shows. ` +
    'Disabling the job stops a running episode before its next audio part.'
  )
}

const CHAIN_RULES =
  'Each step starts when the one before it has finished. A step set to Off is skipped; a step set to Review runs, then the chain waits until you continue it here. ' +
  'If a step fails, the chain stops there and you can resume it from that step; its next scheduled run starts from the first step again.'

export const NOTES: Readonly<Record<string, () => string>> = {
  intake_chain: () =>
    'Crawls the feeds, gives each new story its first rating, then fully analyzes the ones that qualify, in that order, so every run ends with assessed stories ready to review. ' +
    `It runs several times a day because a feed lists only its newest articles and a busy one drops them within hours. ${CHAIN_RULES}`,
  daily_edition_chain: () =>
    'Selects the best of the assessed stories, researches them, builds their context cards and publishes them, in that order, so stories go out with their research and cards as soon as they are ready instead of at a fixed time. ' +
    `${CHAIN_RULES} ` +
    'One exception: if Build Story Context fails, the chain still goes on to publish, and those stories go out without cards. ' +
    'Research Passes, off until it is switched on in their place, does the work of both in one step; if it fails as a whole, the chain stops before publishing. ' +
    'Once publishing is done, Build Story Context also builds the cards of published stories that still lack them, so publishing never waits for those. ' +
    'Once its flex hours (the Flex column of its Whole chain row) have passed since the run started, every call goes at standard price, so a slow flex queue cannot hold up publishing for long.',
  newsletter_chain: () =>
    `Builds this week's full newsletter and sends its test email, sends it to subscribers, then does the same for Actually Uplifting, in that order. ${CHAIN_RULES} ` +
    'A step whose run was cut off by a restart is not run again, so no issue goes out twice.',
  podcast_chain: () =>
    `On Friday it builds this week's episode of each show, then holds the two publish steps until Saturday 07:00 in Berlin, when they publish what is ready. ${CHAIN_RULES} ` +
    `It runs once: a build that fails is tried again in the same run every ${count(config.podcast.retryDelayMs / 60_000, 'minute')}, and after ${count(config.podcast.maxAttemptsPerWeek, 'failed run')} the episode waits for you to resume it on the Podcasts page.`,
  crawl_feeds: () =>
    'Reads each active feed whose own crawl interval has passed and saves its new articles as stories. ' +
    `Running this job more often never crawls a feed more than ${count(config.crawl.dueGraceMinutes, 'minute')} before its interval is up, which keeps each feed on the same run every day. ` +
    'Articles whose publisher opts out of AI use are skipped, and articles locked behind a paywall are saved as rejected.',
  preassess_stories: () =>
    `Gives each newly crawled story a first rating from 1 to 10, an issue and an emotion tag, ${config.preassess.batchSize} stories per AI call. ` +
    'It rejects nothing: Assess Stories uses the rating to choose which stories get a full analysis.',
  assess_stories: assessNote,
  select_stories: () =>
    `Picks about ${Math.round(config.selection.ratio * 100)}% of the analyzed stories with a relevance of at least ${config.selection.relevanceMin}, ` +
    `comparing up to ${config.selection.maxGroupSize} stories at a time, and rejects the rest. The picked stories go on to Research Stories and Publish Stories.`,
  research_stories: researchNote,
  research_pass: researchPassNote,
  publish_stories: () =>
    'Publishes the selected stories. Of several stories about the same event, only the one chosen to lead the group is published, and the others are rejected as duplicates. ' +
    `While Research Stories is enabled and research is on, a story selected less than ${count(config.research.pipeline.maxWaitMinutes, 'minute')} ago waits for its research and goes out at a later run. ` +
    'When you run it here while Build Story Context is enabled and web search is set up, a researched story waits for its context cards in the same way. ' +
    'In the daily edition it never waits for them: they are built just before, and a story whose cards failed or did not come in time goes out without them. ' +
    'While Research Passes is enabled in their place, a selected story waits for its pass in the same way, in the daily edition too.',
  build_story_context: () => {
    const c = config.storyContext
    const { share, minItems } = config.jobs.failureShare
    return (
      'Builds the context cards of the researched stories about to be published that have none yet, ' +
      `then of the stories published in the last ${count(c.lookbackDays, 'day')} that still have none: ` +
      `it reads their research, searches the web for up to ${count(c.maxSearches, 'missing piece')}, checks every fact and card against its source, and keeps what passes. ` +
      'In the daily edition it builds the cards of the stories about to be published before Publish Stories, so they go out with them, ' +
      'and those of the published stories once publishing is done, so publishing never waits for them; on a night with such stories, its last run shown here is that second part. ' +
      'It takes every story it owes, and if it fails, publishing goes ahead without cards. ' +
      'It builds each story once: a build stopped by a problem that may pass, such as the AI service not answering, is tried a second time later in the same run, never on a later night. ' +
      `When more than ${Math.round(share * 100)}% of at least ${minItems} checked items fail in a run, a warning shows here and a notice is recorded; ` +
      `so is a notice when more than ${Math.round(share * 100)}% of at least ${c.failedStoriesMin} stories fail. Nothing pauses. ` +
      '"Run now" does both parts at once and builds cards that readers see, even while the step is off. It can be enabled only once web search is set up.'
    )
  },
  social_auto_post: () =>
    `Picks the best story published in the last ${count(config.socialAutoPost.lookbackHours, 'hour')} that a channel has not posted yet, writes a post for it and posts it, one story per run. ` +
    'It posts only to Bluesky and Mastodon where auto-posting is switched on and the account is connected, and does nothing while neither is.',
  bluesky_update_metrics: () =>
    `Updates the likes, reposts, replies and quotes of our Bluesky posts from the last ${count(config.bluesky.metrics.maxAgeDays, 'day')}; older posts keep their last counts. ` +
    'It does nothing until the Bluesky account is connected.',
  mastodon_update_metrics: () =>
    `Updates the favorites, boosts and replies of our Mastodon posts from the last ${count(config.mastodon.metrics.maxAgeDays, 'day')}; older posts keep their last counts. ` +
    'It does nothing until the Mastodon account is connected.',
  generate_newsletter: () =>
    `Builds this week's issue from the published stories crawled in the last ${count(config.content.storyAssignmentDays, 'day')} and sends it to the test list only; subscribers get it from Publish Newsletter or a send by hand. ` +
    'It builds one issue a week, and in a week with no new stories it builds none and leaves a notice.',
  publish_newsletter: publishNewsletterNote,
  generate_uplifting_newsletter: () =>
    `Builds this week's Actually Uplifting issue from the published uplifting stories crawled in the last ${count(config.content.storyAssignmentDays, 'day')} that no earlier Actually Uplifting issue carries, and sends it to the test list only. ` +
    'A week without uplifting stories gets no issue. It can be enabled only once the newsletter editions are open.',
  publish_uplifting_newsletter: () =>
    "Sends this week's Actually Uplifting issue to its subscribers, but only once it is built and its test email has gone out. " +
    "If you move Generate Actually Uplifting Newsletter's schedule, move this one too. It can be enabled only once the newsletter editions are open.",
  generate_podcast: generatePodcastNote,
  publish_podcast: () =>
    `Publishes the newest ready episode of this week or last week on Saturdays, ${zoneCity(config.podcast.publishTimeZone)} time, and does nothing on other days. ` +
    `It takes only an episode that has been ready for at least ${count(config.podcast.autoPublishMinAgeHours, 'hour')}, so there is time to listen first. ` +
    'When none is ready, it leaves one warning notice for the week.',
  generate_uplifting_podcast: () =>
    "Makes this week's Actually Uplifting episode the way Generate Podcast makes the main one. " +
    `A week with fewer than ${config.podcast.minStories} uplifting stories gets no episode, only a notice. It can be enabled only once the show is switched on.`,
  publish_uplifting_podcast: () =>
    "Publishes this week's ready Actually Uplifting episode the way Publish Podcast does for the main show. It can be enabled only once the show is switched on.",
  poll_plunk_activity: () =>
    `Reads the spam complaints and permanent bounces of the last ${count(config.plunk.activityLookbackDays, 'day')} from Plunk and records each new one as a notice. ` +
    'It reads the whole window every run, so a missed run loses nothing. It does nothing while the Plunk key is not set.',
  send_queued_confirmations: () =>
    `Sends the confirmation emails of signups that had to wait for the hourly limit, oldest first, keeping to ${config.subscribe.globalHourlyMax} emails in any hour together with direct signups. ` +
    `Only this job sends them, so keep it enabled. A signup still waiting after ${count(config.subscribe.confirmTokenExpiryHours, 'hour')} is dropped with a notice, and nothing is sent while signups are switched off.`,
  cleanup_old_stories: () =>
    `Deletes rejected and trashed stories, and stories never fully analyzed, crawled more than ${count(config.storyRetention.maxAgeMonths, 'month')} ago. ` +
    'It keeps any that a social post, a newsletter, a podcast or a published story about the same event still uses, and counts every deleted story in the lifetime totals. ' +
    'Every unpublished story older than that loses its search data until it is published or assessed again. Each run leaves a notice with what it did.',
}

/**
 * Any job's warning when more than `config.jobs.failureShare.share` of at least `minItems` items its
 * last run's checks judged failed (a step that checks what a model wrote counts them with
 * `recordItems`); null otherwise, and for a job that counts none. It holds until a run stays under.
 */
export function failureShareWarning(lastRunUsage: RunUsage | null): string | null {
  const checked = lastRunUsage?.itemsChecked ?? 0
  const failed = lastRunUsage?.itemsFailed ?? 0
  if (!failureShareExceeded(checked, failed)) return null
  return failureShareLine(checked, failed)
}

/** The warnings of one job; every job also gets the failure share's (`failureShareWarning`). */
export const WARNINGS: Readonly<Record<string, (row: JobRowState) => string | null>> = {
  research_stories: researchWarning,
}

export function jobNotes(jobName: string, row: JobRowState = NO_ROW): JobNotes {
  const warnings = [WARNINGS[jobName]?.(row) ?? null, failureShareWarning(row.lastRunUsage)].filter((w): w is string => w !== null)
  return { note: NOTES[jobName]?.() ?? null, warning: warnings.length > 0 ? warnings.join(' ') : null }
}
