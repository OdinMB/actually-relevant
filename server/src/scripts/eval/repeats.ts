/**
 * Repeated runs of the same prompt (`eval:recalibrate --repeat N`), so a small
 * rating shift can be told from run-to-run noise. Pure.
 *
 * The response cache is keyed by model, effort, schema name and prompt, so an
 * identical prompt is answered from the cache. Run k ≥ 2 therefore calls with
 * a schema name tagged `~run<k>`: the key changes, the request the model sees
 * does not (the schema name never reaches the API). Run 1 keeps the plain
 * name, so earlier ledger entries stay reachable.
 */
import { mean, num, pct } from './checks.js'

/** Most runs one invocation may ask for. */
export const MAX_REPEAT = 10

export function runSchemaName(schemaName: string, run: number): string {
  if (!Number.isInteger(run) || run < 1) throw new Error(`run must be a whole number from 1, not ${run}`)
  return run === 1 ? schemaName : `${schemaName}~run${run}`
}

/** 1 … n. */
export const runNumbers = (repeat: number): number[] => Array.from({ length: repeat }, (_, i) => i + 1)

export interface Spread {
  n: number
  mean: number
  min: number
  max: number
  /** Sample standard deviation; null for a single value. */
  sd: number | null
}

export function spread(values: (number | null)[]): Spread | null {
  const xs = values.filter((v): v is number => v != null)
  const m = mean(xs)
  if (m == null) return null
  const sd = xs.length < 2 ? null : Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1))
  return { n: xs.length, mean: m, min: Math.min(...xs), max: Math.max(...xs), sd }
}

/** Story positions with a value in every run, each as its values across runs. */
function complete<T>(perRun: (T | null | undefined)[][]): T[][] {
  const width = Math.max(0, ...perRun.map(r => r.length))
  const out: T[][] = []
  for (let i = 0; i < width; i++) {
    const values = perRun.map(r => r[i])
    if (values.every(v => v != null)) out.push(values as T[])
  }
  return out
}

export interface Disagreement {
  /** Stories with a value in every run. */
  stories: number
  /** Of those, stories whose values are not all equal. */
  differing: number
  share: number | null
}

/** `perRun[run][story]`: how many stories got different answers in different runs. */
export function disagreement<T>(perRun: (T | null | undefined)[][]): Disagreement {
  const rows = complete(perRun)
  const differing = rows.filter(vs => vs.some(v => v !== vs[0])).length
  return { stories: rows.length, differing, share: rows.length === 0 ? null : differing / rows.length }
}

/** Mean over stories rated in every run of (highest − lowest rating). */
export function meanRange(perRun: (number | null | undefined)[][]): number | null {
  return mean(complete(perRun).map(vs => Math.max(...vs) - Math.min(...vs)))
}

export interface RunNumbers {
  /** Parsed outputs in this run. */
  ok: number
  /** Mean rating offset against stored values. */
  shift: number | null
  /** Share rated at or above the threshold. */
  share: number | null
}

export interface RepeatInput {
  runs: RunNumbers[]
  /** `ratings[run][story]`, stories in the same order in every run. */
  ratings: (number | null)[][]
  threshold: number
  /** Further per-story answers to compare across runs (the pre-assessment's issue and emotion). */
  categories?: { name: string; perRun: (string | null)[][] }[]
}

const range = (s: Spread | null, f: (v: number) => string) => (s ? `${f(s.min)} to ${f(s.max)}` : 'n/a')
const share = (d: Disagreement) => `${d.differing} (${pct(d.share)})`

/** Report lines: every run, the spread across runs, and per-story disagreement. */
export function repeatDetails({ runs, ratings, threshold, categories = [] }: RepeatInput): string[] {
  const shifts = spread(runs.map(r => r.shift))
  const shares = spread(runs.map(r => r.share))
  const ratingDiff = disagreement(ratings)
  const flips = disagreement(ratings.map(run => run.map(v => (v == null ? null : v >= threshold))))
  const spreadPoints = (s: Spread | null) => (s?.sd == null ? 'n/a' : (s.sd * 100).toFixed(1))
  return [
    `**Repeated runs.** The criteria above pool all ${runs.length} runs (the averaged numbers); the lines below show how far single runs move.`,
    '',
    ...runs.map((r, i) => `- Run ${i + 1}: mean offset vs stored ${num(r.shift)}, share ≥${threshold} ${pct(r.share)}, ${r.ok} parsed.`),
    `- Across ${runs.length} runs: mean offset ${num(shifts?.mean)} (${range(shifts, v => num(v))}, SD ${num(shifts?.sd)}); ` +
      `share ≥${threshold} ${pct(shares?.mean)} (${range(shares, pct)}, SD ${spreadPoints(shares)} points).`,
    `- ${ratingDiff.stories} stories rated in every run: rating differs for ${share(ratingDiff)}, the ≥${threshold} split flips for ${share(flips)}; ` +
      `mean spread ${num(meanRange(ratings))} points between a story's highest and lowest rating.`,
    ...categories.map(c => {
      const d = disagreement(c.perRun)
      return `- ${c.name} differs for ${d.differing} of ${d.stories} (${pct(d.share)}).`
    }),
    '',
  ]
}
