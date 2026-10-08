/**
 * The podcast's configuration check outside a run. At boot: when either podcast job row is
 * enabled, a missing setting is logged and recorded as an admin notice at once, rather than at
 * the next Friday slot; a disabled podcast with no credentials stays silent, and the check never
 * throws. On enabling a
 * podcast job from the admin Jobs page, `jobEnableChecks.ts` asks `podcastConfigProblem` and
 * refuses the change while a setting is missing.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { assertPodcastRunnable, PodcastBlockedError } from '../services/podcastGuards.js'
import { GENERATE_PODCAST_JOB } from '../services/podcastAudioStages.js'
import { PUBLISH_PODCAST_JOB } from './publishPodcast.js'

const log = createLogger('podcast-boot-check')

/**
 * The settings the automatic run would miss ("podcast configuration missing: …"), or null when it
 * has everything. Checked as the automatic run checks.
 */
export function podcastConfigProblem(): string | null {
  try {
    assertPodcastRunnable({ dryRun: config.podcast.dryRun })
    return null
  } catch (err) {
    if (err instanceof PodcastBlockedError) return err.message
    throw err
  }
}

export async function checkPodcastConfigAtBoot(): Promise<void> {
  try {
    const enabled = await prisma.jobRun.findMany({
      where: { jobName: { in: [GENERATE_PODCAST_JOB, PUBLISH_PODCAST_JOB] }, enabled: true },
      select: { jobName: true },
    })
    if (enabled.length === 0) return
    const problem = podcastConfigProblem()
    if (!problem) return
    log.error({ reason: problem }, 'podcast job enabled but its configuration is incomplete')
    await notify({
      source: 'podcast',
      severity: 'warning',
      title: 'Podcast configuration incomplete',
      message: `${problem}. The enabled podcast jobs will block until it is set.`,
      link: '/admin/jobs',
      dedupeKey: 'podcast-config',
    })
  } catch (err) {
    log.error({ err }, 'podcast boot configuration check could not run')
  }
}
