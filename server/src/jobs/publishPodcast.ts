/**
 * The publish_podcast cron entry (ADR-0013): publishes the episode `pickAutoPublishCandidate`
 * chooses (ready for at least `autoPublishMinAgeHours`, current or previous ISO week, never
 * published or taken down), on a Saturday in `config.podcast.publishTimeZone` only; the scheduler
 * fires it at 07:00 on that zone's clock. Seeded disabled; enabling it in the admin Jobs page is
 * how publishing goes automatic. It re-reads its own row right before publishing, so disabling it
 * during a run prevents the publish. A refusal (for example an episode that is no longer ready)
 * fails the run, so the scheduler alerts. No candidate on the Saturday sends the missed-week alert,
 * once per ISO week (`alertMissedWeek`).
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notifyEvent } from '../lib/notify.js'
import { assertJobEnabled, assertPodcastRunnable, PodcastStoppedError } from '../services/podcastGuards.js'
import { pickAutoPublishCandidate, publishEpisode } from '../services/podcastPublish.js'
import { alertMissedWeek } from '../services/podcastMissedWeek.js'

const log = createLogger('publish_podcast')

export const PUBLISH_PODCAST_JOB = 'publish_podcast'

const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: config.podcast.publishTimeZone, weekday: 'short' })

/** Whether `now` falls on a Saturday by the calendar of `config.podcast.publishTimeZone`. */
export function isPublishDay(now: Date): boolean {
  return weekdayFormat.format(now) === 'Sat'
}

/** Re-reads the job's own row: a disabled job neither publishes nor alerts (a manual Run included). */
async function stillEnabled(): Promise<boolean> {
  try {
    await assertJobEnabled(PUBLISH_PODCAST_JOB)
    return true
  } catch (err) {
    if (err instanceof PodcastStoppedError) return false
    throw err
  }
}

export async function runPublishPodcast(now: Date = new Date()): Promise<void> {
  // The scheduler's boot catch-up can launch this job on any day (an overdue or never-completed
  // row); publishing is Saturday-only, so outside it the run is a quiet no-op.
  if (!isPublishDay(now)) {
    log.info({ timeZone: config.podcast.publishTimeZone }, 'not Saturday, nothing to do')
    return
  }
  assertPodcastRunnable({ dryRun: config.podcast.dryRun })
  const candidate = await pickAutoPublishCandidate(now)
  if (!(await stillEnabled())) {
    log.info({ podcastId: candidate?.id }, 'publish_podcast is disabled; not publishing and not alerting')
    return
  }
  if (!candidate) {
    log.info('no episode to publish')
    await alertMissedWeek(now)
    return
  }
  await publishEpisode(candidate.id, now)
  await notifyEvent('Podcast episode published', [
    `${candidate.title} (${candidate.weekKey}) is now in the feed and on /podcast.`,
    `Unpublish if needed: ${config.clientUrl}/admin/podcasts/${candidate.id}`,
  ].join('\n'))
}
