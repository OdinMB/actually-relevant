import prisma from '../lib/prisma.js'
import { runningJobs } from '../jobs/scheduler.js'
import { jobsWithLiveLease } from '../jobs/jobLease.js'
import { jobTimeZone } from '../jobs/jobTimeZones.js'
import { jobNotes } from '../jobs/jobNotes.js'
import { CHAINS, chainOf } from '../jobs/chainDefinitions.js'
import { canContinue } from '../jobs/chains.js'
import type { RunUsage } from '../lib/runUsage.js'

/**
 * The jobs whose work includes model calls, so their Flex switch matters (services/openaiFetch.ts).
 * The others make none (crawl, publish, metrics, sends) or only embeddings, which never go at flex.
 */
export const MODEL_JOBS: ReadonlySet<string> = new Set([
  'preassess_stories',
  'assess_stories',
  'select_stories',
  'research_stories',
  'social_auto_post',
  'generate_newsletter',
  'generate_uplifting_newsletter',
  'generate_podcast',
  'generate_uplifting_podcast',
])

/**
 * Every job with its running state: a run in this process, or a live lease held by any process. The
 * lease and the count of interrupted runs are scheduler bookkeeping and stay out. A chain lists its
 * steps, a step names its chain.
 */
export async function getJobs() {
  const [jobs, leased] = await Promise.all([prisma.jobRun.findMany({ orderBy: { jobName: 'asc' } }), jobsWithLiveLease()])
  return jobs.map(({ lockedBy: _lockedBy, lockedUntil: _lockedUntil, interruptedRuns, lastRunUsage, ...job }) => ({
    ...job,
    lastRunUsage: (lastRunUsage ?? null) as RunUsage | null,
    running: runningJobs.has(job.jobName) || leased.has(job.jobName),
    timeZone: jobTimeZone(job.jobName),
    chain: chainOf(job.jobName),
    steps: CHAINS[job.jobName] ?? null,
    canContinue: CHAINS[job.jobName] !== undefined && canContinue(job.jobName, { ...job, interruptedRuns }),
    usesModels: MODEL_JOBS.has(job.jobName),
    ...jobNotes(job.jobName),
  }))
}

/** The step a chain's Continue goes on from (after a review pause, or where it stopped), or null. */
export async function chainContinueStep(chainName: string): Promise<string | null> {
  const row = await prisma.jobRun.findUnique({ where: { jobName: chainName } })
  return row && canContinue(chainName, row) ? row.resumeStep : null
}

export async function updateJob(
  jobName: string,
  data: { cronExpression?: string; enabled?: boolean; flex?: boolean; pauseForReview?: boolean; flexUntil?: string | null; deadline?: string | null },
) {
  return prisma.jobRun.update({ where: { jobName }, data })
}
