/**
 * The missed-week alert (owner, 2026-10-07): when a show's publish job runs on its Saturday and finds
 * no weekly episode to publish, one notice says so and why. At most one per show and ISO week: the
 * week is claimed in `podcast_missed_week_alerts` before the notice goes out, so a retry, a manual
 * Run or a boot catch-up the same Saturday stays silent. An episode already listed is no missed week,
 * and neither is Actually Uplifting's short week (`podcastShortWeek.ts`), whose info notice it
 * records instead.
 */
import { ContentStatus, PodcastStage, type Podcast, type PodcastEdition } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { podcastEditionInfo } from './podcastEdition.js'
import { publishRefusal, unfinishedReason } from './podcastPublish.js'
import { recordShortWeek, shortWeekStoryCount } from './podcastShortWeek.js'
import { fridayWindowEnd } from './podcastWeekSlot.js'
import { isoWeekKey } from './podcastWeekly.js'

const log = createLogger('podcast-missed-week')

const HOUR_MS = 60 * 60 * 1000

/** "No podcast episode ready to publish this Saturday", "No Actually Uplifting episode …". */
export const missedWeekTitle = (edition: PodcastEdition) => `No ${podcastEditionInfo(edition).noticeName} episode ready to publish this Saturday`

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.podcast.publishTimeZone,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

type ReasonFields =
  | 'stage'
  | 'mode'
  | 'status'
  | 'publishedAt'
  | 'unpublishedAt'
  | 'blockedAt'
  | 'blockedReason'
  | 'dryRun'
  | 'lastError'
  | 'readyAt'
  | 'audioUrl'
  | 'audioBytes'
  | 'humanEdited'
  | 'kind'
  | 'edition'

/** The week has no episode anyone started: none at all, or a row opened and never run. */
const nothingStarted = (episode: Pick<Podcast, 'stage' | 'mode'> | null): boolean =>
  !episode || (episode.stage === PodcastStage.created && episode.mode === null)

/**
 * Why the week's weekly episode was not published automatically, or null when it is already listed.
 * `episode` is the row of `now`'s ISO week, or null when there is none.
 */
export function missedWeekReason(episode: Pick<Podcast, ReasonFields> | null, now: Date): string | null {
  if (!episode || nothingStarted(episode)) return 'no episode was generated this week'
  if (episode.status === ContentStatus.published) return null
  if (episode.publishedAt || episode.unpublishedAt) return "this week's episode was unpublished by hand, and the job never republishes it"
  if (episode.blockedAt) return `this week's episode is blocked: ${episode.blockedReason ?? 'no reason recorded'}`
  if (episode.dryRun) return "this week's episode is a dry run (silent stub voice), which is never published"
  if (episode.stage !== PodcastStage.ready) {
    const where = unfinishedReason(episode.stage)
    if (episode.mode === 'interactive') return `this week's episode is interactive and waits for a person: ${where}`
    return episode.lastError ? `${where}; last error: ${episode.lastError}` : where
  }
  const minAge = config.podcast.autoPublishMinAgeHours
  if (!episode.readyAt || episode.readyAt.getTime() > now.getTime() - minAge * HOUR_MS) {
    const since = episode.readyAt ? ` only since ${clockFormat.format(episode.readyAt)} (${config.podcast.publishTimeZone})` : ''
    return `this week's episode has been ready${since}; the job publishes an episode once it has been ready for ${minAge} hours, so publish it by hand`
  }
  return publishRefusal(episode) ?? 'no publishable episode was found for this or last week'
}

/**
 * Send the show's missed-week notice for `now`'s ISO week, unless the week's episode is listed or the
 * week was already alerted. When nothing was started on Actually Uplifting, its pool is read as
 * Friday's last run could have read it: too few uplifting stories is the short week's info notice.
 */
export async function alertMissedWeek(now: Date, edition: PodcastEdition): Promise<void> {
  const weekKey = isoWeekKey(now)
  const episode = await prisma.podcast.findUnique({ where: { edition_weekKey: { edition, weekKey } } })
  if (nothingStarted(episode)) {
    const short = await shortWeekStoryCount(fridayWindowEnd(now), edition)
    if (short !== null) {
      await recordShortWeek(weekKey, short)
      return
    }
  }
  const reason = missedWeekReason(episode, now)
  if (reason === null) return
  const claimed = await prisma.$executeRaw`
    INSERT INTO podcast_missed_week_alerts (edition, week_key, reason) VALUES (CAST(${edition} AS "PodcastEdition"), ${weekKey}, ${reason})
    ON CONFLICT (edition, week_key) DO NOTHING`
  if (claimed === 0) {
    log.info({ edition, weekKey }, 'missed-week alert already sent this week')
    return
  }
  log.warn({ edition, weekKey, reason, podcastId: episode?.id }, 'no podcast episode to publish this Saturday')
  await notify({
    source: 'podcast',
    severity: 'warning',
    title: missedWeekTitle(edition),
    message: `${weekKey}: ${reason}.`,
    link: `/admin/podcasts${episode ? `/${episode.id}` : ''}`,
  })
}
