/**
 * What the admin Jobs page says about each job (`GET /api/admin/jobs`, `.context/scheduler.md`):
 * a note behind the job's info icon, in plain words, on what it does and the rules its name does
 * not tell (limits, what it skips or waits on, its relation to other jobs), and a warning shown under
 * the job's name for a state the owner must notice. Every value that comes from config is read from
 * it at each call. The text names no setting, code or file: the people who run the site read it.
 */
import { config } from '../config.js'
import { researchSwitchOff } from '../services/researchRuns.js'

export interface JobNotes {
  /** What the job does and its rules that are not obvious; null for a job without one. */
  note: string | null
  /** A state the owner must notice now, such as a job that can do nothing; null when there is none. */
  warning: string | null
}

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

const NOTES: Readonly<Record<string, () => string>> = {
  crawl_feeds: () =>
    'Reads each active feed whose own crawl interval has passed and saves its new articles as stories. ' +
    'Running this job more often never crawls a feed before its interval is up. ' +
    'Articles whose publisher opts out of AI use are skipped, and articles locked behind a paywall are saved as rejected.',
  preassess_stories: () =>
    `Gives each newly crawled story a first rating from 1 to 10, an issue and an emotion tag, ${config.preassess.batchSize} stories per AI call. ` +
    'It rejects nothing: Assess Stories uses the rating to choose which stories get a full analysis.',
  assess_stories: assessNote,
  select_stories: () =>
    `Picks about ${Math.round(config.selection.ratio * 100)}% of the analyzed stories with a relevance of at least ${config.selection.relevanceMin}, ` +
    `comparing up to ${config.selection.maxGroupSize} stories at a time, and rejects the rest. The picked stories go on to Research Stories and Publish Stories.`,
  research_stories: researchNote,
  publish_stories: () =>
    'Publishes the selected stories. Of several stories about the same event, only the one chosen to lead the group is published, and the others are rejected as duplicates. ' +
    `While Research Stories is enabled and research is on, a story selected less than ${count(config.research.pipeline.maxWaitMinutes, 'minute')} ago waits for its research and goes out at a later run.`,
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

const WARNINGS: Readonly<Record<string, () => string | null>> = {
  research_stories: researchWarning,
}

export function jobNotes(jobName: string): JobNotes {
  return { note: NOTES[jobName]?.() ?? null, warning: WARNINGS[jobName]?.() ?? null }
}
