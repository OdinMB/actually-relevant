/**
 * Running research passes in production (`.context/research-passes.md`, "Running a pass"): the
 * production deps (the metered calls and searches, the opt-out policy, `transientFailure`); the
 * execution of a claimed pass (`researchPassLifecycle.ts` claims and settles its row), with one second
 * attempt for a failure that may pass; and the apply (`researchPassApply.ts`). The research pass step
 * (`jobs/researchPass.ts`) runs passes on selected stories (`runPipelinePass`); an editor's "Research
 * again" runs one as a one-story `research` task, or a batch in one task, in a run scope of the step's
 * job, so its spend is added to `research_pass`'s month and checked against that warning level.
 * Nothing here runs while the step's switch is closed (`passSwitchRefusal`). Refusals are ServiceErrors.
 */
import { config } from '../config.js'
import { addMonthSpend } from '../jobs/jobLease.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { sanitizedError, transientFailure } from '../lib/runErrors.js'
import { createRunScope, runInScope, settleRun, type RunScope } from '../lib/runUsage.js'
import { Semaphore } from '../lib/semaphore.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { ConflictError, NotFoundError, ServiceError } from '../utils/errors.js'
import { researchSourcePolicy } from './publisherOptOut.js'
import { createRunMeter, type RunMeter } from './researchCalls.js'
import { RESEARCHABLE_STATUSES, researchStoriesByIds } from './researchInput.js'
import { runResearchPass, type PassDeps } from './researchPass.js'
import { applyPass, type PassApplied } from './researchPassApply.js'
import { loadPassInput, passEligibility } from './researchPassInput.js'
import { claimPass, failPass, recordSkippedPass, skipClaimedPass, type PassClaim } from './researchPassLifecycle.js'
import { PASS_JOB_DISABLED, passStepState, passSwitchRefusal, RESEARCH_PASS_JOB } from './researchPassQueue.js'
import { passItemTally, type PassOutcome } from './researchPassRecord.js'
import { monthToDateUsd } from './researchSpend.js'
import type { ReadState } from './researchWrites.js'
import { checkSpendWarnings } from './spending.js'
import { contextSearch } from './storyContextSearch.js'
import type { Actor } from './storyLifecycle.js'

const log = createLogger('research_pass')

const BUSY = 'A research pass of this story is already running'

const usd = (v: number) => `$${v.toFixed(2)}`

const capRefusal = (spentUsd: number, ceilingUsd: number) =>
  `This month's research cap is reached: ${usd(spentUsd)} of ${usd(config.research.monthlyCapUsd)} spent, and a pass reserves ${usd(ceilingUsd)}`

/** Production's deps over the pass's meter: its calls and searches, the gap search with its cache and opt-out check, the opt-out policy. */
export function productionPassDeps(meter: RunMeter): PassDeps {
  return {
    call: meter.call,
    tavily: meter.tavily,
    search: request => meter.search(request),
    admit: meter.admit,
    sourcePolicy: researchSourcePolicy,
    transient: transientFailure,
    relevanceMin: config.selection.relevanceMin,
    // The pass's time caps the coverage window, so a fresh story never asks for a future date
    latestDate: new Date().toISOString(),
  }
}

/** The meter of one pass: its ceiling, and what the month's cap leaves beside every other run and pass. */
function passMeter(claim: PassClaim): RunMeter {
  return createRunMeter({
    ceilingUsd: claim.ceilingUsd,
    monthRoomUsd: async () => config.research.monthlyCapUsd - (await monthToDateUsd(prisma, new Date(), { passId: claim.passId })),
    gapSearch: request => contextSearch(request, researchSourcePolicy),
    transient: transientFailure,
  })
}

/**
 * How a pass ended: completed or failed with its outcome and what its apply did; skipped at $0 (a
 * story the loader cannot research); or failed outside the pass (its reservation kept).
 */
export type PassEnd =
  | {
      ended: 'completed' | 'failed'
      outcome: PassOutcome
      applied: PassApplied
      /** Why nothing was applied (`skipped`, `dropped`); null otherwise. */
      why: string | null
      triedTwice: boolean
      tally: { checked: number; failed: number }
    }
  | { ended: 'skipped'; reason: string }
  | { ended: 'error'; error: string }

const UNREADABLE = 'the story lacks the analysis research needs'

export interface ExecuteOptions {
  actor: Actor
  /** The story as read before the claim: the apply is fenced on it. */
  read: ReadState
  /** Re-read once the pass is done: false when the step was switched off meanwhile, so nothing is applied. */
  applies?: () => Promise<boolean>
  /** The eval's and tests' deps over the meter; production's by default. */
  deps?: (meter: RunMeter) => PassDeps
}

/**
 * Run the claimed pass and apply it; never throws. A failure that may pass (`transient`) is tried once
 * more in the same pass. A story the loader cannot research ends the pass `skipped` at $0. An error
 * outside the pipeline fails the pass at its reservation.
 */
export async function executePass(storyId: string, claim: PassClaim, options: ExecuteOptions): Promise<PassEnd> {
  try {
    const now = new Date()
    const input = await loadPassInput(prisma, storyId, claim.passId, now)
    if (!input) {
      await skipClaimedPass(claim.passId, UNREADABLE, now)
      return { ended: 'skipped', reason: UNREADABLE }
    }
    const meter = passMeter(claim)
    const deps = (options.deps ?? productionPassDeps)(meter)
    let result = await runResearchPass(input, deps)
    const triedTwice = result.status === 'failed' && result.transient
    if (triedTwice) {
      log.info({ storyId, passId: claim.passId, error: result.error }, 'trying the research pass once more')
      result = await runResearchPass(input, deps)
    }
    const applies = options.applies ? await options.applies() : true
    const { applied, why } = await applyPass({
      storyId,
      passId: claim.passId,
      actor: options.actor,
      read: options.read,
      result,
      spentUsd: meter.spentUsd(),
      applies,
    })
    log.info({ storyId, passId: claim.passId, kind: result.kind, outcome: result.outcome, applied, costUsd: meter.spentUsd() }, 'research pass finished')
    return { ended: result.status, outcome: result.outcome, applied, why, triedTwice, tally: passItemTally(result.record) }
  } catch (err) {
    const error = sanitizedError(err)
    log.error({ storyId, passId: claim.passId, error }, 'research pass failed')
    await failPass(claim.passId, error)
    return { ended: 'error', error }
  }
}

/**
 * What a pipeline pass came to: `passed` (it ran, as `end` says), `refused` (a $0 skipped pass
 * recorded, so the publish gate stops waiting: the cap, or a story the loader cannot research), or
 * `busy` (an editor's pass of the story running: nothing written, tried again next run).
 */
export type PipelinePassOutcome = { outcome: 'passed'; end: PassEnd } | { outcome: 'refused'; reason: string } | { outcome: 'busy' }

/** One selected story's pass for the step, applied as it ends unless `applies` says the step was switched off meanwhile. */
export async function runPipelinePass(storyId: string, read: ReadState, applies: () => Promise<boolean>, now: Date = new Date()): Promise<PipelinePassOutcome> {
  const [story] = await researchStoriesByIds(prisma, [storyId])
  if (!story) {
    await recordSkippedPass(storyId, UNREADABLE, now)
    return { outcome: 'refused', reason: UNREADABLE }
  }
  const claim = await claimPass(storyId, 'pipeline', now)
  if ('refused' in claim) {
    if (claim.refused === 'in-progress') return { outcome: 'busy' }
    await recordSkippedPass(storyId, 'monthly cap reached', now)
    return { outcome: 'refused', reason: 'monthly cap reached' }
  }
  log.info({ storyId, passId: claim.passId, kind: claim.kind }, 'research pass step pass started')
  return { outcome: 'passed', end: await executePass(storyId, claim, { actor: 'pipeline', read, applies }) }
}

// ---------------------------------------------------------------------------
// An editor's "Research again"
// ---------------------------------------------------------------------------

/** Why no editor's pass can start now, whatever the story: the step's switch, or its job disabled (the button shows only while it is enabled). */
export async function editorRefusal(): Promise<string | null> {
  const off = passSwitchRefusal()
  if (off) return off
  const { enabled } = await passStepState()
  return enabled ? null : PASS_JOB_DISABLED
}

const isResearchable = (status: string) => (RESEARCHABLE_STATUSES as readonly string[]).includes(status)

/**
 * An editor's pass of one story, checked and claimed: 409 while passes are switched off, 404 for an
 * unknown story, 409 for a status other than analyzed, selected or published, a story without the
 * analysis research needs, a pass of it running, or at the cap. The one path the button and the bulk
 * action take.
 */
export async function claimEditorPass(storyId: string, now: Date = new Date()): Promise<{ claim: PassClaim; read: ReadState }> {
  const off = await editorRefusal()
  if (off) throw new ConflictError(off)
  const eligibility = await passEligibility(prisma, storyId)
  if (!eligibility) throw new NotFoundError('Story not found')
  if (!isResearchable(eligibility.status)) {
    throw new ConflictError(`Only analyzed, selected or published stories can be researched; this one is ${eligibility.status}`)
  }
  if (eligibility.running) throw new ConflictError(BUSY)
  const [story] = await researchStoriesByIds(prisma, [storyId])
  if (!story) throw new ConflictError('This story lacks the analysis research needs')
  const row = await prisma.story.findUniqueOrThrow({ where: { id: storyId }, select: { status: true, updatedAt: true } })
  const claim = await claimPass(storyId, 'editor', now)
  if ('refused' in claim) throw new ConflictError(claim.refused === 'cap' ? capRefusal(claim.spentUsd, claim.ceilingUsd) : BUSY)
  return { claim, read: { status: row.status, updatedAt: row.updatedAt } }
}

/** Add what the pass spent to the step's month and check its warning levels; never throws. */
async function recordSpend(scope: RunScope, storyId: string): Promise<void> {
  try {
    const usage = await settleRun(scope)
    await addMonthSpend(RESEARCH_PASS_JOB, usage)
    if (usage.costUsd > 0) await checkSpendWarnings(RESEARCH_PASS_JOB)
  } catch (err) {
    log.error({ storyId, error: sanitizedError(err) }, "could not record the research pass's spend")
  }
}

/**
 * The claimed pass, counted in its task; never throws; the caller completes the task. A failure
 * outside the pass (its run scope, the task's counts) fails the pass at its reservation, so no pass
 * is left `running` until a restart's stale rule finds it.
 */
async function passInTask(taskId: string, storyId: string, claimed: { claim: PassClaim; read: ReadState }): Promise<void> {
  const { passId } = claimed.claim
  try {
    // A person waits on it: standard price, never flex
    const scope = createRunScope({ jobName: RESEARCH_PASS_JOB, flex: false })
    const end = await runInScope(scope, () => executePass(storyId, claimed.claim, { actor: 'editor', read: claimed.read }))
    // A pass whose result the story never took is no "Researched again": the editor is told why
    if (end.ended === 'completed' && end.why) taskRegistry.skip(taskId, storyId, `Not applied: ${end.why}`)
    else if (end.ended === 'completed') taskRegistry.increment(taskId, 'completed')
    else if (end.ended === 'skipped') taskRegistry.skip(taskId, storyId, `Not researched: ${end.reason}`)
    else taskRegistry.increment(taskId, 'failed', end.ended === 'error' ? end.error : 'The pass failed on a technical problem; the pass view shows the error')
    await recordSpend(scope, storyId)
  } catch (err) {
    const error = sanitizedError(err)
    log.error({ taskId, storyId, passId, error }, 'research pass task failed outside the pass; the pass is failed at its reservation')
    await failPass(passId, error)
    taskRegistry.increment(taskId, 'failed', error)
  }
}

/** Start an editor's pass of one story in the background, as a one-story task; refusals as `claimEditorPass`'s. */
export async function startEditorPass(storyId: string, now: Date = new Date()): Promise<{ taskId: string; passId: string }> {
  const claimed = await claimEditorPass(storyId, now)
  const taskId = taskRegistry.create('research', 1, [storyId])
  log.info({ storyId, passId: claimed.claim.passId, taskId }, 'research pass started by an editor')
  void passInTask(taskId, storyId, claimed)
    .catch((err: unknown) => log.error({ taskId, storyId, error: sanitizedError(err) }, 'research pass task failed'))
    .finally(() => taskRegistry.complete(taskId))
  return { taskId, passId: claimed.claim.passId }
}

/** Claim and run one story of a batch, or record why not; never throws. */
async function batchOne(taskId: string, storyId: string): Promise<void> {
  try {
    await passInTask(taskId, storyId, await claimEditorPass(storyId))
  } catch (err) {
    if (err instanceof ServiceError) return void taskRegistry.skip(taskId, storyId, err.message)
    const error = sanitizedError(err)
    log.error({ taskId, storyId, error }, 'bulk research pass failed on a story before its pass; going on with the next')
    taskRegistry.increment(taskId, 'failed', error)
  }
}

/**
 * Start editors' passes of the chosen stories as one `research` task, `config.research.pass.concurrency`
 * at a time: 409 while passes are switched off or another task processes every one of them. Each takes
 * the button's path when its turn comes, so a later one sees the cost of those before it; a refused
 * story is skipped with the reason.
 */
export async function startEditorPassBatch(storyIds: string[]): Promise<{ taskId: string }> {
  const off = await editorRefusal()
  if (off) throw new ConflictError(off)
  const chosen = [...new Set(storyIds)]
  const processing = new Set(taskRegistry.getProcessingStoryIds())
  const queued = chosen.filter(id => !processing.has(id))
  if (queued.length === 0) throw new ConflictError('All stories are already being processed')
  const taskId = taskRegistry.create('research', chosen.length, queued)
  for (const id of chosen) if (processing.has(id)) taskRegistry.skip(taskId, id, 'Already being processed by another task')
  const semaphore = new Semaphore(config.research.pass.concurrency)
  void Promise.all(queued.map(id => semaphore.run(() => batchOne(taskId, id))))
    .catch((err: unknown) => log.error({ taskId, error: sanitizedError(err) }, 'bulk research passes failed'))
    .finally(() => taskRegistry.complete(taskId))
  log.info({ taskId, stories: queued.length }, 'bulk research passes started')
  return { taskId }
}
