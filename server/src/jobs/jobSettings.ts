/**
 * A short line naming a job's main setting, shown beside the job on the admin Jobs page. A job not
 * listed here shows none.
 */
import { config } from '../config.js'
import { pipelineMode } from '../services/researchApply.js'

/** The research step's mode in effect, so an apply held back by the owner's gate shows as shadow, with why. */
function researchMode(): string {
  const perRun = `up to ${config.research.pipeline.perRun} stories a run`
  const mode = pipelineMode()
  if (mode.mode === 'apply') return `Apply mode: verdicts are applied; ${perRun}`
  if (mode.heldBack) return `Shadow mode, apply held back (${mode.heldBack}); ${perRun}`
  return `Shadow mode: runs are stored, no verdict is applied; ${perRun}`
}

const JOB_SETTINGS: Readonly<Record<string, () => string>> = {
  cleanup_old_stories: () => `Stories older than ${config.storyRetention.maxAgeMonths} months`,
  research_stories: researchMode,
}

export function jobSetting(jobName: string): string | null {
  return JOB_SETTINGS[jobName]?.() ?? null
}
