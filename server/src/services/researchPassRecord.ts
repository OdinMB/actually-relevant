/**
 * A research pass's record (`research_passes.record`, `.context/research-passes.md`, "Passes"): what
 * it holds, and what is read from it: every call the pass made under its step's name (`passCalls`),
 * the problems its final drafts kept (`passProblems`), and its items checked and failed for the step's
 * failure share (`passItemTally`). Pure.
 */
import { draftItems } from './researchChecks.js'
import type { UpdateRecord } from './researchPassLater.js'
import type { PlanRecord } from './researchPassPlan.js'
import { CARD_STEP_OF, type PassStep } from './researchPassSteps.js'
import type { StoryResearch } from './researchPipeline.js'
import type { ContextRunRecord } from './storyContextPipeline.js'

/** What became of the cards: written, nothing kept, a technical failure, the budget stopped them, or kept as they were (a later pass whose pool gained no supported fact and lost none). */
export type CardsOutcome = 'written' | 'none' | 'failed' | 'budget' | 'kept'

/** A first pass's gate outcome; a later pass's `updated`, `unchanged` or `update_failed`; either's `budget` or `technical`. */
export type PassOutcome =
  'written' | 'stale' | 'contradicted' | 'research-rating' | 'fallback' | 'budget' | 'technical' | 'updated' | 'unchanged' | 'update_failed'

/** Everything else the pass did, stored as `research_passes.record`. */
export interface PassRecord {
  /** The article's steps, as research records them. */
  research: StoryResearch
  /** The card steps, as context records them. */
  context: ContextRunRecord
  cards: CardsOutcome
  /** Why the cards failed, safe to store. */
  cardsError: string | null
  /** Coverage queries not searched: an earlier pass made them. */
  skippedQueries: string[]
  /** The coverage plan the pass used, which the next pass reads, and why each step was reused or asked. */
  plan: PlanRecord
  /** A later pass's article step: the judgments, demotions, checks and note (`researchPassLater.ts`); null on a first pass. */
  update: UpdateRecord | null
}

/**
 * The pass's items checked and failed, for the step's failure share: the cards' tally plus the
 * article's sections, each once however many rounds checked it. Checked: every cited section of the
 * draft research's checks ran on, and every section a later pass's checks ran on; failed: each
 * section the final problems name, which counts as checked too (a section dropped after failing is
 * in no final draft).
 */
export function passItemTally(record: PassRecord): { checked: number; failed: number } {
  const { research, update } = record
  const failed = new Set(passProblems(record).map(p => p.label))
  const drafted = research.checks.length > 0 && research.draft ? draftItems(research.draft).filter(i => i.cited) : []
  const checked = new Set([...drafted.map(i => i.label), ...(update?.checks ?? []).flatMap(c => c.rechecked ?? []), ...failed])
  return { checked: record.context.tally.checked + checked.size, failed: record.context.tally.failed + failed.size }
}

/** The problems the pass's final drafts kept: research's article's, then a later pass's update's. What the tally counts failed and the admin lists. */
export function passProblems<P>(record: { research: { problems: P[] }; update: { problems: P[] } | null }): P[] {
  return [...record.research.problems, ...(record.update?.problems ?? [])]
}

/** The parts of a record `passCalls` reads: each sub-record's calls. */
export interface PassCallsRecord {
  research: Pick<StoryResearch, 'calls'>
  update: Pick<UpdateRecord, 'calls'> | null
  context: Pick<ContextRunRecord, 'calls'>
}

/** Every call the pass made, research's steps first, each under its pass step's name. */
export function passCalls(record: PassCallsRecord): (Omit<StoryResearch['calls'][number], 'step'> & { step: PassStep })[] {
  return [...record.research.calls, ...(record.update?.calls ?? []), ...record.context.calls.map(c => ({ ...c, step: CARD_STEP_OF[c.step] }))]
}
