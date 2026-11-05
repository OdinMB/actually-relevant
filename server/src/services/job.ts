import prisma from '../lib/prisma.js'
import { runningJobs } from '../jobs/scheduler.js'
import { jobsWithLiveLease } from '../jobs/jobLease.js'
import { jobTimeZone } from '../jobs/jobTimeZones.js'
import { jobSetting } from '../jobs/jobSettings.js'

/**
 * Every job with its running state: a run in this process, or a live lease held by any process. The
 * lease and the count of interrupted runs are scheduler bookkeeping and stay out.
 */
export async function getJobs() {
  const [jobs, leased] = await Promise.all([prisma.jobRun.findMany({ orderBy: { jobName: 'asc' } }), jobsWithLiveLease()])
  return jobs.map(({ lockedBy: _lockedBy, lockedUntil: _lockedUntil, interruptedRuns: _interruptedRuns, ...job }) => ({
    ...job,
    running: runningJobs.has(job.jobName) || leased.has(job.jobName),
    timeZone: jobTimeZone(job.jobName),
    setting: jobSetting(job.jobName),
  }))
}

export async function updateJob(jobName: string, data: { cronExpression?: string; enabled?: boolean }) {
  return prisma.jobRun.update({ where: { jobName }, data })
}
