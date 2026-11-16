import type { JobRun, JobRunUsage } from '@shared/types'
import { jobDisplayName } from './constants'

/**
 * The dashboard's rows: one per job with its own schedule, a chain standing for its steps. A chain's
 * row shows the most recent run among the chain and its steps that are switched on (so a chain that
 * has not run yet still shows its steps' last work), runs while any of them runs, and carries the
 * chain's error, or else the first step's, named.
 */
export function dashboardRows(jobs: JobRun[]): JobRun[] {
  const byName = new Map(jobs.map(job => [job.jobName as string, job]))
  return jobs
    .filter(job => !job.chain)
    .map(job => {
      if (!job.steps) return job
      const steps = job.steps.map(name => byName.get(name)).filter((s): s is JobRun => s !== undefined && s.enabled)
      const started = (j: JobRun) => (j.lastStartedAt ? Date.parse(j.lastStartedAt) : -Infinity)
      const latest = [job, ...steps].reduce((a, b) => (started(b) > started(a) ? b : a))
      const failedStep = steps.find(s => s.lastError)
      return {
        ...job,
        lastStartedAt: latest.lastStartedAt,
        lastCompletedAt: latest.lastCompletedAt,
        running: job.running || steps.some(s => s.running),
        lastError: job.lastError ?? (failedStep ? `${jobDisplayName(failedStep.jobName)}: ${failedStep.lastError}` : null),
      }
    })
}

/** How long the last finished run took, or null when there is none to measure (never run, or running now). */
export function lastRunDurationMs(job: Pick<JobRun, 'lastStartedAt' | 'lastCompletedAt'>): number | null {
  if (!job.lastStartedAt || !job.lastCompletedAt) return null
  const ms = Date.parse(job.lastCompletedAt) - Date.parse(job.lastStartedAt)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** "45s", "12 min", "2 h 5 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** "$0", "<$0.01", "$0.37", "$12.40". */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** What a run's cost line explains on hover: calls, flex use, what standard price would have cost. */
export function usageDetails(usage: JobRunUsage): string {
  const parts = [`${usage.calls.toLocaleString('en-US')} AI ${usage.calls === 1 ? 'call' : 'calls'}`]
  if (usage.flexCalls > 0) parts.push(`${usage.flexCalls.toLocaleString('en-US')} at flex price`)
  if (usage.flexFallbacks > 0) parts.push(`${usage.flexFallbacks.toLocaleString('en-US')} sent at standard price because flex was busy`)
  if (usage.standardCostUsd - usage.costUsd >= 0.005) parts.push(`${formatUsd(usage.standardCostUsd)} at standard price`)
  if (usage.otherUsd > 0) parts.push(`${formatUsd(usage.otherUsd)} of it for web searches`)
  if (usage.unpricedCalls > 0) parts.push(`${usage.unpricedCalls.toLocaleString('en-US')} without a known price, not counted`)
  return parts.join(', ')
}
