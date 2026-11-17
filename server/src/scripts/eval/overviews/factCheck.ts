/**
 * The fact check under planted errors (`eval:overviews`, step `fact-check`): production's fact-check
 * prompt and schema (`buildFactCheckPrompt`, `factCheckSchema`) on each sampled fact's variants,
 * each item shaped as production shows a paragraph citing the fact, minus the extraction's own
 * statement: the variant as the item's text; as its evidence the fact with the source's sentence as
 * both statement and support, what the fact measures, and the source's date fact (`publishedFact`);
 * the evidence and number hints built by production's `checkedItems`. A strong judge labels each
 * fact first (`labelFacts`): only facts it accepts get variants. Each pass, the labels and then the
 * arms on the accepted facts' variants, runs only when its own uncached calls fit the budget
 * (`callBudget.ts`). Calls go through the eval context (cache, ledger, budget), never wrapped in a retry.
 */
import { buildFactCheckPrompt, type CheckedItem } from '../../../prompts/research.js'
import { factCheckSchema, type FactCheck } from '../../../schemas/research.js'
import { checkedItems, publishedFact, type PoolFact } from '../../../services/researchChecks.js'
import type { ContextFactData } from '../../../services/storyContextChecks.js'
import { arm, armKey, versionedSchemaName } from '../models.js'
import { runNumbers, runSchemaName } from '../repeats.js'
import { byEvalHash } from '../sampling.js'
import type { Arm, PlannedCall, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate, type Ledger } from './callBudget.js'
import { contextCheckedItem, contextVariants } from './contextFacts.js'
import type { FactFixture } from './factFixtures.js'
import { plantVariants, type VariantKind } from './plant.js'

/** Labels the sample: a strong judge reading the same prompt, once per fact. */
export const LABEL_ARM: Arm = arm('gpt-6.1-sol', 'high')
export const ITEMS_PER_CALL = 10
export const FACT_CHECK_SCHEMA_NAME = versionedSchemaName('overview-fact-check', factCheckSchema)
/** Billed output per item at medium effort, reasoning included: the estimate only. */
const OUTPUT_TOKENS_PER_ITEM = 150

/** One text put to the fact check: a variant of a sampled fact. */
export interface CheckItem {
  /** `<fact key>#<kind>`, unique, and the key of the batches' shuffle. */
  id: string
  fact: FactFixture
  kind: VariantKind
  text: string
  change: string
  /** A module-1 fact as this variant renders it (`contextFacts.ts`); unset for research's facts. */
  contextFact?: ContextFactData
}

export interface Verdict {
  item: CheckItem
  /** Null: the answer gave no verdict for it (unjudged). */
  supported: boolean | null
  problem: string
}

const faithfulItem = (fact: FactFixture): CheckItem => ({
  id: `${fact.key}#faithful`,
  fact,
  kind: 'faithful',
  text: fact.statement,
  change: '',
  ...(fact.context ? { contextFact: fact.context.fact } : {}),
})

/** Every variant of every fact (`plantVariants`; a module-1 fact's from `contextVariants`), facts in sample order. */
export function variantItems(facts: FactFixture[]): CheckItem[] {
  return facts.flatMap(fact =>
    fact.context
      ? contextVariants(fact).map(v => ({ id: `${fact.key}#${v.kind}`, fact, kind: v.kind, text: v.text, change: v.change, contextFact: v.fact }))
      : plantVariants(fact.statement).map(v => ({ id: `${fact.key}#${v.kind}`, fact, kind: v.kind, text: v.text, change: v.change })),
  )
}

/**
 * The item as production's prompt reads a story paragraph citing the fact, at its 1-based place in
 * its call: its evidence (the fact, then its source's date fact) and its number hints are what
 * `checkedItems` gives that paragraph, so they follow production wherever it changes. A module-1
 * fact is the item story context's own check makes of it (`contextCheckedItem`).
 */
export function checkedItem(item: CheckItem, position: number): CheckedItem {
  if (item.contextFact) return contextCheckedItem(item.contextFact, item.text, position)
  const { fact } = item
  const sourceId = `S${position}`
  const cited: PoolFact = { id: `${sourceId}F1`, statement: fact.sentence, supportingSentence: fact.sentence, measures: fact.measures }
  const facts = new Map([cited, ...publishedFact(sourceId, fact.outlet, fact.date)].map(f => [f.id, f]))
  const draft = { title: '', story: [{ text: item.text, factIds: [cited.id] }], whyThisMatters: [], caveats: [], summary: '', marketingBlurb: '' }
  const paragraph = checkedItems(draft, facts).find(c => c.item.part === 'story')!
  return { label: `Fact ${position}`, text: item.text, facts: paragraph.evidence, numbersNotFound: paragraph.numberHints }
}

/** The items in a fixed-seed shuffle, so a fact's variants rarely share a call, cut into calls. */
export function batchesOf(items: CheckItem[]): CheckItem[][] {
  const shuffled = byEvalHash(items, i => i.id)
  return Array.from({ length: Math.ceil(shuffled.length / ITEMS_PER_CALL) }, (_, i) => shuffled.slice(i * ITEMS_PER_CALL, (i + 1) * ITEMS_PER_CALL))
}

/** No source wording and no pool: each item carries its own evidence. */
export const batchPrompt = (batch: CheckItem[]): string =>
  buildFactCheckPrompt(
    batch.map((item, i) => checkedItem(item, i + 1)),
    [],
    [],
  )

/** Each item's verdict by its number in the call; the first answer for a number counts. Only `supported` is read. */
export function readVerdicts(batch: CheckItem[], answer: FactCheck | null): Verdict[] {
  const byNumber = new Map<number, FactCheck['items'][number]>()
  for (const entry of answer?.items ?? []) if (!byNumber.has(entry.number)) byNumber.set(entry.number, entry)
  return batch.map((item, i) => {
    const entry = byNumber.get(i + 1)
    return { item, supported: entry?.supported ?? null, problem: entry?.problem ?? '' }
  })
}

/** One arm's verdicts on the items, in the items' order. */
export async function judgeItems(ctx: SuiteContext, a: Arm, items: CheckItem[], schemaName: string): Promise<Verdict[]> {
  const batches = batchesOf(items)
  const answered = await Promise.all(
    batches.map(async batch => {
      const rec = await ctx.call(a, schemaName, factCheckSchema, batchPrompt(batch))
      return readVerdicts(batch, rec.outcome === 'ok' ? rec.parsed : null)
    }),
  )
  const byId = new Map(answered.flat().map(v => [v.item.id, v]))
  return items.map(item => byId.get(item.id) ?? { item, supported: null, problem: '' })
}

export interface Labels {
  /** Facts the strong judge found supported by their evidence: the ones variants are built from. */
  accepted: FactFixture[]
  /**
   * Statements their evidence (the sentence, what it measures, the source's date) does not support,
   * with the judge's reason. Not extraction errors as such: the judge never sees the source's full
   * text, so a statement that carries scope or period from elsewhere in the article lands here too.
   */
  unsupported: Verdict[]
  /** Facts it gave no verdict for. */
  unlabeled: FactFixture[]
}

/** The strong judge on each fact's statement as extracted, once (no repeat). */
export async function labelFacts(ctx: SuiteContext, facts: FactFixture[]): Promise<Labels> {
  const verdicts = await judgeItems(ctx, LABEL_ARM, facts.map(faithfulItem), FACT_CHECK_SCHEMA_NAME)
  return {
    accepted: verdicts.filter(v => v.supported === true).map(v => v.item.fact),
    unsupported: verdicts.filter(v => v.supported === false),
    unlabeled: verdicts.filter(v => v.supported === null).map(v => v.item.fact),
  }
}

export interface ArmRuns {
  arm: string
  /** `runs[k - 1]`: run k's verdicts, in the items' order. */
  runs: Verdict[][]
}

/** Every arm on every item, `repeat` times; run k ≥ 2 under its own cache key (`repeats.ts`). */
export async function runArms(ctx: SuiteContext, items: CheckItem[], arms: Arm[], repeat: number): Promise<ArmRuns[]> {
  const out: ArmRuns[] = []
  for (const a of arms) {
    const runs: Verdict[][] = []
    for (const k of runNumbers(repeat)) runs.push(await judgeItems(ctx, a, items, runSchemaName(FACT_CHECK_SCHEMA_NAME, k)))
    out.push({ arm: armKey(a), runs })
  }
  return out
}

// ---------------------------------------------------------------------------
// Planned calls and the budget
// ---------------------------------------------------------------------------

const planned = (a: Arm, schemaName: string, items: CheckItem[]): PlannedCall[] =>
  batchesOf(items).map(batch => ({ arm: a, schemaName, prompt: batchPrompt(batch), baseOutputTokens: batch.length * OUTPUT_TOKENS_PER_ITEM }))

/** The label pass's calls, as `labelFacts` makes them. */
export const plannedLabelCalls = (facts: FactFixture[]): PlannedCall[] => planned(LABEL_ARM, FACT_CHECK_SCHEMA_NAME, facts.map(faithfulItem))

/** Each arm's runs on `variants`, as `runArms` makes them. */
export const plannedArmCalls = (variants: CheckItem[], arms: Arm[], repeat: number): PlannedCall[] =>
  arms.flatMap(a => runNumbers(repeat).flatMap(k => planned(a, runSchemaName(FACT_CHECK_SCHEMA_NAME, k), variants)))

/** A context that can tell which planned calls its cache answers, and what the folder has spent. */
export type BudgetedContext = SuiteContext & Ledger

export interface FactCheckEstimate {
  labels: CallEstimate
  arms: CallEstimate
  /** True while a label is uncached: the arms are then planned on every fact's variants, as if the judge accepted them all. */
  armsUpperBound: boolean
}

/** What the step would call, before it calls anything: the labels are read only when the cache holds every one. */
export async function estimateFactCheck(ctx: BudgetedContext, facts: FactFixture[], arms: Arm[], repeat: number): Promise<FactCheckEstimate> {
  const labels = estimateCalls(ctx, plannedLabelCalls(facts))
  const accepted = labels.uncached === 0 ? (await labelFacts(ctx, facts)).accepted : facts
  return { labels, arms: estimateCalls(ctx, plannedArmCalls(variantItems(accepted), arms, repeat)), armsUpperBound: labels.uncached > 0 }
}

export interface FactCheckRun {
  /** Null when the label pass did not run. */
  labels: Labels | null
  variants: CheckItem[]
  runs: ArmRuns[]
  /** The pass the budget or the missing key stopped before its calls, and why; null when both ran. */
  stopped: { pass: 'labels' | 'arms'; reason: string } | null
}

/**
 * The step: the label pass when its calls fit, then the accepted facts' variants, then every arm on
 * them when those calls, planned now that the labels are known, fit what is left.
 */
export async function runFactCheck(ctx: BudgetedContext, facts: FactFixture[], arms: Arm[], repeat: number, gate: CallGate): Promise<FactCheckRun> {
  const labelsRefused = refusal(estimateCalls(ctx, plannedLabelCalls(facts)), ctx, gate)
  if (labelsRefused) return { labels: null, variants: [], runs: [], stopped: { pass: 'labels', reason: labelsRefused } }
  const labels = await labelFacts(ctx, facts)
  const variants = variantItems(labels.accepted)
  const armsRefused = refusal(estimateCalls(ctx, plannedArmCalls(variants, arms, repeat)), ctx, gate)
  if (armsRefused) return { labels, variants, runs: [], stopped: { pass: 'arms', reason: armsRefused } }
  return { labels, variants, runs: await runArms(ctx, variants, arms, repeat), stopped: null }
}
