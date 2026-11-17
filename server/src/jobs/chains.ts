/**
 * Chains (`.context/scheduler.md`, "Chains"): jobs run as ordered steps from one start time, each step
 * starting when the one before it has finished, instead of separate schedules with guessed gaps
 * between them. A chain is itself a job (its `job_runs` row holds its schedule, its on/off, its lease
 * and its flex cut-off, in hours from each run's start), and its steps are ordinary jobs that no
 * longer run on their own schedules. Each step has a mode, set on its own row:
 *
 * - **On** (`enabled`): runs.
 * - **Off** (not `enabled`): skipped; the next step runs on what there is.
 * - **Review** (`enabled` and `pause_for_review`): runs, then the chain waits for a person, who
 *   continues it from the Jobs page with the next step that is on; with no step on after it, the
 *   chain just ends. The next scheduled run starts from the first step again.
 *
 * A step can also have a "not before" time (`not_before`, "HH:MM" or "Sat 07:00", on the step's own
 * clock: `jobTimeZone`, else UTC): a chain that reaches it earlier holds there, its lease let go, and
 * goes on by itself when that time comes round after the run's start (the podcast's publish steps wait
 * for Saturday morning). A person can go on sooner from the Jobs page.
 *
 * A step that fails stops the chain there, and the chain's run fails with the step's error; the
 * Jobs page can resume it from that step. A step in `GOES_ON_PAST_FAILURE` (story context, before
 * publishing) is the exception: its failure stands on its own row, and the chain goes on. A run cut
 * off by a restart resumes from the step it was in.
 *
 * A step in `SPLIT_STEPS` (story context) does its work in two parts, each a run of its own job: one
 * at its place, the other once the chain's last step has run, while the step is on and the part has
 * work. A chain that stops or pauses before its end runs the second part when it reaches the end.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { JOB_HANDLERS, SPLIT_STEPS } from './handlers.js'
import { runJob } from './scheduler.js'
import { CHAINS, GOES_ON_PAST_FAILURE, nextStepTime } from './chainDefinitions.js'
import { jobTimeZone } from './jobTimeZones.js'
import { RESUMABLE_JOBS } from './interruptedRuns.js'

const log = createLogger('chains')

export type ResumeReason = 'running' | 'review' | 'waiting' | 'failed'

interface ChainRow {
  interruptedRuns: number
  resumeStep: string | null
  resumeReason: string | null
}

const CONTINUABLE: readonly (string | null)[] = ['review', 'waiting', 'failed']

/**
 * The step a run starts at. A scheduled run (or Run on the Jobs page) starts from the first step,
 * unless the last run was cut off by a restart, which it resumes from the step it was in. Continue
 * starts at the step after a review pause, at the step held for its time, or at the step the chain
 * stopped at; null when there is nothing to continue.
 */
export function startStep(steps: readonly string[], row: ChainRow, mode: 'start' | 'continue'): number | null {
  const at = row.resumeStep ? steps.indexOf(row.resumeStep) : -1
  if (mode === 'continue') return at >= 0 && CONTINUABLE.includes(row.resumeReason) ? at : null
  if (at < 0 || row.resumeReason !== 'running' || row.interruptedRuns === 0) return 0
  // A step whose rerun could repeat a side effect (a newsletter send) is not run again: the chain goes on after it
  return RESUMABLE_JOBS.has(steps[at]!) ? at : at + 1
}

/** Whether Continue has anything to do for this chain row. */
export function canContinue(chainName: string, row: ChainRow): boolean {
  const steps = CHAINS[chainName]
  return steps !== undefined && startStep(steps, row, 'continue') !== null
}

async function setResume(chainName: string, step: string | null, reason: ResumeReason | null, resumeAt: Date | null = null): Promise<void> {
  await prisma.jobRun.update({ where: { jobName: chainName }, data: { resumeStep: step, resumeReason: reason, resumeAt } })
}

/**
 * When a step with a "not before" time may run: the first time that time comes round after the chain's
 * run started, on the step's own clock (`jobTimeZone`, else UTC). A step reached after it runs at once,
 * so a late run never waits for the next one.
 */
export function holdUntil(notBefore: string | null, chainStartedAt: Date | null, now: Date, timeZone = 'UTC'): Date | null {
  const at = nextStepTime(notBefore, chainStartedAt ?? now, timeZone)
  return at && at.getTime() > now.getTime() ? at : null
}

// One timer per held chain, set when it is held and again at startup (`resumeHeldChains`)
const heldTimers = new Map<string, NodeJS.Timeout>()

function clearHold(chainName: string): void {
  clearTimeout(heldTimers.get(chainName))
  heldTimers.delete(chainName)
}

/** Go on with a held chain at its time, through the scheduler's lease like any other run. */
function scheduleHold(chainName: string, at: Date): void {
  clearHold(chainName)
  // setTimeout's limit is about 24.8 days; a hold is less than one
  const delay = Math.max(0, at.getTime() - Date.now())
  const timer = setTimeout(() => {
    heldTimers.delete(chainName)
    void (async () => {
      const row = await prisma.jobRun.findUnique({ where: { jobName: chainName }, select: { resumeReason: true, enabled: true } })
      // A person went on by hand, or switched the chain off, in the meantime
      if (row?.resumeReason !== 'waiting' || !row.enabled) return
      await runJob(chainName, () => runChain(chainName, 'continue'))
    })().catch(err => log.error({ err, chainName }, 'held chain failed to go on'))
  }, delay)
  timer.unref?.()
  heldTimers.set(chainName, timer)
}

/** At shutdown: drop every hold's timer; the rows keep the holds for the next start. */
export function clearHeldChains(): void {
  for (const chainName of [...heldTimers.keys()]) clearHold(chainName)
}

/** At startup: set the timers of chains that were held when the process stopped (overdue ones go on now). */
export async function resumeHeldChains(): Promise<void> {
  const held = await prisma.jobRun.findMany({
    where: { jobName: { in: Object.keys(CHAINS) }, resumeReason: 'waiting' },
    select: { jobName: true, resumeAt: true },
  })
  for (const { jobName, resumeAt } of held) scheduleHold(jobName, resumeAt ?? new Date())
}

/**
 * The first step after `index` that is on, or null: a review pause waits only for a step that will
 * run, so a Review with nothing on after it (the last step, or later steps all off) waits for nothing.
 */
async function nextStepOn(steps: readonly string[], index: number): Promise<string | null> {
  const later = steps.slice(index + 1)
  if (later.length === 0) return null
  const on = await prisma.jobRun.findMany({ where: { jobName: { in: [...later] }, enabled: true }, select: { jobName: true } })
  const names = new Set(on.map(row => row.jobName))
  return later.find(step => names.has(step)) ?? null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type StepOutcome = { result: 'succeeded' } | { result: 'failed'; error: string }

/**
 * Run one step's `handler` (its job's, or one part of a split step) as a run of the step's job. A
 * step already running (a run by hand, or another process) is waited for, then run, so the chain
 * never goes on past a step that has not run for it.
 */
async function runStep(step: string, handler: (() => Promise<void>) | undefined): Promise<StepOutcome> {
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

/** A failed step stops the chain (throws), unless its failure must not hold what comes after it. */
async function settleStep(chainName: string, step: string, outcome: StepOutcome): Promise<void> {
  if (outcome.result !== 'failed') return
  // Story context before publishing: its failure never holds the edition
  if (GOES_ON_PAST_FAILURE.has(step)) {
    log.warn({ chainName, step, error: outcome.error }, 'step failed; the chain goes on without it')
    return
  }
  await setResume(chainName, step, 'failed')
  throw new Error(`Stopped at ${step}, so the steps after it did not run: ${outcome.error}`)
}

/**
 * Once the chain's last step has run: the second part of each split step (`SPLIT_STEPS`), in step
 * order, while the step is on and the part has work. Cut off there, the chain resumes from that step,
 * whose parts redo only what is left.
 */
async function runEndParts(chainName: string, steps: readonly string[]): Promise<void> {
  for (const step of steps) {
    const split = SPLIT_STEPS[step]
    if (!split) continue
    const stepRow = await prisma.jobRun.findUnique({ where: { jobName: step }, select: { enabled: true } })
    if (!stepRow?.enabled || !(await split.due())) continue
    await setResume(chainName, step, 'running')
    await settleStep(chainName, step, await runStep(step, split.atEnd))
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
  // A new run from the first step drops a hold left from the last one, and starts the clock holds count from
  clearHold(chainName)
  let chainStartedAt = row.chainStartedAt
  if (first === 0 && mode === 'start') {
    chainStartedAt = new Date()
    await prisma.jobRun.update({ where: { jobName: chainName }, data: { chainStartedAt } })
  }

  for (let i = first; i < steps.length; i++) {
    const step = steps[i]!
    const stepRow = await prisma.jobRun.findUnique({ where: { jobName: step }, select: { enabled: true, pauseForReview: true, notBefore: true } })
    if (!stepRow) throw new Error(`step ${step} has no job_runs row`)
    if (!stepRow.enabled) {
      await setResume(chainName, step, 'running')
      log.info({ chainName, step }, 'step is off, skipping')
      continue
    }

    // Continuing by hand at a held step runs it now: the person chose not to wait
    const handContinued = i === first && mode === 'continue'
    const until = handContinued ? null : holdUntil(stepRow.notBefore, chainStartedAt, new Date(), jobTimeZone(step) ?? 'UTC')
    if (until) {
      await setResume(chainName, step, 'waiting', until)
      log.info({ chainName, step, until }, 'holding until the step’s time')
      scheduleHold(chainName, until)
      return
    }

    await setResume(chainName, step, 'running')
    await settleStep(chainName, step, await runStep(step, SPLIT_STEPS[step]?.atStep ?? JOB_HANDLERS[step]))

    const next = stepRow.pauseForReview ? await nextStepOn(steps, i) : null
    if (next) {
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
  await runEndParts(chainName, steps)
  await setResume(chainName, null, null)
}
