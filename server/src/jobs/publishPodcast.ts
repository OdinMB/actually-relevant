/**
 * The publish_podcast cron entry (ADR-0012): publishes the episode `pickAutoPublishCandidate`
 * chooses (ready for at least a day, current or previous ISO week, never published or taken
 * down), on a UTC Monday only. Seeded disabled; enabling it in the admin Jobs page is how publishing goes automatic. It
 * re-reads its own row right before publishing, so disabling it during a run prevents the publish.
 * A refusal (for example an edited episode whose AI line awaits the owner) fails the run, so the
 * scheduler alerts.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notifyEvent } from '../lib/notify.js'
import { assertJobEnabled, assertPodcastRunnable, PodcastStoppedError } from '../services/podcastGuards.js'
import { pickAutoPublishCandidate, publishEpisode } from '../services/podcastPublish.js'

const log = createLogger('publish_podcast')

export const PUBLISH_PODCAST_JOB = 'publish_podcast'

const MONDAY = 1

export async function runPublishPodcast(now: Date = new Date()): Promise<void> {
  // The scheduler's boot catch-up can launch this job on any day (an overdue or never-completed
  // row); publishing is Monday-only (UTC), so outside it the run is a quiet no-op.
  if (now.getUTCDay() !== MONDAY) {
    log.info('not Monday (UTC), nothing to do')
    return
  }
  assertPodcastRunnable({ trigger: 'cron', dryRun: config.podcast.dryRun })
  const candidate = await pickAutoPublishCandidate(now)
  if (!candidate) {
    log.info('no episode to publish')
    return
  }
  try {
    await assertJobEnabled(PUBLISH_PODCAST_JOB)
  } catch (err) {
    if (!(err instanceof PodcastStoppedError)) throw err
    log.info({ podcastId: candidate.id }, 'publish_podcast was disabled during the run; not publishing')
    return
  }
  await publishEpisode(candidate.id, now)
  await notifyEvent('Podcast episode published', [
    `${candidate.title} (${candidate.weekKey}) is now in the feed and on /podcast.`,
    `Unpublish if needed: ${config.clientUrl}/admin/podcasts/${candidate.id}`,
  ].join('\n'))
}
