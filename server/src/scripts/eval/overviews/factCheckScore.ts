/**
 * Scores one arm of the fact check under planted errors: per variant kind the share judged
 * unsupported, the catch rate on the planted errors and the false rejections on the faithful
 * variants, each pooled over the runs and held against the design's first bars (shown as met or
 * not, never as a gate); with repeated runs the spread across runs and how often a verdict flips;
 * and the misses and false rejections to read. Unjudged items count in no rate. Pure.
 */
import { disagreement, spread, type Disagreement, type Spread } from '../repeats.js'
import type { ArmRuns, Verdict } from './factCheck.js'
import { expectedSupported, VARIANT_KINDS, type VariantKind } from './plant.js'

/** The design's first bars (`2026-11-16_ebola-lifecycle.md`, "Evals"): the overview check's targets. */
export const CATCH_BAR = 0.9
export const FALSE_REJECTION_BAR = 0.05
/** Misses and false rejections listed for a read, each. */
export const MAX_LISTED = 30

export interface KindRate {
  kind: VariantKind
  expected: 'supported' | 'unsupported'
  /** Items of the kind (each judged once per run). */
  items: number
  /** Verdicts given, over all runs. */
  judged: number
  /** Of those, judged unsupported. */
  unsupported: number
  rate: number | null
}

/** An item the arm got wrong in at least one run. */
export interface Listed {
  kind: VariantKind
  text: string
  change: string
  sentence: string
  outlet: string
  /** Runs it went wrong in, of `runs`. */
  times: number
  runs: number
}

interface Rates {
  catchRate: number | null
  falseRejection: number | null
}

export interface ArmScore extends Rates {
  arm: string
  runs: number
  perKind: KindRate[]
  unjudged: number
  catchMet: boolean | null
  falseRejectionMet: boolean | null
  perRun: Rates[]
  /** Across runs; null for a single run. */
  spread: { catchRate: Spread | null; falseRejection: Spread | null } | null
  /** Items whose verdict differs between runs; null for a single run. */
  flips: Disagreement | null
  misses: Listed[]
  falseRejections: Listed[]
  /** Distinct items missed, and falsely rejected, before the lists' cap. */
  missCount: number
  falseRejectionCount: number
}

const share = (verdicts: Verdict[]): number | null => {
  const judged = verdicts.filter(v => v.supported !== null)
  return judged.length === 0 ? null : judged.filter(v => v.supported === false).length / judged.length
}

const ratesOf = (verdicts: Verdict[]): Rates => ({
  catchRate: share(verdicts.filter(v => !expectedSupported(v.item.kind))),
  falseRejection: share(verdicts.filter(v => expectedSupported(v.item.kind))),
})

/** The items some run got wrong, the most often wrong first, then in item order. */
function wrongItems(runs: Verdict[][], wrong: (v: Verdict) => boolean): Listed[] {
  const first = runs[0] ?? []
  return first
    .map((v, i) => ({ v, times: runs.filter(run => run[i] && wrong(run[i]!)).length }))
    .filter(x => x.times > 0)
    .sort((a, b) => b.times - a.times)
    .map(({ v, times }) => ({
      kind: v.item.kind,
      text: v.item.text,
      change: v.item.change,
      sentence: v.item.fact.sentence,
      outlet: v.item.fact.outlet,
      times,
      runs: runs.length,
    }))
}

const met = (rate: number | null, ok: (r: number) => boolean) => (rate === null ? null : ok(rate))

export function scoreArm({ arm, runs }: ArmRuns): ArmScore {
  const pooled = runs.flat()
  const first = runs[0] ?? []
  const rates = ratesOf(pooled)
  const perRun = runs.map(ratesOf)
  const misses = wrongItems(runs, v => !expectedSupported(v.item.kind) && v.supported === true)
  const falseRejections = wrongItems(runs, v => expectedSupported(v.item.kind) && v.supported === false)
  return {
    arm,
    runs: runs.length,
    ...rates,
    perKind: VARIANT_KINDS.map(kind => {
      const ofKind = pooled.filter(v => v.item.kind === kind)
      const judged = ofKind.filter(v => v.supported !== null)
      return {
        kind,
        expected: expectedSupported(kind) ? 'supported' : 'unsupported',
        items: first.filter(v => v.item.kind === kind).length,
        judged: judged.length,
        unsupported: judged.filter(v => v.supported === false).length,
        rate: share(ofKind),
      }
    }),
    unjudged: pooled.filter(v => v.supported === null).length,
    catchMet: met(rates.catchRate, r => r >= CATCH_BAR),
    falseRejectionMet: met(rates.falseRejection, r => r <= FALSE_REJECTION_BAR),
    perRun,
    spread: runs.length > 1 ? { catchRate: spread(perRun.map(r => r.catchRate)), falseRejection: spread(perRun.map(r => r.falseRejection)) } : null,
    flips: runs.length > 1 ? disagreement(runs.map(run => run.map(v => v.supported))) : null,
    misses: misses.slice(0, MAX_LISTED),
    falseRejections: falseRejections.slice(0, MAX_LISTED),
    missCount: misses.length,
    falseRejectionCount: falseRejections.length,
  }
}
