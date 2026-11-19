/**
 * Parse and validate the eval CLI flags (eval:models, eval:recalibrate,
 * eval:research and eval:overviews). Kept apart from the entry points so the
 * spend cap can be tested without loading `.env`.
 */
import { parseArgs } from 'node:util'
import { parseEffort, REASONING_EFFORTS, type ReasoningEffort } from '../../config.js'
import { MODELS } from './models.js'
import { MAX_REPEAT } from './repeats.js'
import type { Half } from './sampling.js'
import type { Arm, ModelId, SuiteName } from './types.js'

export const SUITE_NAMES: SuiteName[] = ['preassess', 'assess', 'dedup', 'related', 'social', 'large']
export const DEFAULT_BUDGET_USD = 18
/**
 * This project's API spend cap for the eval: no `--budget` above it is accepted. Raised from $20 to
 * $75 on 2026-11-19 by the owner's decision, so the overviews upkeep eval can research the judged
 * half's 121 stories in one folder (`.context/model-eval.md`, "The overviews gate, in order").
 * `--budget` still sets each run's actual cap.
 */
export const MAX_BUDGET_USD = 75
/**
 * Stories crawled before this date predate the current prompts and issue set.
 * `--floor` moves it earlier when the database copy is older than that (the
 * report states the floor used).
 */
export const DEFAULT_FLOOR = '2026-03-01'
/** Phase 1's full-assessment sample size; `--assess-size` draws a larger fresh one. */
export const DEFAULT_ASSESS_SIZE = 50
export const MAX_ASSESS_SIZE = 300

export interface EvalOptions {
  out: string
  suites: SuiteName[]
  limit?: number
  dryRun: boolean
  /** One trivial call per arm of the selected suites; needs no database. */
  apiCheck: boolean
  budget: number
  concurrency: number
  refreshFixtures: boolean
  /** Earliest crawl date (UTC, `YYYY-MM-DD`) for the stored-data suites. */
  floor: string
  /** Full-assessment stories to sample. */
  assessSize: number
  /** Eval folders whose pre-assessment and full-assessment stories leave the pools (spent samples). */
  exclude: string[]
}

function positiveInt(flag: string, value: string | undefined, fallback?: number): number | undefined {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`)
  return n
}

/** `--budget` caps the ledger total for the output folder (all runs), never above the project cap. */
function budgetOf(value: string | undefined, fallback: number = DEFAULT_BUDGET_USD): number {
  const budget = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET_USD) {
    throw new Error(`--budget must be between 0 and ${MAX_BUDGET_USD} (USD)`)
  }
  return budget
}

function floorOf(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('--floor must be a date in YYYY-MM-DD form')
  }
  return value
}

function listOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[], fallback: readonly T[]): T[] {
  const items = value ? value.split(',').map(s => s.trim()) : fallback
  const unknown = items.filter(s => !allowed.some(n => n === s))
  if (unknown.length > 0) throw new Error(`unknown ${flag} value(s): ${unknown.join(', ')}; expected ${allowed.join(', ')}`)
  return allowed.filter(n => items.includes(n))
}

export function parseOptions(argv: string[]): EvalOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      out: { type: 'string' },
      suites: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'api-check': { type: 'boolean', default: false },
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      'refresh-fixtures': { type: 'boolean', default: false },
      floor: { type: 'string' },
      'assess-size': { type: 'string' },
      exclude: { type: 'string' },
    },
  })
  if (!values.out) throw new Error('--out is required')
  const assessSize = positiveInt('--assess-size', values['assess-size'], DEFAULT_ASSESS_SIZE) ?? DEFAULT_ASSESS_SIZE
  if (assessSize > MAX_ASSESS_SIZE) throw new Error(`--assess-size must be at most ${MAX_ASSESS_SIZE}`)
  return {
    assessSize,
    exclude: (values.exclude ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== ''),
    out: values.out,
    suites: listOf('--suites', values.suites, SUITE_NAMES, SUITE_NAMES),
    limit: positiveInt('--limit', values.limit),
    dryRun: values['dry-run'] ?? false,
    apiCheck: values['api-check'] ?? false,
    budget: budgetOf(values.budget),
    concurrency: positiveInt('--concurrency', values.concurrency, 4) ?? 4,
    refreshFixtures: values['refresh-fixtures'] ?? false,
    floor: floorOf(values.floor ?? DEFAULT_FLOOR),
  }
}

// ---------------------------------------------------------------------------
// eval:recalibrate
// ---------------------------------------------------------------------------

export const RECALIBRATION_STEPS = [
  'preassess',
  'assess',
  'dedup',
  'rating-set',
  'social-post',
  'selection',
  'podcast',
  'reclassify',
  'uplifting-select',
] as const
export type RecalibrationStep = (typeof RECALIBRATION_STEPS)[number]
/**
 * The recalibration's own checks. The rating set pays for gpt-5-mini and
 * rewrites the owner's file, and the ship checks (social post, selection,
 * podcast) and the layout checks (reclassify, uplifting-select) test other
 * prompts, so those run only when named.
 */
export const RECALIBRATION_DEFAULT_STEPS: readonly RecalibrationStep[] = ['preassess', 'assess', 'dedup']
const HALVES = ['calibration', 'holdout', 'all'] as const
/** The efforts the owner's acceptance is judged at: Luna@medium for the ratings, Luna@low for dedup. */
export const RECALIBRATION_DEFAULT_EFFORT: ReasoningEffort = 'medium'
export const RECALIBRATION_DEFAULT_DEDUP_EFFORT: ReasoningEffort = 'low'

export interface RecalibrationOptions {
  out: string
  /** Which half of the phase-1 sample the checks run on (the rating set always uses every story). */
  half: Half | 'all'
  steps: RecalibrationStep[]
  /** gpt-6-luna effort for pre-assessment, full assessment and the rating set. */
  effort: ReasoningEffort
  /** gpt-6-luna effort for dedup confirmation. */
  dedupEffort: ReasoningEffort
  limit?: number
  dryRun: boolean
  budget: number
  concurrency: number
  /** When given, must match the cached fixtures' floor (the recalibration never resamples). */
  floor?: string
  /** Runs of each rating prompt (pre-assessment and full assessment); run k ≥ 2 has its own cache key. */
  repeat: number
}

export function parseRecalibrationOptions(argv: string[]): RecalibrationOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      out: { type: 'string' },
      half: { type: 'string' },
      steps: { type: 'string' },
      effort: { type: 'string' },
      'dedup-effort': { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      floor: { type: 'string' },
      repeat: { type: 'string' },
    },
  })
  if (!values.out) throw new Error('--out is required')
  const repeat = positiveInt('--repeat', values.repeat, 1) ?? 1
  if (repeat > MAX_REPEAT) throw new Error(`--repeat must be at most ${MAX_REPEAT}`)
  const half = HALVES.find(h => h === (values.half ?? 'all'))
  if (!half) throw new Error(`--half must be one of ${HALVES.join(', ')}`)
  const steps = listOf('--steps', values.steps, RECALIBRATION_STEPS, RECALIBRATION_DEFAULT_STEPS)
  const limit = positiveInt('--limit', values.limit)
  if (limit !== undefined && steps.includes('rating-set')) {
    throw new Error("--limit cannot be combined with the rating-set step: a partial set would replace the full one in the owner's file")
  }
  return {
    out: values.out,
    half,
    steps,
    effort: parseEffort(values.effort, RECALIBRATION_DEFAULT_EFFORT, '--effort'),
    dedupEffort: parseEffort(values['dedup-effort'], RECALIBRATION_DEFAULT_DEDUP_EFFORT, '--dedup-effort'),
    limit,
    dryRun: values['dry-run'] ?? false,
    budget: budgetOf(values.budget),
    concurrency: positiveInt('--concurrency', values.concurrency, 4) ?? 4,
    ...(values.floor !== undefined ? { floor: floorOf(values.floor) } : {}),
    repeat,
  }
}

// ---------------------------------------------------------------------------
// eval:research
// ---------------------------------------------------------------------------

/** A few dollars for the measurement (design, "Measuring it properly"); `MAX_BUDGET_USD` still applies. */
export const RESEARCH_DEFAULT_BUDGET_USD = 3
/** The newest published stories sampled (owner's call: ~30). */
export const RESEARCH_DEFAULT_SIZE = 30
export const RESEARCH_MAX_SIZE = 60

export interface ResearchOptions {
  out: string
  /** Stories sampled into the fixtures. */
  size: number
  /** Research only the first N sampled stories. */
  limit?: number
  dryRun: boolean
  /** Cap on the folder's model ledger plus its Tavily credits. */
  budget: number
  concurrency: number
  refreshFixtures: boolean
}

export function parseResearchOptions(argv: string[]): ResearchOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      out: { type: 'string' },
      size: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      'refresh-fixtures': { type: 'boolean', default: false },
    },
  })
  if (!values.out) throw new Error('--out is required')
  const size = positiveInt('--size', values.size, RESEARCH_DEFAULT_SIZE) ?? RESEARCH_DEFAULT_SIZE
  if (size > RESEARCH_MAX_SIZE) throw new Error(`--size must be at most ${RESEARCH_MAX_SIZE}`)
  const limit = positiveInt('--limit', values.limit)
  return {
    out: values.out,
    size,
    ...(limit !== undefined ? { limit } : {}),
    dryRun: values['dry-run'] ?? false,
    budget: budgetOf(values.budget, RESEARCH_DEFAULT_BUDGET_USD),
    concurrency: positiveInt('--concurrency', values.concurrency, 4) ?? 4,
    refreshFixtures: values['refresh-fixtures'] ?? false,
  }
}

// ---------------------------------------------------------------------------
// eval:overviews
// ---------------------------------------------------------------------------

/**
 * Every step, in the order a run takes them: `context` and `stands` before `fact-check`, which
 * `--facts context` and `--facts stands` sample from; `pass-pool` before `stands` and `replay`,
 * which take its pools.
 */
export const OVERVIEW_STEPS = [
  'keys',
  'gap-keys',
  'gap-draft',
  'context',
  'update',
  'link',
  'found',
  'role',
  'pass-pool',
  'stands',
  'closure',
  'review',
  'replay',
  'fact-check',
  'baseline',
] as const
export type OverviewStep = (typeof OVERVIEW_STEPS)[number]
/** The overview linking steps: one replay of the half's stories serves all three, each scoring its own bars. */
export const LINKING_STEPS: readonly OverviewStep[] = ['link', 'found', 'role']
/** The whole module replayed, linking and upkeep day by day: one replay serves the closure bars and the replay's own. */
export const REPLAY_STEPS: readonly OverviewStep[] = ['closure', 'replay']
/**
 * A run without `--steps`. Story context's, the research passes' and the overviews' steps run only
 * when named: `gap-draft` writes drafts for the check, `context` searches with Tavily and calls the
 * strong judge, `update` replays a later pass's article step on the answer keys' stories and judges
 * its notes, `link`, `found` and `role` replay the overview linking on the answer keys' stories,
 * `pass-pool` researches the half's stories in memory (Tavily), `stands` writes and judges the stands
 * at the developments' checkpoints, `review` reviews them with planted errors, and `closure` and
 * `replay` replay the whole module.
 */
export const OVERVIEW_DEFAULT_STEPS: readonly OverviewStep[] = ['keys', 'fact-check', 'baseline']
/** Which facts the fact check plants errors in: research's extracted statements, module 1's rendered facts, or the stands' lines. */
export const OVERVIEW_FACT_SOURCES = ['research', 'context', 'stands'] as const
export type OverviewFactSource = (typeof OVERVIEW_FACT_SOURCES)[number]
const OVERVIEW_HALVES = ['tune', 'judge', 'all'] as const
export type OverviewHalf = (typeof OVERVIEW_HALVES)[number]
export const OVERVIEW_DEFAULT_BUDGET_USD = 3
/** Facts sampled for the fact check. */
export const OVERVIEW_DEFAULT_SIZE = 300
export const OVERVIEW_MAX_SIZE = 600
/** Production's research fact-check arm: the small tier, gpt-6-luna@low (`research/pipeline.ts`). */
export const OVERVIEW_DEFAULT_ARMS: readonly Arm[] = [{ model: 'gpt-6-luna', effort: 'low' }]

export interface OverviewOptions {
  out: string
  steps: OverviewStep[]
  /** Cap on the folder's ledger total. */
  budget: number
  dryRun: boolean
  concurrency: number
  /** Runs of each arm on the variants (the label pass runs once); run k ≥ 2 has its own cache key. */
  repeat: number
  /** Facts sampled into the fixtures. */
  size: number
  /** Label and judge only the first N sampled facts (a smoke run). */
  limit?: number
  /** The fact-check arms scored. */
  arms: Arm[]
  refreshFixtures: boolean
  /** `context`: the fact check samples the facts the `context` step's run 1 kept, so both steps run; `stands`: the lines the `stands` step's run 1 kept. */
  facts: OverviewFactSource
  /** The gap keys the `context` step runs on, and the answer keys' stories the `update` and linking steps run on: prompts are tuned on `tune`, the gate is read on `judge`. */
  half: OverviewHalf
}

/** `model@effort,…`, each model one with a price in `MODELS`; duplicates once. */
function armsOf(value: string | undefined): Arm[] {
  if (value === undefined) return [...OVERVIEW_DEFAULT_ARMS]
  const arms = value.split(',').map(s => {
    const [model = '', effort = ''] = s.trim().split('@')
    const known = (Object.keys(MODELS) as ModelId[]).find(m => m === model)
    const level = REASONING_EFFORTS.find(e => e === effort)
    if (!known || !level) throw new Error(`--arms takes model@effort with a model from the price table (${Object.keys(MODELS).join(', ')}); got "${s.trim()}"`)
    return { model: known, effort: level }
  })
  return arms.filter((a, i) => arms.findIndex(b => b.model === a.model && b.effort === a.effort) === i)
}

export function parseOverviewOptions(argv: string[]): OverviewOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      out: { type: 'string' },
      steps: { type: 'string' },
      budget: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      concurrency: { type: 'string' },
      repeat: { type: 'string' },
      size: { type: 'string' },
      limit: { type: 'string' },
      arms: { type: 'string' },
      'refresh-fixtures': { type: 'boolean', default: false },
      facts: { type: 'string' },
      half: { type: 'string' },
    },
  })
  if (!values.out) throw new Error('--out is required')
  const size = positiveInt('--size', values.size, OVERVIEW_DEFAULT_SIZE) ?? OVERVIEW_DEFAULT_SIZE
  if (size > OVERVIEW_MAX_SIZE) throw new Error(`--size must be at most ${OVERVIEW_MAX_SIZE}`)
  const repeat = positiveInt('--repeat', values.repeat, 1) ?? 1
  if (repeat > MAX_REPEAT) throw new Error(`--repeat must be at most ${MAX_REPEAT}`)
  const limit = positiveInt('--limit', values.limit)
  const steps = listOf('--steps', values.steps, OVERVIEW_STEPS, OVERVIEW_DEFAULT_STEPS)
  const facts = OVERVIEW_FACT_SOURCES.find(f => f === (values.facts ?? 'research'))
  if (!facts) throw new Error(`--facts must be one of ${OVERVIEW_FACT_SOURCES.join(', ')}`)
  if (facts === 'context' && !(steps.includes('context') && steps.includes('fact-check'))) {
    throw new Error(
      "--facts context samples the facts the context step keeps: name both context and fact-check in --steps (the context step's calls and searches are cached, so a repeated run costs nothing more)",
    )
  }
  if (facts === 'stands' && !(steps.includes('stands') && steps.includes('fact-check'))) {
    throw new Error("--facts stands samples the lines the stands step keeps: name both stands and fact-check in --steps (the stands step's calls are cached)")
  }
  const half = OVERVIEW_HALVES.find(h => h === (values.half ?? 'all'))
  if (!half) throw new Error(`--half must be one of ${OVERVIEW_HALVES.join(', ')}`)
  return {
    out: values.out,
    steps,
    budget: budgetOf(values.budget, OVERVIEW_DEFAULT_BUDGET_USD),
    dryRun: values['dry-run'] ?? false,
    concurrency: positiveInt('--concurrency', values.concurrency, 4) ?? 4,
    repeat,
    size,
    ...(limit !== undefined ? { limit } : {}),
    arms: armsOf(values.arms),
    refreshFixtures: values['refresh-fixtures'] ?? false,
    facts,
    half,
  }
}
