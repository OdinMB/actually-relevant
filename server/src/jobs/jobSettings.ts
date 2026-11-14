/**
 * A short line naming a job's main setting, shown beside the job on the admin Jobs page. A job not
 * listed here shows none.
 */
import { config } from '../config.js'
import { switchRefusal } from '../services/researchRuns.js'

/**
 * What the research step does with its verdicts and when publishing waits for it, or why it does
 * nothing: research switched off, its only switch (no shadow mode, owner decision 2026-11-14).
 */
function researchStep(): string {
  const { perRun, concurrency, maxWaitMinutes } = config.research.pipeline
  const limit = `up to ${perRun} stories a run, ${concurrency} at once`
  const off = switchRefusal()
  if (off) return `${off}. Nothing is researched and publishing does not wait; ${limit}`
  return `Verdicts are applied (only old news or a contradicted claim rejects; the rating stays); while the job is enabled, publishing holds stories selected under ${maxWaitMinutes} min ago; ${limit}`
}

const JOB_SETTINGS: Readonly<Record<string, () => string>> = {
  cleanup_old_stories: () => `Stories older than ${config.storyRetention.maxAgeMonths} months`,
  research_stories: researchStep,
}

export function jobSetting(jobName: string): string | null {
  return JOB_SETTINGS[jobName]?.() ?? null
}
