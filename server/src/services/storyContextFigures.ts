/**
 * The figure judgment before the fact check (ADR-0080; `.context/story-context.md`, "What one story
 * goes through"): which facts carry a figure, how each is put to the model in batches, and the answers
 * applied. The model answers whether each figure's source gives it (`FIGURE_ANSWERS`); code applies
 * the rule: only `given` keeps the figure, and a figure the answer leaves out is removed too. A call
 * that gives no answer throws out of `ask`, so the caller handles it as it does the fact check's.
 * Pure: the call is injected (`checkFacts`, `storyContextPipeline.ts`).
 */
import { config } from '../config.js'
import type { FigureItem } from '../prompts/storyContext.js'
import { fieldText } from '../schemas/factFields.js'
import type { FigureAnswer, FigureCheck } from '../schemas/storyContext.js'
import type { ContextFactData } from './storyContextChecks.js'
import { spelledFigure } from './storyContextVisuals.js'

/** What removing a fact's figure sets. The fact keeps its statement, place, as-of date, credit, flags and everything else. */
export const FIGURELESS: Pick<ContextFactData, 'value' | 'valueHigh' | 'unit' | 'counted' | 'approx'> = {
  value: null,
  valueHigh: null,
  unit: '',
  counted: '',
  approx: 'exact',
}

/** A figure the judgment removed, as the run's record keeps it. */
export interface RemovedFigure {
  ref: string
  /** The figure as it was spelled (`spelledFigure`). */
  figure: string
  /** What the check was shown under COUNTS: the thing counted, else the unit. */
  counted: string
  /** The model's answer, or `no-answer` for a figure its answer left out. */
  answer: Exclude<FigureAnswer, 'given'> | 'no-answer'
}

/**
 * A fact with a figure as the check is shown it, null for a fact without one: the figure as spelled,
 * what it counts (else its unit), its source's words, never its statement. A filler stored before
 * `fieldText` read the fields is never shown, as `renderFact` shows none. The eval shows its figures
 * by the same rule (`scripts/eval/overviews/figureCheck.ts`).
 */
export function figureItemOf(fact: ContextFactData): FigureItem | null {
  const number = spelledFigure(fact)
  if (number === null) return null
  return { id: fact.ref, number, counts: fieldText(fact.counted) || fieldText(fact.unit), source: fact.passage ?? fact.supportingSentence }
}

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/** The answer for each figure asked, by its id: answers for ids not asked ignored, the first for an id counting. */
function answersOf(batch: FigureItem[], answer: FigureCheck): Map<string, FigureAnswer> {
  const ids = new Set(batch.map(f => f.id))
  const answers = new Map<string, FigureAnswer>()
  for (const f of answer.figures) if (ids.has(f.id) && !answers.has(f.id)) answers.set(f.id, f.inSource)
  return answers
}

/**
 * Judges every figure of `facts` against its source, at most `checkBatchSize` figures a call, one call
 * after another; no figure, no call. Returns every fact in its order, those whose figure was not given
 * with `FIGURELESS` over them, and the removals in fact order. A call that throws rejects it whole.
 */
export async function judgeFigures(
  facts: ContextFactData[],
  ask: (figures: FigureItem[]) => Promise<FigureCheck>,
): Promise<{ facts: ContextFactData[]; removed: RemovedFigure[] }> {
  const removedBy = new Map<string, RemovedFigure>()
  for (const batch of chunks(
    facts.flatMap(f => figureItemOf(f) ?? []),
    config.storyContext.checkBatchSize,
  )) {
    const answers = answersOf(batch, await ask(batch))
    for (const item of batch) {
      // A figure the answer leaves out is removed as having none
      const answer = answers.get(item.id) ?? 'no-answer'
      if (answer !== 'given') removedBy.set(item.id, { ref: item.id, figure: item.number, counted: item.counts, answer })
    }
  }
  return {
    facts: facts.map(f => (removedBy.has(f.ref) ? { ...f, ...FIGURELESS } : f)),
    removed: facts.flatMap(f => removedBy.get(f.ref) ?? []),
  }
}
