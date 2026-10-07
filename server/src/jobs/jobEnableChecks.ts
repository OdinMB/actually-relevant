/**
 * What must hold before a job may be enabled from the admin Jobs page. Most jobs need nothing; a
 * job whose every run would block on a missing setting is refused up front, naming the setting.
 */
import { GENERATE_PODCAST_JOB } from '../services/podcastAudioStages.js'
import { PUBLISH_PODCAST_JOB } from './publishPodcast.js'
import { podcastConfigProblem } from './podcastBootCheck.js'

/** Each check returns why the job cannot run, or null when it can. */
const ENABLE_CHECKS: Record<string, () => string | null> = {
  [GENERATE_PODCAST_JOB]: podcastConfigProblem,
  [PUBLISH_PODCAST_JOB]: podcastConfigProblem,
}

/** Why the job may not be enabled now, or null when nothing stands in the way. */
export function jobEnableRefusal(jobName: string): string | null {
  return ENABLE_CHECKS[jobName]?.() ?? null
}
