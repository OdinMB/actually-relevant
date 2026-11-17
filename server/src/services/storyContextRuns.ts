/**
 * One story's context run in production (`.context/story-context.md`, "Runs"): the run row, the
 * production deps (one structured-output call per step on its tier's model after the shared
 * rate-limit delay, never wrapped in `withRetry`, its cost at standard price, so the recorded cost
 * is an upper bound; the search with its cache and the publishers' opt-out check), the pipeline, and
 * one transaction that writes the facts, the boxes and the run's result, while the run is still
 * `running`. A run cut off by a restart is marked failed after `staleRunMinutes`, and settles its story.
 */
import { HumanMessage, type AIMessage } from '@langchain/core/messages'
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { classifyOutcome, contentText, finishReasonOf, usageFrom, ZERO_USAGE } from '../lib/llmUsage.js'
import prisma from '../lib/prisma.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { researchSourcePolicy } from './publisherOptOut.js'
import { callCostUsd } from './researchCost.js'
import { sanitizedError } from './researchRuns.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { loadContextInput } from './storyContextInput.js'
import {
  buildStoryContext,
  citedRefs,
  CONTEXT_STEP_TIERS,
  type ContextCall,
  type ContextDeps,
  type ContextOutcome,
  type StoryContextResult,
} from './storyContextPipeline.js'
import { contextSearch } from './storyContextSearch.js'
import { asOfColumns, factDate, periodStart } from './storyContextVisuals.js'

const log = createLogger('story_context')

const INTERRUPTED = 'interrupted: the server restarted during the run'

const modelOf = (step: keyof typeof CONTEXT_STEP_TIERS) => config.llm.models[CONTEXT_STEP_TIERS[step]].name

/** Production's step caller: the tier's model after the rate-limit delay, never in `withRetry` (the SDK retries). */
const productionCall: ContextCall = async <T>(step: keyof typeof CONTEXT_STEP_TIERS, schema: z.ZodType<T>, prompt: string) => {
  const model = modelOf(step)
  await rateLimitDelay()
  try {
    const result = await getLLMByTier(CONTEXT_STEP_TIERS[step])
      .withStructuredOutput(schema, { includeRaw: true })
      .invoke([new HumanMessage(prompt)])
    const raw = result.raw as AIMessage
    // The schema parsed it: the structured-output runnable types its result loosely
    const parsed = (result.parsed ?? null) as T | null
    const usage = usageFrom(raw)
    const outcome = classifyOutcome({ parsed, content: contentText(raw), finishReason: finishReasonOf(raw) })
    return { parsed: outcome === 'ok' ? parsed : null, outcome, usage, costUsd: callCostUsd(model, usage), model }
  } catch (err) {
    return { parsed: null, outcome: classifyOutcome({ error: err }), usage: ZERO_USAGE, costUsd: 0, model }
  }
}

export function productionDeps(): ContextDeps {
  return { call: productionCall, search: request => contextSearch(request, researchSourcePolicy), sourcePolicy: researchSourcePolicy }
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

/** The newest date a box's facts describe, with its precision; null when none is dated. */
function boxAsOf(box: DraftBox, facts: ReadonlyMap<string, ContextFactData>): string | null {
  let newest: string | null = null
  for (const ref of citedRefs(box)) {
    const f = facts.get(ref)
    const date = f ? factDate({ asOf: f.asOf, sourceDate: f.source.date }) : null
    if (date && (newest === null || periodStart(date) > periodStart(newest))) newest = date
  }
  return newest
}

function factRow(storyId: string, runId: string, f: ContextFactData): Prisma.ContextFactCreateManyInput {
  const asOf = asOfColumns(f.asOf)
  return {
    storyId,
    runId,
    ref: f.ref,
    origin: f.origin,
    reusedFromId: f.reusedFromId,
    sourceUrl: f.source.url,
    sourceOutlet: f.source.outlet,
    sourceTitle: f.source.title,
    sourceDate: f.source.date ? new Date(`${f.source.date}T00:00:00Z`) : null,
    sourceKind: f.source.kind,
    supportingSentence: f.supportingSentence,
    passage: f.passage,
    supportFound: f.supportFound,
    statement: f.statement,
    value: f.value,
    valueHigh: f.valueHigh,
    unit: f.unit,
    approx: f.approx,
    provisional: f.provisional,
    counted: f.counted,
    place: f.place,
    asOf: asOf.date,
    asOfPrecision: asOf.precision,
    credited: f.credited,
    creditedKind: f.creditedKind,
    validity: f.validity,
    verdict: f.verdict,
    verdictProblem: f.verdictProblem,
    model: f.model,
    promptVersion: f.promptVersion,
  }
}

export interface ContextRunOutcome {
  runId: string
  status: StoryContextResult['status']
  outcome: ContextOutcome
  boxes: number
  /** The item tally of a completed run; zero for any other. */
  tally: { checked: number; failed: number }
  /** False when the run was marked interrupted before it finished: nothing was written. */
  written: boolean
}

/**
 * Store the result while the run is still `running`, in one transaction: the run's status, outcome,
 * costs and record, every fact with its verdict, and the kept boxes in order.
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
        costUsd,
        modelUsd: result.modelUsd,
        tavilyCredits,
        result: result.record as unknown as Prisma.InputJsonObject,
        error: result.error,
        finishedAt: now,
      },
    })
    if (count === 0) return false
    if (result.facts.length > 0) await tx.contextFact.createMany({ data: result.facts.map(f => factRow(storyId, runId, f)) })
    if (result.boxes.length > 0)
      await tx.contextBox.createMany({
        data: result.boxes.map((box, position) => {
          const asOf = asOfColumns(boxAsOf(box, facts))
          return {
            storyId,
            runId,
            position,
            type: box.type,
            heading: box.heading,
            teaser: box.teaser,
            sentences: box.sentences as unknown as Prisma.InputJsonArray,
            visual: box.visual === null ? undefined : (box.visual as unknown as Prisma.InputJsonObject),
            asOf: asOf.date,
            asOfPrecision: asOf.precision,
            place: box.place,
            model: result.writer?.model ?? null,
            promptVersion: result.writer?.promptVersion ?? null,
            writtenAt: now,
          }
        }),
      })
    return true
  })
}

/**
 * Build one story's context: the run row, its input, the pipeline with production's deps, the
 * store. A story that is not published or has no research facts is recorded as skipped. A failure
 * outside the pipeline fails the run with a sanitized error; only a database error before the run
 * exists throws.
 */
export async function runStoryContext(storyId: string, deps: ContextDeps = productionDeps()): Promise<ContextRunOutcome> {
  const started = new Date()
  const run = await prisma.storyContextRun.create({ data: { storyId, status: 'running', startedAt: started }, select: { id: true } })
  const none = { boxes: 0, tally: { checked: 0, failed: 0 } }
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
      { runId: run.id, storyId, status: result.status, outcome: result.outcome, boxes: result.boxes.length, ...result.record.tally },
      'story context run finished',
    )
    return {
      runId: run.id,
      status: result.status,
      outcome: result.outcome,
      boxes: result.boxes.length,
      tally: result.status === 'completed' ? result.record.tally : none.tally,
      written,
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
