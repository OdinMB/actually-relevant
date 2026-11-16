/**
 * The fact check under planted errors (`eval:overviews`, step `fact-check`): production's fact-check
 * prompt and schema (`buildFactCheckPrompt`, `factCheckSchema`) on each sampled fact's variants,
 * shaped as the overview check will read a fact: the variant as the item's text, and as its one
 * fact the source's sentence alone (statement and support both), so the judge sees only the source's
 * words, never the extraction's statement; the number hints computed as production computes them.
 * A strong judge labels each fact first (`labelFacts`): only facts it accepts get variants. Calls go
 * through the eval context (cache, ledger, budget), never wrapped in a retry.
 */
import { findUnsupportedNumbers } from '../../../lib/numbers.js'
import { buildFactCheckPrompt, type CheckedItem } from '../../../prompts/research.js'
import { factCheckSchema, type FactCheck } from '../../../schemas/research.js'
import { arm, armKey, versionedSchemaName } from '../models.js'
import { runNumbers, runSchemaName } from '../repeats.js'
import { byEvalHash } from '../sampling.js'
import type { Arm, PlannedCall, SuiteContext } from '../types.js'
import type { FactFixture } from './factFixtures.js'
import { plantVariants, type VariantKind } from './plant.js'

/** Labels the sample: a strong judge reading the same prompt, once per fact. */
export const LABEL_ARM: Arm = arm('gpt-6.1-sol', 'high')
export const ITEMS_PER_CALL = 10
export const FACT_CHECK_SCHEMA_NAME = versionedSchemaName('overview-fact-check', factCheckSchema)
/** Billed output per item at medium effort, reasoning included: the dry run's estimate only. */
const OUTPUT_TOKENS_PER_ITEM = 150

/** One text put to the fact check: a variant of a sampled fact. */
export interface CheckItem {
  /** `<fact key>#<kind>`, unique, and the key of the batches' shuffle. */
  id: string
  fact: FactFixture
  kind: VariantKind
  text: string
  change: string
}

export interface Verdict {
  item: CheckItem
  /** Null: the answer gave no verdict for it (unjudged). */
  supported: boolean | null
  problem: string
}

const faithfulItem = (fact: FactFixture): CheckItem => ({ id: `${fact.key}#faithful`, fact, kind: 'faithful', text: fact.statement, change: '' })

/** Every variant of every fact (`plantVariants`), facts in sample order. */
export function variantItems(facts: FactFixture[]): CheckItem[] {
  return facts.flatMap(fact => plantVariants(fact.statement).map(v => ({ id: `${fact.key}#${v.kind}`, fact, kind: v.kind, text: v.text, change: v.change })))
}

/** The item as production's prompt reads it, at its 1-based place in its call. */
export function checkedItem(item: CheckItem, position: number): CheckedItem {
  const sentence = item.fact.sentence
  return {
    label: `Fact ${position}`,
    text: item.text,
    facts: [{ id: `S${position}F1`, statement: sentence, supportingSentence: sentence, measures: '' }],
    numbersNotFound: findUnsupportedNumbers(item.text, sentence).unsupported,
  }
}

/** The items in a fixed-seed shuffle, so a fact's variants rarely share a call, cut into calls. */
export function batchesOf(items: CheckItem[]): CheckItem[][] {
  const shuffled = byEvalHash(items, i => i.id)
  return Array.from({ length: Math.ceil(shuffled.length / ITEMS_PER_CALL) }, (_, i) => shuffled.slice(i * ITEMS_PER_CALL, (i + 1) * ITEMS_PER_CALL))
}

/** No source wording and no pool: each item carries its own one fact. */
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
  /** Facts the strong judge found supported by their sentence: the ones variants are built from. */
  accepted: FactFixture[]
  /** Facts it found unsupported: the extraction misstates its sentence. */
  extractionErrors: Verdict[]
  /** Facts it gave no verdict for. */
  unlabeled: FactFixture[]
}

/** The strong judge on each fact's statement as extracted, once (no repeat). */
export async function labelFacts(ctx: SuiteContext, facts: FactFixture[]): Promise<Labels> {
  const verdicts = await judgeItems(ctx, LABEL_ARM, facts.map(faithfulItem), FACT_CHECK_SCHEMA_NAME)
  return {
    accepted: verdicts.filter(v => v.supported === true).map(v => v.item.fact),
    extractionErrors: verdicts.filter(v => v.supported === false),
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

/** The step: label the facts, build the accepted facts' variants, run every arm on them. */
export async function runFactCheck(
  ctx: SuiteContext,
  facts: FactFixture[],
  arms: Arm[],
  repeat: number,
): Promise<{ labels: Labels; variants: CheckItem[]; runs: ArmRuns[] }> {
  const labels = await labelFacts(ctx, facts)
  const variants = variantItems(labels.accepted)
  return { labels, variants, runs: await runArms(ctx, variants, arms, repeat) }
}

const planned = (a: Arm, schemaName: string, batches: CheckItem[][]): PlannedCall[] =>
  batches.map(batch => ({ arm: a, schemaName, prompt: batchPrompt(batch), baseOutputTokens: batch.length * OUTPUT_TOKENS_PER_ITEM }))

/**
 * Every call the step may make: the label pass on every fact, then each arm's runs on every variant
 * of every fact, as if the strong judge accepted them all (an upper bound until the labels are known).
 */
export function plannedCalls(facts: FactFixture[], arms: Arm[], repeat: number): PlannedCall[] {
  const variants = batchesOf(variantItems(facts))
  return [
    ...planned(LABEL_ARM, FACT_CHECK_SCHEMA_NAME, batchesOf(facts.map(faithfulItem))),
    ...arms.flatMap(a => runNumbers(repeat).flatMap(k => planned(a, runSchemaName(FACT_CHECK_SCHEMA_NAME, k), variants))),
  ]
}
