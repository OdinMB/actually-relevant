import prisma from '../lib/prisma.js'
import { runningJobs } from '../jobs/scheduler.js'
import { jobsWithLiveLease } from '../jobs/jobLease.js'
import { jobTimeZone } from '../jobs/jobTimeZones.js'

/** Every job with its running state: a run in this process, or a live lease held by any process. */
export async function getJobs() {
  const [jobs, leased] = await Promise.all([
    prisma.jobRun.findMany({ orderBy: { jobName: 'asc' } }),
    jobsWithLiveLease(),
  ])
  return jobs.map(({ lockedBy: _lockedBy, lockedUntil: _lockedUntil, ...job }) => ({
    ...job,
    running: runningJobs.has(job.jobName) || leased.has(job.jobName),
    timeZone: jobTimeZone(job.jobName),
  }))
}

export async function updateJob(jobName: string, data: { cronExpression?: string; enabled?: boolean }) {
  return prisma.jobRun.update({ where: { jobName }, data })
}
