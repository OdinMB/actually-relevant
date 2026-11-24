/**
 * The fact check's second strong-judge pass (`eval:overviews`, step `fact-check`, on rendered
 * module-1 facts only: `--facts context`, `--facts pool`). The label pass shows the judge one source
 * sentence, so it rejects a rendering that only names the subject, place or body the rest of the
 * article supplies as it rejects one that drops a period or strengthens a claim. This pass reads
 * each rejected fact again, on the label pass's arm, once (no repeat), and sorts it: `context` or
 * `changed` with the kind of change (`factDriftPrompt.ts`). It is shown the rendering, the source's
 * sentence or passage, date and headline, the story's title and, where the rendering does not
 * already hold it, research's own statement. The label pass and its cached calls are untouched. The pass
 * runs only when its uncached calls fit the budget (`callBudget.ts`); calls go through the eval
 * context (cache, ledger, budget), never wrapped in a retry.
 */
import { versionedSchemaName } from '../models.js'
import type { PlannedCall, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate } from './callBudget.js'
import { LABEL_ARM, type BudgetedContext, type Verdict } from './factCheck.js'
import { buildDriftJudgePrompt, driftJudgeSchema, type DriftCategory, type DriftJudgeAnswer, type DriftJudgeFact, type DriftKind } from './factDriftPrompt.js'

export const DRIFT_SCHEMA_NAME = versionedSchemaName('overview-fact-drift', driftJudgeSchema)
export const DRIFT_FACTS_PER_CALL = 10
/** Billed output per fact at medium effort, reasoning included: the estimate only. */
const OUTPUT_TOKENS_PER_FACT = 150

/** One fact the label pass rejected, as the second pass read it. */
export interface DriftReading {
  /** The label pass's rejection: the fact as rendered, and that judge's reason. */
  rejection: Verdict
  /** Null: the second pass gave no answer for it (unjudged). */
  category: DriftCategory | null
  /** What changed; set for `changed` only. */
  kind: DriftKind | null
  reason: string
}

/**
 * The rejected fact as the prompt shows it: with its source article's own headline beside our
 * story's title, since a page a search found may be background about another year or place.
 * Research's statement is left out where the rendering already holds it: a fact rendered as its
 * statement would otherwise show the judge its own words twice, as if one corroborated the other.
 */
export function driftFact(v: Verdict): DriftJudgeFact {
  const { fact } = v.item
  const statement = fact.context?.fact.statement.trim() ?? ''
  return {
    sourceTitle: fact.context?.fact.source.title.trim() || null,
    storyTitle: fact.context?.title ?? '',
    source: fact.sentence,
    date: fact.date,
    rendering: v.item.text,
    statement: statement === '' || v.item.text.includes(statement) ? null : statement,
  }
}

/** The rejected facts in their order, cut into calls. */
export function driftBatches(rejected: Verdict[]): Verdict[][] {
  return Array.from({ length: Math.ceil(rejected.length / DRIFT_FACTS_PER_CALL) }, (_, i) =>
    rejected.slice(i * DRIFT_FACTS_PER_CALL, (i + 1) * DRIFT_FACTS_PER_CALL),
  )
}

const driftPrompt = (batch: Verdict[]): string => buildDriftJudgePrompt(batch.map(driftFact))

/**
 * Each fact's answer by its 1-based number in the call; the first answer for a number counts, and a
 * number outside the call is ignored. A `changed` answer with no kind reads as `other`; a `context`
 * answer never carries a kind.
 */
export function readDrift(batch: Verdict[], answer: DriftJudgeAnswer | null): DriftReading[] {
  const byNumber = new Map<number, DriftJudgeAnswer['facts'][number]>()
  for (const entry of answer?.facts ?? []) if (!byNumber.has(entry.number)) byNumber.set(entry.number, entry)
  return batch.map((rejection, i) => {
    const entry = byNumber.get(i + 1)
    if (!entry) return { rejection, category: null, kind: null, reason: '' }
    return { rejection, category: entry.category, kind: entry.category === 'changed' ? (entry.kind ?? 'other') : null, reason: entry.reason }
  })
}

/** The second pass on the rejected facts: one reading each, in their order; a failed call's facts unjudged. */
export async function judgeDrift(ctx: SuiteContext, rejected: Verdict[]): Promise<DriftReading[]> {
  const answered = await Promise.all(
    driftBatches(rejected).map(async batch => {
      const rec = await ctx.call(LABEL_ARM, DRIFT_SCHEMA_NAME, driftJudgeSchema, driftPrompt(batch))
      return readDrift(batch, rec.outcome === 'ok' ? rec.parsed : null)
    }),
  )
  return answered.flat()
}

/** The second pass's calls, as `judgeDrift` makes them. */
export const plannedDriftCalls = (rejected: Verdict[]): PlannedCall[] =>
  driftBatches(rejected).map(batch => ({
    arm: LABEL_ARM,
    schemaName: DRIFT_SCHEMA_NAME,
    prompt: driftPrompt(batch),
    baseOutputTokens: batch.length * OUTPUT_TOKENS_PER_FACT,
  }))

export interface DriftRun {
  /** The pass's calls, and what those the cache cannot answer were estimated to cost before any was made. */
  estimate: CallEstimate
  /** One reading per rejected fact, in their order; null when the pass did not run. */
  readings: DriftReading[] | null
  /** Why the pass did not run (the budget, or the API key); null when it ran. */
  stopped: string | null
}

/** The pass when its uncached calls fit what is left of the budget; a pass the cache answers in full always runs. */
export async function runDriftPass(ctx: BudgetedContext, rejected: Verdict[], gate: CallGate): Promise<DriftRun> {
  const estimate = estimateCalls(ctx, plannedDriftCalls(rejected))
  const refused = refusal(estimate, ctx, gate)
  if (refused) return { estimate, readings: null, stopped: refused }
  return { estimate, readings: await judgeDrift(ctx, rejected), stopped: null }
}
