/**
 * A short line naming a job's main setting, shown beside the job on the admin Jobs page. A job not
 * listed here shows none.
 */
import { config } from '../config.js'
import { pipelineMode } from '../services/researchApply.js'

/**
 * The research step's mode in effect, so an apply held back by the owner's gate shows as shadow, with
 * why, and whether publishing waits for it (only in apply mode, owner decision 2026-11-12).
 */
function researchMode(): string {
  const { perRun, concurrency, maxWaitMinutes } = config.research.pipeline
  const limit = `up to ${perRun} stories a run, ${concurrency} at once`
  const mode = pipelineMode()
  if (mode.mode === 'apply')
    return `Apply mode: verdicts are applied (only old news or a contradicted claim rejects; the rating stays), publishing holds stories selected under ${maxWaitMinutes} min ago; a run while disabled is a shadow trial; ${limit}`
  if (mode.heldBack) return `Shadow mode, apply held back (${mode.heldBack}): publishing does not wait; ${limit}`
  return `Shadow mode: runs are stored, no verdict is applied, publishing does not wait; ${limit}`
}

const JOB_SETTINGS: Readonly<Record<string, () => string>> = {
  cleanup_old_stories: () => `Stories older than ${config.storyRetention.maxAgeMonths} months`,
  research_stories: researchMode,
}

export function jobSetting(jobName: string): string | null {
  return JOB_SETTINGS[jobName]?.() ?? null
}
