/**
 * Jobs whose cron expression is read on a fixed time zone's clock rather than the server's own
 * (UTC on Render). A job not listed here runs on the server's clock.
 */
import { config } from '../config.js'
import { PUBLISH_PODCAST_JOB } from './publishPodcast.js'

const JOB_TIME_ZONES: Readonly<Record<string, string>> = {
  [PUBLISH_PODCAST_JOB]: config.podcast.publishTimeZone,
}

/** The IANA zone the job's cron expression is read in, or null for the server's own. */
export function jobTimeZone(jobName: string): string | null {
  return JOB_TIME_ZONES[jobName] ?? null
}
