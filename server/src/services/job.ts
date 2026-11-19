import prisma from '../lib/prisma.js'
import { runningJobs } from '../jobs/scheduler.js'
import { jobsWithLiveLease } from '../jobs/jobLease.js'
import { jobTimeZone } from '../jobs/jobTimeZones.js'
import { jobNotes } from '../jobs/jobNotes.js'
import { CHAINS, chainOf } from '../jobs/chainDefinitions.js'
import { canContinue } from '../jobs/chains.js'
import { MODEL_JOBS } from '../jobs/modelJobs.js'
import { SWITCHED_OFF_BY } from '../jobs/jobEnableChecks.js'
import { emptyUsage, type RunUsage } from '../lib/runUsage.js'
import { forgetOverviewLinks } from './overviewPublic.js'
import { LINK_OVERVIEWS_JOB } from './overviewQueue.js'

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

/**
 * Write the job's settings. Enabling a job that replaces others (`SWITCHED_OFF_BY`: the research pass)
 * switches those off in the same transaction; `switchedOff` names them, so the caller reloads them too.
 * Switching overviews off makes every overview non-public, so the caches holding their links are
 * emptied once it is written (`forgetOverviewLinks`).
 */
export async function updateJob(jobName: string, data: Parameters<typeof writeJob>[1]): Promise<Awaited<ReturnType<typeof writeJob>>> {
  const result = await writeJob(jobName, data)
  if (data.enabled === false && jobName === LINK_OVERVIEWS_JOB) forgetOverviewLinks()
  return result
}

async function writeJob(
  jobName: string,
  data: {
    cronExpression?: string
    enabled?: boolean
    flex?: boolean
    pauseForReview?: boolean
    notBefore?: string | null
    flexHours?: number | null
  },
) {
  const replaced = data.enabled === true ? (SWITCHED_OFF_BY[jobName] ?? []) : []
  if (replaced.length === 0) return { job: await prisma.jobRun.update({ where: { jobName }, data }), switchedOff: [] as string[] }
  return prisma.$transaction(async tx => {
    const job = await tx.jobRun.update({ where: { jobName }, data })
    const on = await tx.jobRun.findMany({ where: { jobName: { in: [...replaced] }, enabled: true }, select: { jobName: true } })
    await tx.jobRun.updateMany({ where: { jobName: { in: on.map(j => j.jobName) } }, data: { enabled: false } })
    return { job, switchedOff: on.map(j => j.jobName) }
  })
}
