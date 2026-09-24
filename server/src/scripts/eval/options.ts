/**
 * Parse and validate the eval CLI flags. Kept apart from run.ts so the spend
 * cap can be tested without loading `.env`.
 */
import { parseArgs } from 'node:util'
import type { SuiteName } from './types.js'

export const SUITE_NAMES: SuiteName[] = ['preassess', 'assess', 'dedup', 'related', 'social', 'large']
export const DEFAULT_BUDGET_USD = 18
/** This project's API spend cap for the eval. */
export const MAX_BUDGET_USD = 20

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
}

function positiveInt(flag: string, value: string | undefined, fallback?: number): number | undefined {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`)
  return n
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
    },
  })
  if (!values.out) throw new Error('--out is required')
  const suites = values.suites ? values.suites.split(',').map(s => s.trim()) : SUITE_NAMES
  const unknown = suites.filter(s => !SUITE_NAMES.some(n => n === s))
  if (unknown.length > 0) throw new Error(`unknown suite(s): ${unknown.join(', ')}; expected ${SUITE_NAMES.join(', ')}`)
  const budget = values.budget === undefined ? DEFAULT_BUDGET_USD : Number(values.budget)
  if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET_USD) {
    throw new Error(`--budget must be between 0 and ${MAX_BUDGET_USD} (USD)`)
  }
  return {
    out: values.out,
    suites: SUITE_NAMES.filter(n => suites.includes(n)),
    limit: positiveInt('--limit', values.limit),
    dryRun: values['dry-run'] ?? false,
    apiCheck: values['api-check'] ?? false,
    budget,
    concurrency: positiveInt('--concurrency', values.concurrency, 4) ?? 4,
    refreshFixtures: values['refresh-fixtures'] ?? false,
  }
}
