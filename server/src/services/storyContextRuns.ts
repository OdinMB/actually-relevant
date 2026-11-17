/**
 * One story's context run in production (`.context/story-context.md`, "Runs"): the run row, the
 * production deps (one structured-output call per step on its tier's model, `structuredCall`, after
 * the shared rate-limit delay, never wrapped in `withRetry`, its cost at standard price, so the recorded cost
 * is an upper bound; the search with its cache and the publishers' opt-out check), the pipeline, and
 * one transaction that writes the facts, the boxes and the run's result, while the run is still
 * `running`. A run row is claimed, and a failed one reopened for its second attempt, under one
 * advisory lock, never while another run of the story is running, so the step and an editor's run
 * (`storyContextOnDemand.ts`) never overlap on a story. Each run builds on the story's earlier
 * completed runs (`loadEarlierWork`), and its boxes take over the editor's choices on the earlier
 * cards. A run cut off by a restart is marked failed after `staleRunMinutes`, and settles its story.
 */
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { isRetryableError } from '../lib/retry.js'
import { researchSourcePolicy } from './publisherOptOut.js'
import { sanitizedError } from './researchRuns.js'
import { loadContextInput, loadEarlierWork } from './storyContextInput.js'
import {
  buildStoryContext,
  CONTEXT_STEP_TIERS,
  type ContextCall,
  type ContextDeps,
  type ContextOutcome,
  type StoryContextResult,
} from './storyContextPipeline.js'
import { boxRow, editorChoices, factRow } from './storyContextRecords.js'
import { contextSearch } from './storyContextSearch.js'
import { structuredCall } from './structuredCall.js'

const log = createLogger('story_context')

const INTERRUPTED = 'interrupted: the server restarted during the run'

/**
 * A failure that may pass on a later attempt, once the SDK's and `withRetry`'s own retries are spent
 * (`.context/story-context.md`, "Failures"): a rate limit, a server error, a timeout or a lost
 * connection. A refused request, a missing key, an answer of the wrong shape and an error of ours do not.
 */
export function transientFailure(err: unknown): boolean {
  if (isRetryableError(err)) return true
  if (!(err instanceof Error)) return false
  // LangChain rethrows the SDK's timeout under this name; the SDK's connection errors carry no status
  return err.name === 'TimeoutError' || ['APIConnectionError', 'APIConnectionTimeoutError'].includes(err.constructor.name)
}

/** Production's step caller: the step's tier (`structuredCall`), a thrown error judged for a second attempt. */
const productionCall: ContextCall = async <T>(step: keyof typeof CONTEXT_STEP_TIERS, schema: z.ZodType<T>, prompt: string) => {
  const { error, ...result } = await structuredCall(CONTEXT_STEP_TIERS[step], schema, prompt)
  return result.outcome === 'error' ? { ...result, transient: transientFailure(error) } : result
}

export function productionDeps(): ContextDeps {
  return {
    call: productionCall,
    search: request => contextSearch(request, researchSourcePolicy),
    sourcePolicy: researchSourcePolicy,
    transient: transientFailure,
  }
}

type Db = Prisma.TransactionClient | typeof prisma

/** Arbitrary constant key of the transaction-level advisory lock under which a context run is claimed (not research's or the TTS one). */
const CONTEXT_RUN_LOCK = 7_303_301

/** Mark the `running` runs older than `staleRunMinutes` failed: the server restarted during them. Each settles its story. */
export async function markInterruptedContextRuns(now: Date = new Date(), db: Db = prisma): Promise<number> {
  const { count } = await db.storyContextRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(now.getTime() - config.storyContext.staleRunMinutes * 60_000) } },
    data: { status: 'failed', outcome: 'technical', error: INTERRUPTED, finishedAt: now },
  })
  return count
}

/**
 * Under the run lock, after marking stale runs: whether a run of the story other than `exceptRunId`
 * is running. The lock makes the check and the write after it one step, so two starts (the step's,
 * an editor's) never both run on a story.
 */
async function otherRunRunning(tx: Prisma.TransactionClient, storyId: string, exceptRunId: string | null): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CONTEXT_RUN_LOCK}::bigint)`
  await markInterruptedContextRuns(new Date(), tx)
  return (await tx.storyContextRun.count({ where: { storyId, status: 'running', ...(exceptRunId ? { id: { not: exceptRunId } } : {}) } })) > 0
}

/**
 * Write a story's run row (`running`), unless a run of the story is running: then null, and nothing
 * is written. The one way the step and an editor start a run (`.context/story-context.md`, "On demand").
 */
export async function claimContextRun(storyId: string): Promise<string | null> {
  return prisma.$transaction(async tx => {
    if (await otherRunRunning(tx, storyId, null)) return null
    const run = await tx.storyContextRun.create({ data: { storyId, status: 'running', startedAt: new Date() }, select: { id: true } })
    return run.id
  })
}

/** An error outside a story's run: a failed run settles the story, so the next run does not take it again. */
export async function recordFailedRun(storyId: string, error: string, now: Date = new Date()): Promise<string> {
  const run = await prisma.storyContextRun.create({
    data: { storyId, status: 'failed', outcome: 'technical', error, startedAt: now, finishedAt: now },
    select: { id: true },
  })
  return run.id
}

export interface ContextRunOutcome {
  runId: string
  status: StoryContextResult['status']
  outcome: ContextOutcome
  boxes: number
  /** The item tally of a completed run; zero for any other. */
  tally: { checked: number; failed: number }
  /** False when the run was marked interrupted before it finished, or was no failure to try again: nothing was written. */
  written: boolean
  /** A technical failure that may pass on a later attempt (`transientFailure`): the step tries it once more in the same run. */
  transient: boolean
}

/** The boxes of the story's newest run other than `runId` that wrote any: the cards the editor last saw and chose for. */
async function previousBoxes(tx: Prisma.TransactionClient, storyId: string, runId: string) {
  const newest = await tx.contextBox.findFirst({
    where: { storyId, runId: { not: runId } },
    orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }],
    select: { runId: true },
  })
  if (!newest) return []
  return tx.contextBox.findMany({ where: { runId: newest.runId }, select: { type: true, status: true, place: true, placeByEditor: true } })
}

/**
 * Store the result while the run is still `running`, in one transaction: the run's status, outcome
 * and record, every fact with its verdict, and the kept boxes in order, each taking over the editor's
 * choices on the earlier cards of its type (`editorChoices`). Its costs are added to the row's, so a
 * second attempt on the same row counts both.
 */
export async function storeContextResult(runId: string, storyId: string, result: StoryContextResult, now: Date = new Date()): Promise<boolean> {
  const tavilyCredits = result.credits
  const costUsd = result.modelUsd + tavilyCredits * config.research.tavilyUsdPerCredit
  const facts = new Map(result.facts.map(f => [f.ref, f]))
  return prisma.$transaction(async tx => {
    const { count } = await tx.storyContextRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: result.status,
        outcome: result.outcome,
        boxes: result.boxes.length,
        costUsd: { increment: costUsd },
        modelUsd: { increment: result.modelUsd },
        tavilyCredits: { increment: tavilyCredits },
        result: result.record as unknown as Prisma.InputJsonObject,
        error: result.error,
        finishedAt: now,
      },
    })
    if (count === 0) return false
    if (result.facts.length > 0) await tx.contextFact.createMany({ data: result.facts.map(f => factRow(storyId, runId, f)) })
    if (result.boxes.length > 0) {
      const choice = editorChoices(await previousBoxes(tx, storyId, runId))
      await tx.contextBox.createMany({
        data: result.boxes.map((box, position) => ({ ...boxRow({ storyId, runId }, box, position, facts, result.writer, now), ...choice(box.type) })),
      })
    }
    return true
  })
}

/**
 * Open a technical failure's row again for its second attempt: `running`, its error cleared, its
 * start and costs kept. False when the row is no such failure any more, or while another run of the
 * story is running (under the run lock).
 */
export async function reopenFailedRun(runId: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const row = await tx.storyContextRun.findUnique({ where: { id: runId }, select: { storyId: true } })
    if (!row?.storyId || (await otherRunRunning(tx, row.storyId, runId))) return false
    const { count } = await tx.storyContextRun.updateMany({
      where: { id: runId, status: 'failed', outcome: 'technical' },
      data: { status: 'running', outcome: null, error: null, finishedAt: null },
    })
    return count > 0
  })
}

/**
 * Build one story's context: the run row, the step's way (`claimContextRun`; null, with nothing
 * written, while another run of the story is running, an editor's), then `executeContextRun`. `again`
 * names a technical failure's run to try once more on its own row (`reopenFailedRun`), so only the
 * last attempt's outcome is stored and its costs are added to the first's (`.context/story-context.md`,
 * "Failures"); a run that is no such failure any more, or while another runs, is left as it is.
 */
export async function runStoryContext(
  storyId: string,
  deps: ContextDeps = productionDeps(),
  again: { runId: string } | null = null,
): Promise<ContextRunOutcome | null> {
  if (again) {
    if (!(await reopenFailedRun(again.runId))) return { runId: again.runId, status: 'failed', outcome: 'technical', written: false, ...NONE }
    return executeContextRun(storyId, again.runId, deps, 2)
  }
  const runId = await claimContextRun(storyId)
  return runId === null ? null : executeContextRun(storyId, runId, deps, 1)
}

const NONE = { boxes: 0, tally: { checked: 0, failed: 0 }, transient: false }

/**
 * One attempt on a claimed (`running`) row: its input and the story's earlier work
 * (`loadEarlierWork`, so the run builds on the story's earlier completed runs), the pipeline with
 * `deps`, the store. A story neither selected nor published, or without research facts, is recorded as skipped.
 * A failure outside the pipeline fails the run with a sanitized error; only a database error while
 * recording that failure throws.
 */
export async function executeContextRun(storyId: string, runId: string, deps: ContextDeps, attempt: 1 | 2): Promise<ContextRunOutcome> {
  const none = NONE
  const run = { id: runId }
  try {
    const loaded = await loadContextInput(prisma, storyId)
    const input = loaded && { ...loaded, earlier: await loadEarlierWork(prisma, storyId) }
    if (!input) {
      await prisma.storyContextRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: { status: 'skipped', outcome: 'no-research', error: null, finishedAt: new Date() },
      })
      return { runId: run.id, status: 'skipped', outcome: 'no-research', written: true, ...none }
    }
    await prisma.storyContextRun.update({ where: { id: run.id }, data: { researchRunId: input.researchRunId } })
    const result = await buildStoryContext(input, deps)
    const written = await storeContextResult(run.id, storyId, result)
    log.info(
      {
        runId: run.id,
        storyId,
        attempt,
        status: result.status,
        outcome: result.outcome,
        transient: result.transient,
        boxes: result.boxes.length,
        ...result.record.tally,
      },
      'story context run finished',
    )
    return {
      runId: run.id,
      status: result.status,
      outcome: result.outcome,
      boxes: result.boxes.length,
      tally: result.status === 'completed' ? result.record.tally : none.tally,
      written,
      transient: written && result.status === 'failed' && result.transient,
    }
  } catch (err) {
    const error = sanitizedError(err)
    log.error({ runId: run.id, storyId, error }, 'story context run failed')
    await prisma.storyContextRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: { status: 'failed', outcome: 'technical', error, finishedAt: new Date() },
    })
    return { runId: run.id, status: 'failed', outcome: 'technical', written: true, ...none }
  }
}
