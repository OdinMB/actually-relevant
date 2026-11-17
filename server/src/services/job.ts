import prisma from '../lib/prisma.js'
import { runningJobs } from '../jobs/scheduler.js'
import { jobsWithLiveLease } from '../jobs/jobLease.js'
import { jobTimeZone } from '../jobs/jobTimeZones.js'
import { jobNotes } from '../jobs/jobNotes.js'
import { CHAINS, chainOf } from '../jobs/chainDefinitions.js'
import { canContinue } from '../jobs/chains.js'
import { MODEL_JOBS } from '../jobs/modelJobs.js'
import { emptyUsage, type RunUsage } from '../lib/runUsage.js'

/**
 * Every job with its running state: a run in this process, or a live lease held by any process. The
 * lease and the count of interrupted runs are scheduler bookkeeping and stay out. A chain lists its
 * steps, a step names its chain. A last run's usage stored before a field existed reads that field
 * as zero.
 */
export async function getJobs() {
  const [jobs, leased] = await Promise.all([prisma.jobRun.findMany({ orderBy: { jobName: 'asc' } }), jobsWithLiveLease()])
  return jobs.map(({ lockedBy: _lockedBy, lockedUntil: _lockedUntil, chainStartedAt: _chainStartedAt, interruptedRuns, lastRunUsage: stored, ...job }) => {
    const lastRunUsage: RunUsage | null = stored ? { ...emptyUsage(), ...(stored as Partial<RunUsage>) } : null
    return {
      ...job,
      lastRunUsage,
      running: runningJobs.has(job.jobName) || leased.has(job.jobName),
      timeZone: jobTimeZone(job.jobName),
      chain: chainOf(job.jobName),
      steps: CHAINS[job.jobName] ?? null,
      canContinue: CHAINS[job.jobName] !== undefined && canContinue(job.jobName, { ...job, interruptedRuns }),
      usesModels: MODEL_JOBS.has(job.jobName),
      ...jobNotes(job.jobName, { lastRunUsage }),
    }
  })
}

/** The step a chain's Continue goes on from (after a review pause, a held step, or where it stopped), or null. */
export async function chainContinueStep(chainName: string): Promise<string | null> {
  const row = await prisma.jobRun.findUnique({ where: { jobName: chainName } })
  return row && canContinue(chainName, row) ? row.resumeStep : null
}

export async function updateJob(
  jobName: string,
  data: {
    cronExpression?: string
    enabled?: boolean
    flex?: boolean
    pauseForReview?: boolean
    notBefore?: string | null
    flexHours?: number | null
    deadlineHours?: number | null
  },
) {
  return prisma.jobRun.update({ where: { jobName }, data })
}
