/**
 * The podcast's configuration check at boot: when either podcast job row is enabled, a missing
 * setting is logged and announced through the webhook at once, rather than at the next Friday
 * slot. A disabled podcast with no credentials stays silent. Never throws.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notifyEvent } from '../lib/notify.js'
import { assertPodcastRunnable, PodcastBlockedError } from '../services/podcastGuards.js'
import { GENERATE_PODCAST_JOB } from '../services/podcastAudioStages.js'
import { PUBLISH_PODCAST_JOB } from './publishPodcast.js'

const log = createLogger('podcast-boot-check')

export async function checkPodcastConfigAtBoot(): Promise<void> {
  try {
    const enabled = await prisma.jobRun.findMany({
      where: { jobName: { in: [GENERATE_PODCAST_JOB, PUBLISH_PODCAST_JOB] }, enabled: true },
      select: { jobName: true },
    })
    if (enabled.length === 0) return
    assertPodcastRunnable({ trigger: 'cron', dryRun: config.podcast.dryRun })
  } catch (err) {
    if (!(err instanceof PodcastBlockedError)) {
      log.error({ err }, 'podcast boot configuration check could not run')
      return
    }
    log.error({ reason: err.message }, 'podcast job enabled but its configuration is incomplete')
    await notifyEvent('Podcast configuration incomplete', `${err.message}. The enabled podcast jobs will block until it is set.`)
  }
}
