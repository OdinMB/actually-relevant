/**
 * The publish_podcast cron entry (ADR-0013): publishes the episode `pickAutoPublishCandidate`
 * chooses (ready for at least `autoPublishMinAgeHours`, current or previous ISO week, never
 * published or taken down), on a Saturday in `config.podcast.publishTimeZone` only; the scheduler
 * fires it at 07:00 on that zone's clock. Seeded disabled; enabling it in the admin Jobs page is
 * how publishing goes automatic. It re-reads its own row right before publishing, so disabling it
 * during a run prevents the publish. A refusal (for example an episode that is no longer ready)
 * fails the run, so the scheduler alerts. No candidate on the Saturday sends the missed-week alert,
 * once per ISO week (`alertMissedWeek`). publish_uplifting_podcast does the same for Actually
 * Uplifting, reading its own row, and is a logged no-op while that show is closed.
 */
import type { PodcastEdition } from '@prisma/client'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { assertJobEnabled, assertPodcastRunnable, PodcastStoppedError } from '../services/podcastGuards.js'
import { editionClosedReason, episodeNoticeTitle, podcastEditionInfo } from '../services/podcastEdition.js'
import { pickAutoPublishCandidate, publishEpisode } from '../services/podcastPublish.js'
import { alertMissedWeek } from '../services/podcastMissedWeek.js'

const log = createLogger('publish_podcast')

export { PUBLISH_PODCAST_JOB } from '../services/podcastEdition.js'

const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: config.podcast.publishTimeZone, weekday: 'short' })

/** Whether `now` falls on a Saturday by the calendar of `config.podcast.publishTimeZone`. */
export function isPublishDay(now: Date): boolean {
  return weekdayFormat.format(now) === 'Sat'
}

/** Re-reads the job's own row: a disabled job neither publishes nor alerts (a manual Run included). */
async function stillEnabled(jobName: string): Promise<boolean> {
  try {
    await assertJobEnabled(jobName)
    return true
  } catch (err) {
    if (err instanceof PodcastStoppedError) return false
    throw err
  }
}

/** The show's Saturday publish (`full` is publish_podcast, `uplifting` publish_uplifting_podcast). */
export async function runPublishPodcast(now: Date = new Date(), edition: PodcastEdition = 'full'): Promise<void> {
  const closed = editionClosedReason(edition)
  if (closed) {
    log.info({ edition, reason: closed }, 'the show is closed, nothing to do')
    return
  }
  // The scheduler's boot catch-up can launch this job on any day (an overdue or never-completed
  // row); publishing is Saturday-only, so outside it the run is a quiet no-op.
  if (!isPublishDay(now)) {
    log.info({ edition, timeZone: config.podcast.publishTimeZone }, 'not Saturday, nothing to do')
    return
  }
  assertPodcastRunnable({ dryRun: config.podcast.dryRun })
  const show = podcastEditionInfo(edition)
  const candidate = await pickAutoPublishCandidate(now, edition)
  if (!(await stillEnabled(show.publishJob))) {
    log.info({ podcastId: candidate?.id }, `${show.publishJob} is disabled; not publishing and not alerting`)
    return
  }
  if (!candidate) {
    log.info({ edition }, 'no episode to publish')
    await alertMissedWeek(now, edition)
    return
  }
  await publishEpisode(candidate.id, now)
  await notify({
    source: 'podcast',
    severity: 'info',
    title: episodeNoticeTitle(edition, 'published'),
    message: `${candidate.title} (${candidate.weekKey}) is now in the feed and on ${show.pagePath}. Unpublish it from the episode page if needed.`,
    link: `/admin/podcasts/${candidate.id}`,
  })
}

export const runPublishUpliftingPodcast = (now: Date = new Date()) => runPublishPodcast(now, 'uplifting')
