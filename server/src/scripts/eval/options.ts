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
/** This project's API spend cap for the eval: no `--budget` above it is accepted. */
export const MAX_BUDGET_USD = 20
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
 * Every step, in the order a run takes them: `context`, `pass-pool` and `stands` before `fact-check`,
 * which `--facts context`, `--facts pool` and `--facts stands` sample from, and before `figure-check`,
 * which samples the figures of `--facts context` or `--facts pool`; `pass-pool` before `update`,
 * `stands` and `replay`, which take its pools (`update` its first passes' versions too, whenever both
 * run).
 */
export const OVERVIEW_STEPS = [
  'keys',
  'key-draft',
  'gap-keys',
  'gap-draft',
  'context',
  'link',
  'found',
  'role',
  'pass-pool',
  'update',
  'stands',
  'review',
  'recenter',
  'replay',
  'fact-check',
  'figure-check',
  'baseline',
] as const
export type OverviewStep = (typeof OVERVIEW_STEPS)[number]
/** The overview linking steps: one replay of the half's stories serves all three, each scoring its own bars. */
export const LINKING_STEPS: readonly OverviewStep[] = ['link', 'found', 'role']
/**
 * A run without `--steps`. Story context's, the research passes' and the overviews' steps run only
 * when named: `key-draft` drafts the answer keys' responses into the committed keys, and
 * runs on its own; `gap-draft` writes drafts for the check, `context` searches with Tavily and calls the
 * strong judge, `update` replays a later pass's article step on the answer keys' stories and judges
 * its notes, `link`, `found` and `role` replay the overview linking on the answer keys' stories,
 * `pass-pool` researches the half's stories in memory (Tavily), `stands` writes and judges the stands
 * at the developments' checkpoints, `review` reviews them with planted errors, `recenter` asks the
 * automated re-center on planted and real cases, and `replay` replays the whole module.
 */
export const OVERVIEW_DEFAULT_STEPS: readonly OverviewStep[] = ['keys', 'fact-check', 'baseline']
/**
 * Which facts the fact check plants errors in (`--facts`). For each: the step whose run 1 it samples,
 * named beside `fact-check` or `figure-check` in `--steps` (null for research's extracted statements,
 * sampled from the database); what that step leaves to sample; and whether the sample is module-1
 * facts as production's `renderFact` renders them, statement and record, so the field kinds are
 * planted in them and the label pass, with a second pass on the facts it rejects
 * (`overviews/factDrift.ts`, paid calls of its own), measures the rendering (`scoreFidelity`). Only a
 * rendered source has figures for `figure-check` to sample, with the figures production's figure
 * check removed. Each sample is built by its entry in `overviews/factSources.ts`.
 */
export const OVERVIEW_FACT_SOURCES = {
  research: { step: null, samples: "research's extracted statements", rendered: false },
  context: { step: 'context', samples: 'the facts the context step keeps', rendered: true },
  stands: { step: 'stands', samples: 'the lines the stands step keeps', rendered: false },
  pool: { step: 'pass-pool', samples: "the facts the pass-pool step's first passes keep", rendered: true },
} as const satisfies Record<string, { step: OverviewStep | null; samples: string; rendered: boolean }>
export type OverviewFactSource = keyof typeof OVERVIEW_FACT_SOURCES
/** The sources of module-1 facts as rendered (`rendered`): the ones `figure-check` samples. */
export type RenderedFactSource = {
  [K in OverviewFactSource]: (typeof OVERVIEW_FACT_SOURCES)[K]['rendered'] extends true ? K : never
}[OverviewFactSource]
const isFactSource = (s: string): s is OverviewFactSource => Object.hasOwn(OVERVIEW_FACT_SOURCES, s)
export const isRenderedSource = (s: OverviewFactSource): s is RenderedFactSource => OVERVIEW_FACT_SOURCES[s].rendered
const OVERVIEW_HALVES = ['tune', 'judge', 'all'] as const
export type OverviewHalf = (typeof OVERVIEW_HALVES)[number]
export const OVERVIEW_DEFAULT_BUDGET_USD = 3
/**
 * Calls in flight at once across the run, above the other evals' 4: the linking replay's repeats run
 * side by side, each at production's look-ahead of 3 (`config.overviews.concurrency`), so three of
 * them ask for 9 calls at once.
 */
export const OVERVIEW_DEFAULT_CONCURRENCY = 8
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
  /** Answer every call from the folder's cache and make none: a missed call answers nothing, as one past the budget does, and the steps go on (a free rerun). */
  cacheOnly: boolean
  /** Score the linking steps' saved replay again under today's keys and scorer, with no model call and no database (`link.ts`, `rescoreLinkStep`). */
  rescore: boolean
  /** Calls in flight at once; the linking replay's look-ahead within a run is production's, at most. */
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
  /**
   * What the fact check samples (`OVERVIEW_FACT_SOURCES`): research's statements from the database, or
   * what run 1 of a step named beside it kept: the `context` step's facts (`context`), the `pass-pool`
   * step's first passes' facts (`pool`), the `stands` step's lines (`stands`). The figure check samples
   * the figures of `context` or `pool`.
   */
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
      'cache-only': { type: 'boolean', default: false },
      rescore: { type: 'boolean', default: false },
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
  if (values['cache-only'] && values['dry-run']) throw new Error('--cache-only reruns the steps from the cache; --dry-run only estimates them: name one')
  const size = positiveInt('--size', values.size, OVERVIEW_DEFAULT_SIZE) ?? OVERVIEW_DEFAULT_SIZE
  if (size > OVERVIEW_MAX_SIZE) throw new Error(`--size must be at most ${OVERVIEW_MAX_SIZE}`)
  const repeat = positiveInt('--repeat', values.repeat, 1) ?? 1
  if (repeat > MAX_REPEAT) throw new Error(`--repeat must be at most ${MAX_REPEAT}`)
  const limit = positiveInt('--limit', values.limit)
  const steps = listOf('--steps', values.steps, OVERVIEW_STEPS, OVERVIEW_DEFAULT_STEPS)
  if (values.rescore) {
    if (values['dry-run']) throw new Error('--rescore scores the saved linking replay and makes no call; --dry-run only estimates a run: name one')
    if (values['cache-only'])
      throw new Error('--rescore already answers only from the cache, and scores the saved replay rather than replaying: drop --cache-only')
    if (steps.some(s => !LINKING_STEPS.includes(s))) {
      throw new Error(`--rescore scores the linking steps' saved replay: --steps takes only ${LINKING_STEPS.join(', ')} with it`)
    }
  }
  if (steps.includes('key-draft') && steps.length > 1) {
    throw new Error('--steps key-draft runs on its own: it writes the answer keys the other steps read; review its drafts, then run the others')
  }
  const facts = values.facts ?? 'research'
  if (!isFactSource(facts)) throw new Error(`--facts must be one of ${Object.keys(OVERVIEW_FACT_SOURCES).join(', ')}`)
  if (steps.includes('figure-check') && !isRenderedSource(facts)) {
    throw new Error('figure-check samples the figures of run 1: name --facts pool (with pass-pool) or --facts context (with context)')
  }
  const { step: sampled, samples } = OVERVIEW_FACT_SOURCES[facts]
  if (sampled && !(steps.includes(sampled) && (steps.includes('fact-check') || steps.includes('figure-check')))) {
    throw new Error(
      `--facts ${facts} samples ${samples}: name both ${sampled} and fact-check or figure-check in --steps (the ${sampled} step's calls are cached, so a repeated run costs nothing more)`,
    )
  }
  const half = OVERVIEW_HALVES.find(h => h === (values.half ?? 'all'))
  if (!half) throw new Error(`--half must be one of ${OVERVIEW_HALVES.join(', ')}`)
  return {
    out: values.out,
    steps,
    budget: budgetOf(values.budget, OVERVIEW_DEFAULT_BUDGET_USD),
    dryRun: values['dry-run'] ?? false,
    cacheOnly: values['cache-only'] ?? false,
    rescore: values.rescore ?? false,
    concurrency: positiveInt('--concurrency', values.concurrency, OVERVIEW_DEFAULT_CONCURRENCY) ?? OVERVIEW_DEFAULT_CONCURRENCY,
    repeat,
    size,
    ...(limit !== undefined ? { limit } : {}),
    arms: armsOf(values.arms),
    refreshFixtures: values['refresh-fixtures'] ?? false,
    facts,
    half,
  }
}
