/**
 * Chains (`.context/scheduler.md`, "Chains"): jobs run as ordered steps from one start time, each step
 * starting when the one before it has finished, instead of separate schedules with guessed gaps
 * between them. A chain is itself a job (its `job_runs` row holds its schedule, its on/off, its lease
 * and its flex cut-off and deadline), and its steps are ordinary jobs that no longer run on their own
 * schedules. Each step has a mode, set on its own row:
 *
 * - **On** (`enabled`): runs.
 * - **Off** (not `enabled`): skipped; the next step runs on what there is.
 * - **Review** (`enabled` and `pause_for_review`): runs, then the chain waits for a person, who
 *   continues it from the Jobs page. The next scheduled run starts from the first step again.
 *
 * A step that fails stops the chain there, and the chain's run fails with the step's error; the
 * Jobs page can resume it from that step. A run cut off by a restart resumes from the step it was in.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { JOB_HANDLERS } from './handlers.js'
import { runJob } from './scheduler.js'
import { CHAINS } from './chainDefinitions.js'

const log = createLogger('chains')

export type ResumeReason = 'running' | 'review' | 'failed'

interface ChainRow {
  interruptedRuns: number
  resumeStep: string | null
  resumeReason: string | null
}

/**
 * The step a run starts at. A scheduled run (or Run on the Jobs page) starts from the first step,
 * unless the last run was cut off by a restart, which it resumes from the step it was in. Continue
 * starts at the step after a review pause, or at the step the chain stopped at; null when there is
 * nothing to continue.
 */
export function startStep(steps: readonly string[], row: ChainRow, mode: 'start' | 'continue'): number | null {
  const at = row.resumeStep ? steps.indexOf(row.resumeStep) : -1
  if (mode === 'continue') return at >= 0 && (row.resumeReason === 'review' || row.resumeReason === 'failed') ? at : null
  return at >= 0 && row.resumeReason === 'running' && row.interruptedRuns > 0 ? at : 0
}

/** Whether Continue has anything to do for this chain row. */
export function canContinue(chainName: string, row: ChainRow): boolean {
  const steps = CHAINS[chainName]
  return steps !== undefined && startStep(steps, row, 'continue') !== null
}

async function setResume(chainName: string, step: string | null, reason: ResumeReason | null): Promise<void> {
  await prisma.jobRun.update({ where: { jobName: chainName }, data: { resumeStep: step, resumeReason: reason } })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Run one step. A step already running (a run by hand, or another process) is waited for, then run,
 * so the chain never goes on past a step that has not run for it.
 */
async function runStep(step: string): Promise<{ result: 'succeeded' } | { result: 'failed'; error: string }> {
  const handler = JOB_HANDLERS[step]
  if (!handler) return { result: 'failed', error: `no handler for ${step}` }
  const { stepWaitMinutes, stepWaitPollMs } = config.chains
  const giveUpAt = Date.now() + stepWaitMinutes * 60_000
  let waited = false
  for (;;) {
    const outcome = await runJob(step, handler)
    if (outcome.result !== 'skipped') return outcome
    if (Date.now() >= giveUpAt) return { result: 'failed', error: `${step} was still running after ${stepWaitMinutes} minutes of waiting for it` }
    if (!waited) log.info({ step }, 'step already running; waiting for it')
    waited = true
    await sleep(stepWaitPollMs)
  }
}

/** The chain's run: its steps in order from where it starts (`startStep`), as its job handler. */
export async function runChain(chainName: string, mode: 'start' | 'continue' = 'start'): Promise<void> {
  const steps = CHAINS[chainName]
  if (!steps) throw new Error(`${chainName} is not a chain`)
  const row = await prisma.jobRun.findUnique({ where: { jobName: chainName } })
  if (!row) throw new Error(`chain ${chainName} has no job_runs row`)
  const first = startStep(steps, row, mode)
  if (first === null) throw new Error(`${chainName} has nothing to continue`)
  if (first > 0) log.info({ chainName, step: steps[first], mode }, 'going on from a step')

  for (let i = first; i < steps.length; i++) {
    const step = steps[i]!
    await setResume(chainName, step, 'running')
    const stepRow = await prisma.jobRun.findUnique({ where: { jobName: step }, select: { enabled: true, pauseForReview: true } })
    if (!stepRow) throw new Error(`step ${step} has no job_runs row`)
    if (!stepRow.enabled) {
      log.info({ chainName, step }, 'step is off, skipping')
      continue
    }

    const outcome = await runStep(step)
    if (outcome.result === 'failed') {
      await setResume(chainName, step, 'failed')
      throw new Error(`Stopped at ${step}, so the steps after it did not run: ${outcome.error}`)
    }

    const next = steps[i + 1]
    if (stepRow.pauseForReview && next) {
      await setResume(chainName, next, 'review')
      log.info({ chainName, step, next }, 'waiting for review')
      notify({
        source: 'jobs',
        severity: 'info',
        title: `${chainName} waits for review`,
        message: `${step} has finished and is set to Review. Check its results, then continue the chain from the Jobs page; ${next} runs next.`,
        link: '/admin/jobs',
        dedupeKey: `chain-review:${chainName}`,
      }).catch(() => {})
      return
    }
  }
  await setResume(chainName, null, null)
}
