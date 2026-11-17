/**
 * One story's context run in production (`.context/story-context.md`, "Runs"): the run row, the
 * production deps (one structured-output call per step on its tier's model, `structuredCall`, after
 * the shared rate-limit delay, never wrapped in `withRetry`, its cost at standard price, so the recorded cost
 * is an upper bound; the search with its cache and the publishers' opt-out check), the pipeline, and
 * one transaction that writes the facts, the boxes and the run's result, while the run is still
 * `running`. A run cut off by a restart is marked failed after `staleRunMinutes`, and settles its story.
 */
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { isRetryableError } from '../lib/retry.js'
import { researchSourcePolicy } from './publisherOptOut.js'
import { sanitizedError } from './researchRuns.js'
import { loadContextInput } from './storyContextInput.js'
import {
  buildStoryContext,
  CONTEXT_STEP_TIERS,
  type ContextCall,
  type ContextDeps,
  type ContextOutcome,
  type StoryContextResult,
} from './storyContextPipeline.js'
import { boxRow, factRow } from './storyContextRecords.js'
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

/** Mark the `running` runs older than `staleRunMinutes` failed: the server restarted during them. Each settles its story. */
export async function markInterruptedContextRuns(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.storyContextRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(now.getTime() - config.storyContext.staleRunMinutes * 60_000) } },
    data: { status: 'failed', outcome: 'technical', error: INTERRUPTED, finishedAt: now },
  })
  return count
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

/**
 * Store the result while the run is still `running`, in one transaction: the run's status, outcome
 * and record, every fact with its verdict, and the kept boxes in order. Its costs are added to the
 * row's, so a second attempt on the same row counts both.
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
    if (result.boxes.length > 0)
      await tx.contextBox.createMany({ data: result.boxes.map((box, position) => boxRow({ storyId, runId }, box, position, facts, result.writer, now)) })
    return true
  })
}

/**
 * Open a technical failure's row again for a second attempt in the same run of the step: `running`,
 * its error cleared, its start and costs kept. False when the row is no such failure any more.
 */
async function reopenFailedRun(runId: string): Promise<boolean> {
  const { count } = await prisma.storyContextRun.updateMany({
    where: { id: runId, status: 'failed', outcome: 'technical' },
    data: { status: 'running', outcome: null, error: null, finishedAt: null },
  })
  return count > 0
}

/**
 * Build one story's context: the run row, its input, the pipeline with production's deps, the
 * store. A story that is not published or has no research facts is recorded as skipped. A failure
 * outside the pipeline fails the run with a sanitized error; only a database error before the run
 * exists throws. `again` names a technical failure's run to try once more on its own row, so only
 * the last attempt's outcome is stored and its costs are added to the first's (`.context/story-context.md`,
 * "Failures"); a run that is no such failure any more is left as it is.
 */
export async function runStoryContext(
  storyId: string,
  deps: ContextDeps = productionDeps(),
  again: { runId: string } | null = null,
): Promise<ContextRunOutcome> {
  const none = { boxes: 0, tally: { checked: 0, failed: 0 }, transient: false }
  if (again && !(await reopenFailedRun(again.runId))) return { runId: again.runId, status: 'failed', outcome: 'technical', written: false, ...none }
  const run = again
    ? { id: again.runId }
    : await prisma.storyContextRun.create({ data: { storyId, status: 'running', startedAt: new Date() }, select: { id: true } })
  try {
    const input = await loadContextInput(prisma, storyId)
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
        attempt: again ? 2 : 1,
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
