/**
 * Research's real cost (`eval:overviews`, step `baseline`), to replace the design's desk estimates:
 * the runs of the last 30 days, anchored on the newest run, by trigger and by verdict; what a run
 * with a stored result cost (`cost_usd`: mean, median, 90th percentile), its Tavily credits, and
 * its model cost (`cost_usd` less the credits at the price the run recorded, else as stored). One
 * SELECT through the read-only session; the aggregation is pure.
 */
import { percentile } from '../checks.js'
import type { SelectDb } from '../readOnlyDb.js'
import { TAVILY_USD_PER_CREDIT } from '../research/tavily.js'

export const WINDOW_DAYS = 30

export interface BaselineRun {
  trigger: string
  status: string
  verdict: string | null
  /** The measured cost once the result is stored; the reservation while running; $0 for a skipped run. */
  costUsd: number
  tavilyCredits: number
  hasResult: boolean
  /** `result.prices.tavilyUsdPerCredit` as stored (a JSON number, else absent). */
  creditUsd: unknown
  startedAt: Date
}

interface BaselineRow {
  trigger: string
  status: string
  verdict: string | null
  cost_usd: number
  tavily_credits: number
  has_result: boolean
  credit_usd: unknown
  started_at: Date
}

export async function loadBaselineRuns(db: SelectDb): Promise<BaselineRun[]> {
  const rows = await db.$queryRaw<BaselineRow[]>`
    SELECT r.trigger::text AS trigger, r.status::text AS status, r.verdict, r.cost_usd, r.tavily_credits,
           r.result IS NOT NULL AS has_result, r.result->'prices'->'tavilyUsdPerCredit' AS credit_usd, r.started_at
    FROM story_research_runs r
    WHERE r.started_at > (SELECT max(started_at) FROM story_research_runs) - ${WINDOW_DAYS}::int * interval '1 day'
    ORDER BY r.started_at DESC`
  return rows.map(r => ({
    trigger: r.trigger,
    status: r.status,
    verdict: r.verdict,
    costUsd: Number(r.cost_usd),
    tavilyCredits: Number(r.tavily_credits),
    hasResult: r.has_result,
    creditUsd: r.credit_usd,
    startedAt: r.started_at,
  }))
}

export interface CostStats {
  n: number
  mean: number | null
  median: number | null
  p90: number | null
}

export interface Baseline {
  /** The newest run's start; the window counts back from it. */
  anchor: string | null
  runs: number
  /** `[trigger, runs]`, most first. */
  byTrigger: [string, number][]
  /** `[verdict, runs]`, most first; a run without one by its status. */
  byVerdict: [string, number][]
  /** Runs with a stored result, whose `cost_usd` is what they cost. */
  measured: number
  /** Runs without: a reservation still running or a skipped run. */
  unmeasured: number
  cost: CostStats
  model: CostStats
  /** Measured runs whose result records no credit price: their model cost is `cost_usd` as stored. */
  modelAsStored: number
  credits: { mean: number | null; usdMean: number | null }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length)

const stats = (values: number[]): CostStats => ({ n: values.length, mean: mean(values), median: median(values), p90: percentile(values, 90) })

function counted(keys: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/** The credit price a run recorded, or null when it recorded none. */
function creditPrice(value: unknown): number | null {
  const price = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(price) ? price : null
}

export function summarizeBaseline(runs: BaselineRun[]): Baseline {
  const measured = runs.filter(r => r.hasResult)
  const model = measured.map(r => {
    const price = creditPrice(r.creditUsd)
    return { usd: price === null ? r.costUsd : Math.max(0, r.costUsd - r.tavilyCredits * price), asStored: price === null }
  })
  const credits = mean(measured.map(r => r.tavilyCredits))
  const newest = runs.reduce<Date | null>((at, r) => (at === null || r.startedAt > at ? r.startedAt : at), null)
  return {
    anchor: newest?.toISOString() ?? null,
    runs: runs.length,
    byTrigger: counted(runs.map(r => r.trigger)),
    byVerdict: counted(runs.map(r => r.verdict ?? `(${r.status}, no verdict)`)),
    measured: measured.length,
    unmeasured: runs.length - measured.length,
    cost: stats(measured.map(r => r.costUsd)),
    model: stats(model.map(m => m.usd)),
    modelAsStored: model.filter(m => m.asStored).length,
    credits: { mean: credits, usdMean: credits === null ? null : credits * TAVILY_USD_PER_CREDIT },
  }
}
