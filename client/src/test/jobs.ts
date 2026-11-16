import type { JobName, JobRun, JobRunUsage } from '@shared/types'

/** A job row as the admin API returns it: enabled, never run, standalone, with what a test overrides. */
export function makeJobRun(jobName: JobName, overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: jobName,
    jobName,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSucceededAt: null,
    lastError: null,
    enabled: true,
    running: false,
    cronExpression: '0 1 * * *',
    timeZone: null,
    note: null,
    warning: null,
    flex: false,
    usesModels: false,
    pauseForReview: false,
    flexUntil: null,
    deadline: null,
    resumeStep: null,
    resumeReason: null,
    canContinue: false,
    chain: null,
    steps: null,
    lastRunUsage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeRunUsage(overrides: Partial<JobRunUsage> = {}): JobRunUsage {
  return {
    calls: 0,
    flexCalls: 0,
    flexFallbacks: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    standardCostUsd: 0,
    unpricedCalls: 0,
    otherUsd: 0,
    ...overrides,
  }
}
