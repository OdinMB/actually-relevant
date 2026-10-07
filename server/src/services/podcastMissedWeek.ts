/**
 * The missed-week alert (owner, 2026-10-07): when the publish_podcast job runs on its Saturday and
 * finds no weekly episode to publish, one notice says so and why. At most one per ISO week: the week
 * is claimed in `podcast_missed_week_alerts` before the notice goes out, so a retry, a manual Run or a
 * boot catch-up the same Saturday stays silent. An episode already listed is no missed week.
 */
import { ContentStatus, PodcastStage, type Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notifyEvent } from '../lib/notify.js'
import { publishRefusal, unfinishedReason } from './podcastPublish.js'
import { isoWeekKey } from './podcastWeekly.js'

const log = createLogger('podcast-missed-week')

const HOUR_MS = 60 * 60 * 1000

export const MISSED_WEEK_TITLE = 'No podcast episode ready to publish this Saturday'

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.podcast.publishTimeZone, weekday: 'short', hour: '2-digit', minute: '2-digit',
})

type ReasonFields = 'stage' | 'mode' | 'status' | 'publishedAt' | 'unpublishedAt' | 'blockedAt' | 'blockedReason'
  | 'dryRun' | 'lastError' | 'readyAt' | 'audioUrl' | 'audioBytes' | 'humanEdited' | 'kind'

/**
 * Why the week's weekly episode was not published automatically, or null when it is already listed.
 * `episode` is the row of `now`'s ISO week, or null when there is none.
 */
export function missedWeekReason(episode: Pick<Podcast, ReasonFields> | null, now: Date): string | null {
  if (!episode || (episode.stage === PodcastStage.created && episode.mode === null)) return 'no episode was generated this week'
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

/** Send the missed-week notice for `now`'s ISO week, unless the week's episode is listed or the week was already alerted. */
export async function alertMissedWeek(now: Date): Promise<void> {
  const weekKey = isoWeekKey(now)
  const episode = await prisma.podcast.findUnique({ where: { weekKey } })
  const reason = missedWeekReason(episode, now)
  if (reason === null) return
  const claimed = await prisma.$executeRaw`
    INSERT INTO podcast_missed_week_alerts (week_key, reason) VALUES (${weekKey}, ${reason})
    ON CONFLICT (week_key) DO NOTHING`
  if (claimed === 0) {
    log.info({ weekKey }, 'missed-week alert already sent this week')
    return
  }
  log.warn({ weekKey, reason, podcastId: episode?.id }, 'no podcast episode to publish this Saturday')
  const link = `${config.clientUrl}/admin/podcasts${episode ? `/${episode.id}` : ''}`
  await notifyEvent(MISSED_WEEK_TITLE, `${weekKey}: ${reason}.\nOpen: ${link}`)
}
