/**
 * The `context` step's scores (`.context/model-eval.md`, "Overview evals"; plan
 * `.plans/2026-11-16_story-context.md`, "Eval gate before switching on"): per story and run, what
 * the kept output meets of the gap key, the wasted searches (the response searches apart, with their
 * own hit rate), the response card, the box items the
 * strong judge found unsupported, the notes beside the text that add to them, and the cost; then
 * each measure per run, its mean over the runs with the spread, held against the design's first
 * bars (shown as met or not; the owner reads the gate off them). Also the structured-field labels'
 * score, the fixed halves and the replay's hindsight (search results undated or dated after the
 * story). Pure.
 */
import { createHash } from 'node:crypto'
import { publishedDay } from '../../../services/researchChecks.js'
import type { FactVerdict } from '../../../services/storyContextChecks.js'
import type { StoryContextResult } from '../../../services/storyContextPipeline.js'
import { boxRefs } from '../../../services/storyContextRecords.js'
import { spread, type Spread } from '../repeats.js'
import { TAVILY_USD_PER_CREDIT } from '../research/tavily.js'
import type { GapKey } from './gapKeySchema.js'

/** Prompts are tuned on `tune` only; the gate is read on `judge`. */
export type Half = 'tune' | 'judge'

/** The parity of the first byte of the slug's sha256: even is `tune`, odd is `judge`. Fixed for good. */
export function halfOf(slug: string): Half {
  return createHash('sha256').update(slug).digest()[0]! % 2 === 0 ? 'tune' : 'judge'
}

export const inHalf = (slug: string, half: Half | 'all'): boolean => half === 'all' || halfOf(slug) === half

// ---------------------------------------------------------------------------
// The design's first bars (the first run measures baseline and noise)
// ---------------------------------------------------------------------------

export const NEEDS_BAR = 0.6
export const WASTED_SEARCH_BAR = 1
export const RESPONSE_BAR = 0.7
export const PLACEMENT_BAR = 0.85
export const FIELDS_BAR = 0.95
export const COST_BAR_USD = 0.05
/** Flex bills about half the standard price; the eval keeps its own constant beside `config.llm.flex.priceFactor`. */
export const FLEX_PRICE_FACTOR = 0.5
const MAX_LISTED = 30

// ---------------------------------------------------------------------------
// One story's run
// ---------------------------------------------------------------------------

/** The strong judge on one key need: whether the kept output meets its `accepts`, citing fact ids. */
export interface NeedVerdict {
  id: string
  met: boolean
  factIds: string[]
  why: string
}

/** The strong judge on one kept box item (a sentence, tile or chart) against its cited facts. Null: no verdict. */
export interface ItemVerdict {
  label: string
  text: string
  supported: boolean | null
  problem: string
}

export type JudgedMode = 'model' | 'random'

/** The strong judge on one note beside a paragraph or point: whether it adds to it without restating it. */
export interface NoteVerdict {
  mode: JudgedMode
  /** The box's index in the result's boxes. */
  box: number
  place: string
  adds: boolean | null
  why: string
}

/** One story's run of production's pipeline with the judges' verdicts; a verdict list is null when its judge did not run. */
export interface StoryRun {
  slug: string
  /** 1-based. */
  run: number
  key: GapKey
  result: StoryContextResult
  needs: NeedVerdict[] | null
  items: ItemVerdict[] | null
  notes: NoteVerdict[] | null
}

/** The key's must needs our published story does not already state: what recall counts. */
export const openMustNeeds = (key: GapKey) => key.needs.filter(n => n.importance === 'must' && n.inStory === null)

/** A response need a source answers: must, not stated in the story, with an example the drafter found. */
export const findableResponse = (key: GapKey): boolean =>
  key.needs.some(n => n.slot === 'response' && n.importance === 'must' && n.inStory === null && n.example !== null)

type Search = StoryContextResult['record']['searches'][number]

/** Whether a search found something: one of its kept sources gave a supported fact that a kept box cites. */
function hitOf(result: StoryContextResult): (s: Search) => boolean {
  const cited = new Set(result.boxes.flatMap(boxRefs))
  const useful = new Set(result.facts.filter(f => f.origin === 'search' && f.verdict === 'supported' && cited.has(f.ref)).map(f => f.source.url))
  return s => s.kept.some(url => useful.has(url))
}

/**
 * The searches that found nothing a kept box cites, the `response` searches apart: the step always
 * makes those (ADR-0065), so they are no choice to waste. `responseSearches` counts them instead.
 */
export function wastedSearches(result: StoryContextResult): Search[] {
  const hit = hitOf(result)
  return result.record.searches.filter(s => s.slot !== 'response' && !hit(s))
}

/** The `response` searches, and those that found a fact a kept box cites. */
export function responseSearches(result: StoryContextResult): { total: number; hit: number } {
  const hit = hitOf(result)
  const response = result.record.searches.filter(s => s.slot === 'response')
  return { total: response.length, hit: response.filter(hit).length }
}

const counts = <T>(list: T[] | null, isYes: (t: T) => boolean | null) => ({
  yes: (list ?? []).filter(t => isYes(t) === true).length,
  no: (list ?? []).filter(t => isYes(t) === false).length,
  none: (list ?? []).filter(t => isYes(t) === null).length,
})

export interface StoryScore {
  needs: { must: number; met: number; unmet: string[] }
  searches: { total: number; wasted: number; notNeeded: number; response: { total: number; hit: number } }
  response: { findable: boolean; card: boolean }
  boxes: { judged: number; unsupported: number; unjudged: number }
  placement: Record<JudgedMode, { notes: number; adds: number; unjudged: number }>
  /** Model calls at the flex price, plus credits. */
  costUsd: number
}

export function storyScore(r: StoryRun): StoryScore {
  const met = new Set((r.needs ?? []).filter(v => v.met).map(v => v.id))
  const must = openMustNeeds(r.key)
  const notNeeded = new Set(r.key.notNeeded.map(n => n.slot))
  const items = counts(r.items, v => v.supported)
  const placement = (mode: JudgedMode) => {
    const c = counts(
      (r.notes ?? []).filter(n => n.mode === mode),
      n => n.adds,
    )
    return { notes: c.yes + c.no + c.none, adds: c.yes, unjudged: c.none }
  }
  return {
    needs: { must: must.length, met: must.filter(n => met.has(n.id)).length, unmet: must.filter(n => !met.has(n.id)).map(n => n.id) },
    searches: {
      total: r.result.record.searches.length,
      wasted: wastedSearches(r.result).length,
      notNeeded: r.result.record.searches.filter(s => notNeeded.has(s.slot)).length,
      response: responseSearches(r.result),
    },
    response: { findable: findableResponse(r.key), card: r.result.boxes.some(b => b.type === 'response') },
    boxes: { judged: items.yes + items.no, unsupported: items.no, unjudged: items.none },
    placement: { model: placement('model'), random: placement('random') },
    costUsd: r.result.modelUsd * FLEX_PRICE_FACTOR + r.result.credits * TAVILY_USD_PER_CREDIT,
  }
}

// ---------------------------------------------------------------------------
// Per run, and the bars over the runs
// ---------------------------------------------------------------------------

export interface RunScore {
  run: number
  stories: number
  /** Runs that ended as a technical failure: they count, with nothing kept. */
  failed: number
  needs: { must: number; met: number; recall: number | null }
  /** `wasted` leaves the `response` searches out; `response` is how many of them found a fact a kept box cites. */
  searches: { total: number; wasted: number; perStory: number | null; notNeeded: number; response: { total: number; hit: number; share: number | null } }
  response: { findable: number; withCard: number; share: number | null }
  /** `unsupported` is null when the box judge ran on none of the run's stories. */
  boxes: { judged: number; unsupported: number | null; unjudged: number }
  placement: Record<JudgedMode, { notes: number; adds: number; share: number | null }>
  costUsd: number | null
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b)
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

function runScore(run: number, stories: StoryRun[]): RunScore {
  const s = stories.map(storyScore)
  const findable = s.filter(x => x.response.findable)
  const must = sum(s.map(x => x.needs.must))
  const met = sum(s.map(x => x.needs.met))
  const wasted = sum(s.map(x => x.searches.wasted))
  const responseTotal = sum(s.map(x => x.searches.response.total))
  const responseHit = sum(s.map(x => x.searches.response.hit))
  const place = (mode: JudgedMode) => {
    const notes = sum(s.map(x => x.placement[mode].notes - x.placement[mode].unjudged))
    const adds = sum(s.map(x => x.placement[mode].adds))
    return { notes, adds, share: ratio(adds, notes) }
  }
  return {
    run,
    stories: stories.length,
    failed: stories.filter(r => r.result.status === 'failed').length,
    needs: { must, met, recall: ratio(met, must) },
    searches: {
      total: sum(s.map(x => x.searches.total)),
      wasted,
      perStory: ratio(wasted, stories.length),
      notNeeded: sum(s.map(x => x.searches.notNeeded)),
      response: { total: responseTotal, hit: responseHit, share: ratio(responseHit, responseTotal) },
    },
    response: {
      findable: findable.length,
      withCard: findable.filter(x => x.response.card).length,
      share: ratio(findable.filter(x => x.response.card).length, findable.length),
    },
    boxes: {
      judged: sum(s.map(x => x.boxes.judged)),
      unsupported: stories.some(r => r.items !== null) ? sum(s.map(x => x.boxes.unsupported)) : null,
      unjudged: sum(s.map(x => x.boxes.unjudged)),
    },
    placement: { model: place('model'), random: place('random') },
    costUsd: ratio(sum(s.map(x => x.costUsd)), stories.length),
  }
}

export type BarName = 'needs' | 'wasted' | 'response' | 'boxes' | 'placement' | 'cost'

export interface Bar {
  name: BarName
  /** The mean over the runs; null when no run measured it. */
  value: number | null
  spread: Spread | null
  met: boolean | null
}

const BAR_RULES: { name: BarName; of: (r: RunScore) => number | null; ok: (v: number) => boolean }[] = [
  { name: 'needs', of: r => r.needs.recall, ok: v => v >= NEEDS_BAR },
  { name: 'wasted', of: r => r.searches.perStory, ok: v => v <= WASTED_SEARCH_BAR },
  { name: 'response', of: r => r.response.share, ok: v => v >= RESPONSE_BAR },
  { name: 'boxes', of: r => r.boxes.unsupported, ok: v => v === 0 },
  { name: 'placement', of: r => r.placement.model.share, ok: v => v >= PLACEMENT_BAR },
  { name: 'cost', of: r => r.costUsd, ok: v => v <= COST_BAR_USD },
]

export interface ContextScore {
  runs: RunScore[]
  bars: Bar[]
  /** For a read: the box items found unsupported, the open must needs not met, the wasted searches; each capped. */
  listed: {
    unsupported: { slug: string; run: number; label: string; text: string; problem: string }[]
    unmet: { slug: string; run: number; need: string }[]
    wasted: { slug: string; run: number; slot: string; query: string }[]
  }
}

export function scoreContext(stories: StoryRun[]): ContextScore {
  const numbers = [...new Set(stories.map(s => s.run))].sort((a, b) => a - b)
  const runs = numbers.map(n =>
    runScore(
      n,
      stories.filter(s => s.run === n),
    ),
  )
  const bars = BAR_RULES.map(rule => {
    const s = spread(runs.map(rule.of))
    return { name: rule.name, value: s?.mean ?? null, spread: s, met: s ? rule.ok(s.mean) : null }
  })
  return {
    runs,
    bars,
    listed: {
      unsupported: stories
        .flatMap(r =>
          (r.items ?? []).filter(i => i.supported === false).map(i => ({ slug: r.slug, run: r.run, label: i.label, text: i.text, problem: i.problem })),
        )
        .slice(0, MAX_LISTED),
      unmet: stories.flatMap(r => storyScore(r).needs.unmet.map(need => ({ slug: r.slug, run: r.run, need }))).slice(0, MAX_LISTED),
      wasted: stories.flatMap(r => wastedSearches(r.result).map(s => ({ slug: r.slug, run: r.run, slot: s.slot, query: s.query }))).slice(0, MAX_LISTED),
    },
  }
}

// ---------------------------------------------------------------------------
// Structured fields
// ---------------------------------------------------------------------------

export const LABELED_FIELDS = ['value', 'unit', 'counted', 'place', 'asOf', 'credited'] as const
export type LabeledField = (typeof LABELED_FIELDS)[number]

/** The strong judge's label on one figure fact's structured fields, against its evidence. */
export interface FieldLabel {
  /** `<slug>#<run>:<ref>`. */
  key: string
  run: number
  /** Production's fact check's verdict on the fact. */
  verdict: FactVerdict
  right: Record<LabeledField, boolean>
  /** The value is a number its evidence does not state at all. */
  invented: boolean
  problem: string
}

export interface FieldScore {
  labeled: number
  fullyRight: number
  share: number | null
  wrong: Record<LabeledField, number>
  /** Invented numbers production's fact check passed: the bar is none. */
  inventedPassed: number
  perRun: (number | null)[]
  spread: Spread | null
  met: boolean | null
  /** Facts with a wrong field or an invented number, capped. */
  listed: FieldLabel[]
}

const fullyRight = (l: FieldLabel) => LABELED_FIELDS.every(f => l.right[f])

export function scoreFields(labels: FieldLabel[]): FieldScore {
  const right = labels.filter(fullyRight).length
  const share = ratio(right, labels.length)
  const inventedPassed = labels.filter(l => l.invented && l.verdict === 'supported').length
  const runs = [...new Set(labels.map(l => l.run))].sort((a, b) => a - b)
  const perRun = runs.map(n => {
    const of = labels.filter(l => l.run === n)
    return ratio(of.filter(fullyRight).length, of.length)
  })
  return {
    labeled: labels.length,
    fullyRight: right,
    share,
    wrong: Object.fromEntries(LABELED_FIELDS.map(f => [f, labels.filter(l => !l.right[f]).length])) as Record<LabeledField, number>,
    inventedPassed,
    perRun,
    spread: runs.length > 1 ? spread(perRun) : null,
    met: share === null ? null : share >= FIELDS_BAR && inventedPassed === 0,
    listed: labels.filter(l => !fullyRight(l) || l.invented).slice(0, MAX_LISTED),
  }
}

// ---------------------------------------------------------------------------
// Replay hindsight: what the search's end date lets through
// ---------------------------------------------------------------------------

/** One search the replay made: the story's day it ended on, and each result's date as Tavily gave it. */
export interface SearchLogEntry {
  slug: string
  run: number
  /** `YYYY-MM-DD`. */
  endDate: string
  dates: (string | null)[]
}

export interface ResultDates {
  searches: number
  results: number
  /** Results with no date Tavily could give: the end date filters nothing on them. */
  undated: number
  /** Results dated after the story's day: pages the end date let through. */
  afterStory: number
}

/** How much the end date filters: `general` results are often undated, and pages updated later still leak. */
export function resultDates(log: SearchLogEntry[]): ResultDates {
  const all = log.flatMap(s => s.dates.map(d => ({ day: publishedDay(d), end: s.endDate })))
  return {
    searches: log.length,
    results: all.length,
    undated: all.filter(r => r.day === null).length,
    afterStory: all.filter(r => r.day !== null && r.day > r.end).length,
  }
}
