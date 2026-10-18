/**
 * A short line naming a job's main setting, shown beside the job on the admin Jobs page. A job not
 * listed here shows none.
 */
import { config } from '../config.js'

const JOB_SETTINGS: Readonly<Record<string, () => string>> = {
  cleanup_old_stories: () => `Stories older than ${config.storyRetention.maxAgeMonths} months`,
}

export function jobSetting(jobName: string): string | null {
  return JOB_SETTINGS[jobName]?.() ?? null
}
