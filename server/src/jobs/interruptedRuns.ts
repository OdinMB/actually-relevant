import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { jobFailureNotice, notify } from '../lib/notify.js'
import { clearInterruptedRuns, interruptedJobRuns, recordAbandonedRuns, recordInterruptedHere, type InterruptedJobRun } from './jobLease.js'

/**
 * Interrupted runs (.context/scheduler.md, "Interrupted runs"): record why a run was cut off (by a
 * graceful shutdown at its drain deadline, or found dead by the scheduler's sweep), and decide which
 * interrupted jobs the scheduler reruns. The statements are in jobLease.ts; the reruns go through the
 * scheduler's catch-up chain.
 */

const log = createLogger('interrupted-runs')

/**
 * The jobs that are rerun on their own after an interruption. Each works off what is still left to do
 * (feeds that are due, stories in its input status) and skips what is done, so a rerun does only the
 * rest and repeats no side effect. Every other job (newsletter, podcast, social posts and metrics,
 * Plunk, confirmations, cleanup) waits for its schedule or a person.
 */
export const RESUMABLE_JOBS: ReadonlySet<string> = new Set(['crawl_feeds', 'preassess_stories', 'assess_stories', 'select_stories', 'publish_stories'])

// PostgreSQL format() templates (jobLease.ts): the one %s is filled from the row
const SHUTDOWN_REASON = 'Interrupted: the server shut down (deploy or restart) %s min into the run, before it finished.'
const DIED_REASON =
  'Interrupted: the server stopped without shutting down (likely out of memory or a forced restart) while this run was in progress (started %s UTC).'

/**
 * Graceful shutdown: record the jobs still running at the drain deadline as interrupted, where this
 * process holds their lease. One statement; a failed write is logged, never thrown.
 */
export async function recordShutdownInterruptions(jobNames: string[]): Promise<void> {
  if (jobNames.length === 0) return
  try {
    const recorded = await recordInterruptedHere(jobNames, SHUTDOWN_REASON)
    log.warn({ jobs: recorded }, 'recorded the runs cut off by the shutdown as interrupted')
  } catch (err) {
    log.error({ err, jobs: jobNames }, 'failed to record the runs cut off by the shutdown')
  }
}

/**
 * The scheduler's sweep, at its start and once more after a lease would have run out: record the runs
 * whose process died, then settle every interrupted job. Returns the jobs to rerun now; each other one
 * gets a notice and its count starts again, so a later sweep does not repeat it. Never throws: a
 * failed statement is logged and nothing is resumed.
 */
export async function sweepInterruptedRuns(isScheduled: (jobName: string) => boolean): Promise<string[]> {
  try {
    const died = new Set(await recordAbandonedRuns(DIED_REASON))
    if (died.size > 0) log.warn({ jobs: [...died] }, 'recorded the runs whose process died as interrupted')

    const resume: string[] = []
    for (const job of await interruptedJobRuns()) {
      if (await settle(job, isScheduled(job.jobName), died.has(job.jobName))) resume.push(job.jobName)
    }
    return resume
  } catch (err) {
    log.error({ err }, 'interrupted-run sweep failed; nothing is resumed now')
    return []
  }
}

/** Whether the scheduler reruns this job now (the catch-up chain asks again before each step). */
export function isResumable(job: Pick<InterruptedJobRun, 'jobName' | 'interruptedRuns'>): boolean {
  return job.interruptedRuns >= 1 && resumeRefusal(job, true) === null
}

/**
 * Decide one interrupted job: true to rerun it. A run found dead in this sweep is always alerted,
 * since nothing recorded it before; one the shutdown recorded is alerted only when it is not rerun.
 */
async function settle(job: InterruptedJobRun, scheduled: boolean, diedNow: boolean): Promise<boolean> {
  const { jobName, interruptedRuns } = job
  const refusal = resumeRefusal(job, scheduled)
  if (refusal === null) {
    log.info({ jobName, interruptedRuns }, 'interrupted, resuming')
    if (diedNow) alert(job, `${jobName} is resumed now.`)
    return true
  }
  log.warn({ jobName, interruptedRuns }, 'interrupted, not resuming')
  await clearInterruptedRuns(jobName)
  alert(job, refusal)
  return false
}

/** Why an interrupted job is not rerun now, as the notice says it; null when it is rerun. */
function resumeRefusal({ jobName, interruptedRuns }: Pick<InterruptedJobRun, 'jobName' | 'interruptedRuns'>, scheduled: boolean): string | null {
  if (!scheduled) return `${jobName} is not resumed automatically while it is not scheduled (disabled); run it from the Jobs page.`
  if (!RESUMABLE_JOBS.has(jobName)) {
    return `${jobName} is not resumed automatically, since a rerun could repeat what the interrupted run already did; it waits for its next scheduled run, or run it from the Jobs page.`
  }
  if (interruptedRuns > config.scheduler.maxResumes) {
    return `${jobName} was interrupted ${interruptedRuns} times in a row and is not resumed automatically; it waits for its next scheduled run, or run it from the Jobs page.`
  }
  return null
}

/** The job's failure notice, with the recorded reason first and what happens next. */
function alert(job: InterruptedJobRun, next: string): void {
  const message = job.lastError ? `${job.lastError} ${next}` : next
  notify({ ...jobFailureNotice(job.jobName, message), title: `Job ${job.jobName} interrupted` }).catch(() => {})
}
