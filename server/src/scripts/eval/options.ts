/**
 * Parse and validate the eval CLI flags (eval:models and eval:recalibrate).
 * Kept apart from the entry points so the spend cap can be tested without
 * loading `.env`.
 */
import { parseArgs } from 'node:util'
import { parseEffort, type ReasoningEffort } from '../../config.js'
import type { Half } from './sampling.js'
import type { SuiteName } from './types.js'

export const SUITE_NAMES: SuiteName[] = ['preassess', 'assess', 'dedup', 'related', 'social', 'large']
export const DEFAULT_BUDGET_USD = 18
/** This project's API spend cap for the eval. */
export const MAX_BUDGET_USD = 20
/**
 * Stories crawled before this date predate the current prompts and issue set.
 * `--floor` moves it earlier when the database copy is older than that (the
 * report states the floor used).
 */
export const DEFAULT_FLOOR = '2026-03-01'

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
}

function positiveInt(flag: string, value: string | undefined, fallback?: number): number | undefined {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`)
  return n
}

/** `--budget` caps the ledger total for the output folder (all runs), never above the project cap. */
function budgetOf(value: string | undefined): number {
  const budget = value === undefined ? DEFAULT_BUDGET_USD : Number(value)
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
    },
  })
  if (!values.out) throw new Error('--out is required')
  return {
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

export const RECALIBRATION_STEPS = ['preassess', 'assess', 'dedup', 'rating-set', 'social-post'] as const
export type RecalibrationStep = (typeof RECALIBRATION_STEPS)[number]
/**
 * The recalibration's own checks. The rating set pays for gpt-5-mini and
 * rewrites the owner's file, and the phase-2 ship checks (social post) test
 * other prompts, so those run only when named.
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
    },
  })
  if (!values.out) throw new Error('--out is required')
  const half = HALVES.find(h => h === (values.half ?? 'all'))
  if (!half) throw new Error(`--half must be one of ${HALVES.join(', ')}`)
  const steps = listOf('--steps', values.steps, RECALIBRATION_STEPS, RECALIBRATION_DEFAULT_STEPS)
  const limit = positiveInt('--limit', values.limit)
  if (limit !== undefined && steps.includes('rating-set')) {
    throw new Error('--limit cannot be combined with the rating-set step: a partial set would replace the full one in the owner\'s file')
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
  }
}
