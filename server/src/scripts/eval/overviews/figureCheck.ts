/**
 * The figure judgment under labels and planted errors (`eval:overviews`, step `figure-check`, ADR-0080):
 * the sample, the variants, the label pass and the arms through the eval context. The sample is run
 * 1's figures of `--facts context` or `--facts pool`: those production's figure check kept and those it
 * removed, each shown as production shows it (`figureItemOf`, `buildFigureCheckPrompt`,
 * `figureCheckSchema`), named in a call by its place there, since a call mixes stories whose refs
 * repeat. A strong judge answers each figure once (the labels): that measures production's own
 * answers on real figures, the only measure of a figure worked out or invented, which no rule can
 * plant. The kept figures the judge finds given get variants (`figureVariants`: the figure as it is, a
 * wrong number, another thing counted), which each arm answers `repeat` times. Each pass, the labels
 * and then the arms planned once the labels are known, runs only when its own uncached calls fit the
 * budget (`callBudget.ts`). Calls go through the eval context (cache, ledger, budget), never wrapped in
 * a retry.
 */
import { config } from '../../../config.js'
import { buildFigureCheckPrompt, type FigureItem } from '../../../prompts/storyContext.js'
import { fieldText } from '../../../schemas/factFields.js'
import { figureCheckSchema, type FigureAnswer, type FigureCheck } from '../../../schemas/storyContext.js'
import type { ContextFactData } from '../../../services/storyContextChecks.js'
import { figureItemOf, type RemovedFigure } from '../../../services/storyContextFigures.js'
import { armKey, versionedSchemaName } from '../models.js'
import type { OverviewHalf, RenderedFactSource } from '../options.js'
import { runNumbers, runSchemaName } from '../repeats.js'
import { byEvalHash } from '../sampling.js'
import type { Arm, PlannedCall, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate } from './callBudget.js'
import type { StoryFacts } from './contextFacts.js'
import { LABEL_ARM, type BudgetedContext } from './factCheck.js'
import { scoreFigureCheck, type FigureCheckScore } from './figureCheckScore.js'
import { otherPeer, wrongFigure, type FigureKind } from './plant.js'

export const FIGURE_CHECK_SCHEMA_NAME = versionedSchemaName('overview-figure-check', figureCheckSchema)
/** Production's batch: a call holds as many figures as `judgeFigures` puts in one. */
export const FIGURES_PER_CALL = config.storyContext.checkBatchSize
/** Billed output per figure at medium effort, reasoning included: the estimate only. */
const OUTPUT_TOKENS_PER_FIGURE = 100

/** What the figure check is shown of one figure but its id, which is its place in a call. */
export type FigureShown = Omit<FigureItem, 'id'>

/** Anything put to the figure check: a sampled figure, or a variant of one. */
interface Asked {
  /** Unique, and the key of the batches' shuffle. */
  id: string
  shown: FigureShown
}

interface SampledFigure extends Asked {
  /** `<slug>:<ref>`. */
  id: string
  outlet: string
}

/** A figure production's figure check kept: its fact, to plant errors in, and the story's counted phrases. */
export interface KeptFigure extends SampledFigure {
  kept: true
  fact: ContextFactData
  /** What the story's facts count, each once: where `other-thing` takes its thing from. */
  peers: string[]
}

/** A figure production's figure check removed, as its record keeps it, with production's answer. */
export interface RemovedFigureFixture extends SampledFigure {
  kept: false
  answer: RemovedFigure['answer']
}

export type FigureFixture = KeptFigure | RemovedFigureFixture

export interface FigureSample {
  /** Stories that gave figures. */
  stories: number
  size: number
  figures: FigureFixture[]
  shortfalls: string[]
}

/** One figure put to the arms: a kept figure as it is, or with one error planted. */
export interface FigureVariant extends Asked {
  /** `<figure id>#<kind>`. */
  id: string
  figure: KeptFigure
  kind: FigureKind
  /** The one change, e.g. `100 people → 150 people`; empty for the faithful variant. */
  change: string
}

/** A figure or variant with the answer for it; null: the answer left it out, or the call gave none. */
export interface Answered<T> {
  item: T
  answer: FigureAnswer | null
}

const distinct = (values: string[]) => {
  const seen = new Set<string>()
  return values.filter(v => {
    const k = v.toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * One story's figures in fact order: each kept one (a figure on a fact none reused that the fact check
 * judged, supported or rejected) and each removed one whose fact is there. An `unjudged` fact's figure
 * is left out: its pass stopped before or in the checks, or the fact check left the fact out and the
 * pass kept the stored figure whatever the figure check answered, so production's figure check did not
 * keep it.
 */
function storyFigures({ slug, facts, removed }: StoryFacts): FigureFixture[] {
  const removals = new Map(removed.map(r => [r.ref, r]))
  const peers = distinct(facts.map(f => fieldText(f.counted)))
  return facts.flatMap((fact): FigureFixture[] => {
    const base = { id: `${slug}:${fact.ref}`, outlet: fact.source.outlet }
    const removal = removals.get(fact.ref)
    if (removal) {
      return [
        {
          ...base,
          kept: false,
          answer: removal.answer,
          shown: { number: removal.figure, counts: removal.counted, source: fact.passage ?? fact.supportingSentence },
        },
      ]
    }
    const item = fact.reusedFromId === null && fact.verdict !== 'unjudged' ? figureItemOf(fact) : null
    if (!item) return []
    return [{ ...base, kept: true, fact, peers, shown: { number: item.number, counts: item.counts, source: item.source } }]
  })
}

/** Run 1's figures, kept and removed, taken in turn from each story, at most `size`. */
export function figureFixtures(stories: readonly StoryFacts[], size: number): FigureSample {
  const lists = stories.map(storyFigures)
  const figures: FigureFixture[] = []
  for (let i = 0; figures.length < size && lists.some(l => l.length > i); i++) for (const l of lists) if (l[i] && figures.length < size) figures.push(l[i]!)
  return {
    stories: lists.filter(l => l.length > 0).length,
    size,
    figures,
    shortfalls: figures.length < size ? [`${figures.length} of ${size} figures: run 1 kept and removed no more`] : [],
  }
}

/**
 * A kept figure as it is, then each planted error that applies: `wrong-number` (`wrongFigure`, the
 * figure spelled again), and `other-thing` (what another fact of the story counts, `otherPeer`: it
 * differs, neither phrase holds the other, and neither the source's words nor the figure name it).
 */
export function figureVariants(fx: KeptFigure): FigureVariant[] {
  const variant = (kind: FigureKind, shown: FigureShown, change: string): FigureVariant => ({ id: `${fx.id}#${kind}`, figure: fx, kind, shown, change })
  const { value, valueHigh } = fx.fact
  const planted = value === null ? null : wrongFigure({ value, valueHigh }, fx.shown.source)
  // Spelled again as production spells a figure for the check (`spelledFigure`, through `figureItemOf`)
  const number = planted && figureItemOf({ ...fx.fact, ...planted })?.number
  const other = otherPeer(fx.shown.counts, fx.peers, `${fx.shown.number} ${fx.shown.counts}`, fx.shown.source)
  return [
    variant('faithful', fx.shown, ''),
    ...(number && number !== fx.shown.number ? [variant('wrong-number', { ...fx.shown, number }, `${fx.shown.number} → ${number}`)] : []),
    ...(other ? [variant('other-thing', { ...fx.shown, counts: other }, `${fx.shown.counts} → ${other}`)] : []),
  ]
}

/** The items in a fixed-seed shuffle, so a story's figures and a figure's variants spread over the calls, cut into calls. */
export function figureBatches<T extends Asked>(items: T[]): T[][] {
  const shuffled = byEvalHash(items, i => i.id)
  return Array.from({ length: Math.ceil(shuffled.length / FIGURES_PER_CALL) }, (_, i) => shuffled.slice(i * FIGURES_PER_CALL, (i + 1) * FIGURES_PER_CALL))
}

/** A figure's id in its call: its 1-based place there, written as a ref. */
const placeId = (position: number) => `S${position}F1`

/** Production's prompt on the figures as shown, each named by its place in the call. */
export const figurePrompt = (batch: Asked[]): string => buildFigureCheckPrompt(batch.map((item, i) => ({ id: placeId(i + 1), ...item.shown })))

/** Each item's answer by its place in the call; the first answer for an id counts, an id outside the call is ignored. */
export function readFigureAnswers<T>(batch: T[], answer: FigureCheck | null): Answered<T>[] {
  const byId = new Map<string, FigureAnswer>()
  for (const entry of answer?.figures ?? []) if (!byId.has(entry.id)) byId.set(entry.id, entry.inSource)
  return batch.map((item, i) => ({ item, answer: byId.get(placeId(i + 1)) ?? null }))
}

/** One arm's answers on the items, in the items' order; a failed call's items unanswered. */
async function askFigures<T extends Asked>(ctx: SuiteContext, a: Arm, items: T[], schemaName: string): Promise<Answered<T>[]> {
  const answered = await Promise.all(
    figureBatches(items).map(async batch => {
      const rec = await ctx.call(a, schemaName, figureCheckSchema, figurePrompt(batch))
      return readFigureAnswers(batch, rec.outcome === 'ok' ? rec.parsed : null)
    }),
  )
  const byId = new Map(answered.flat().map(x => [x.item.id, x]))
  return items.map(item => byId.get(item.id) ?? { item, answer: null })
}

/** The strong judge on each sampled figure as production showed it, once (no repeat), in sample order. */
export const labelFigures = (ctx: SuiteContext, figures: FigureFixture[]): Promise<Answered<FigureFixture>[]> =>
  askFigures(ctx, LABEL_ARM, figures, FIGURE_CHECK_SCHEMA_NAME)

/** The variants of the kept figures the judge found given, in sample order. */
const variantsOf = (labels: Answered<FigureFixture>[]): FigureVariant[] =>
  labels.flatMap(({ item, answer }) => (item.kept && answer === 'given' ? figureVariants(item) : []))

export interface FigureArmRuns {
  arm: string
  /** `runs[k - 1]`: run k's answers, in the variants' order. */
  runs: Answered<FigureVariant>[][]
}

/** Every arm on every variant, `repeat` times; run k ≥ 2 under its own cache key (`repeats.ts`). */
export async function runFigureArms(ctx: SuiteContext, variants: FigureVariant[], arms: Arm[], repeat: number): Promise<FigureArmRuns[]> {
  const out: FigureArmRuns[] = []
  for (const a of arms) {
    const runs: Answered<FigureVariant>[][] = []
    for (const k of runNumbers(repeat)) runs.push(await askFigures(ctx, a, variants, runSchemaName(FIGURE_CHECK_SCHEMA_NAME, k)))
    out.push({ arm: armKey(a), runs })
  }
  return out
}

// ---------------------------------------------------------------------------
// Planned calls and the budget
// ---------------------------------------------------------------------------

const planned = (a: Arm, schemaName: string, items: Asked[]): PlannedCall[] =>
  figureBatches(items).map(batch => ({ arm: a, schemaName, prompt: figurePrompt(batch), baseOutputTokens: batch.length * OUTPUT_TOKENS_PER_FIGURE }))

/** The label pass's calls, as `labelFigures` makes them. */
export const plannedFigureLabelCalls = (figures: FigureFixture[]): PlannedCall[] => planned(LABEL_ARM, FIGURE_CHECK_SCHEMA_NAME, figures)

/** Each arm's runs on `variants`, as `runFigureArms` makes them. */
export const plannedFigureArmCalls = (variants: FigureVariant[], arms: Arm[], repeat: number): PlannedCall[] =>
  arms.flatMap(a => runNumbers(repeat).flatMap(k => planned(a, runSchemaName(FIGURE_CHECK_SCHEMA_NAME, k), variants)))

export interface FigureCheckEstimate {
  labels: CallEstimate
  arms: CallEstimate
  /** True while a label is uncached: the arms are then planned on every kept figure's variants, as if the judge found them all given. */
  armsUpperBound: boolean
}

/** What the step would call, before it calls anything: the labels are read only when the cache holds every one. */
export async function estimateFigureCheck(ctx: BudgetedContext, figures: FigureFixture[], arms: Arm[], repeat: number): Promise<FigureCheckEstimate> {
  const labels = estimateCalls(ctx, plannedFigureLabelCalls(figures))
  const variants = labels.uncached === 0 ? variantsOf(await labelFigures(ctx, figures)) : figures.flatMap(f => (f.kept ? figureVariants(f) : []))
  return { labels, arms: estimateCalls(ctx, plannedFigureArmCalls(variants, arms, repeat)), armsUpperBound: labels.uncached > 0 }
}

export interface FigureCheckRun {
  /** Each sampled figure with the judge's answer, in sample order; null when the label pass did not run. */
  labels: Answered<FigureFixture>[] | null
  variants: FigureVariant[]
  runs: FigureArmRuns[]
  /** The pass the budget or the missing key stopped before its calls, and why; null when both ran. */
  stopped: { pass: 'labels' | 'arms'; reason: string } | null
}

/**
 * The label pass when its calls fit, then the variants of the kept figures the judge found given,
 * then every arm on them when those calls, planned now that the labels are known, fit what is left.
 */
export async function runFigureCheck(ctx: BudgetedContext, figures: FigureFixture[], arms: Arm[], repeat: number, gate: CallGate): Promise<FigureCheckRun> {
  const labelsRefused = refusal(estimateCalls(ctx, plannedFigureLabelCalls(figures)), ctx, gate)
  if (labelsRefused) return { labels: null, variants: [], runs: [], stopped: { pass: 'labels', reason: labelsRefused } }
  const labels = await labelFigures(ctx, figures)
  const variants = variantsOf(labels)
  const armsRefused = refusal(estimateCalls(ctx, plannedFigureArmCalls(variants, arms, repeat)), ctx, gate)
  if (armsRefused) return { labels, variants, runs: [], stopped: { pass: 'arms', reason: armsRefused } }
  return { labels, variants, runs: await runFigureArms(ctx, variants, arms, repeat), stopped: null }
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** The step's sample source: run 1's stories of `--facts context` or `--facts pool` (`figureInput`, `factSources.ts`). */
export interface FigureCheckInput {
  source: RenderedFactSource
  half: OverviewHalf
  stories: StoryFacts[]
}

export interface FigureCheckOptions {
  size: number
  /** Label and judge only the sample's first N figures (a smoke run). */
  limit?: number
  arms: Arm[]
  repeat: number
  gate: CallGate
}

/** What the step did, for the console and the report (`figureCheckReport.ts`). */
export interface FigureCheckResult extends Omit<FigureCheckRun, 'runs'> {
  source: RenderedFactSource
  half: OverviewHalf
  sample: FigureSample
  /** Figures the label pass was asked about: the sample, or its first `--limit`. */
  labeled: number
  limit?: number
  /** What the passes were estimated to cost before any call. */
  estimate: FigureCheckEstimate
  score: FigureCheckScore
}

/** The step: the sample, the estimate, the label pass and the arms each checked against the budget, and the scores. */
export async function runFigureCheckStep(ctx: BudgetedContext, input: FigureCheckInput, o: FigureCheckOptions): Promise<FigureCheckResult> {
  const sample = figureFixtures(input.stories, o.size)
  const figures = o.limit === undefined ? sample.figures : sample.figures.slice(0, o.limit)
  const estimate = await estimateFigureCheck(ctx, figures, o.arms, o.repeat)
  const { runs, ...run } = await runFigureCheck(ctx, figures, o.arms, o.repeat, o.gate)
  return {
    source: input.source,
    half: input.half,
    sample,
    labeled: figures.length,
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    estimate,
    ...run,
    score: scoreFigureCheck(run.labels, runs),
  }
}
