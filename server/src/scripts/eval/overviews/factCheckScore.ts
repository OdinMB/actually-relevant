/**
 * Scores the fact check. One arm under planted errors: per variant kind the share judged
 * unsupported, the catch rate on the planted errors and the false rejections on the faithful
 * variants, each pooled over the runs and held against the design's first bars (shown as met or
 * not, never as a gate); with repeated runs the spread across runs and how often a verdict flips;
 * and the misses and false rejections to read. Unjudged items count in no rate. And, for a sample
 * of rendered module-1 facts, a measure of the rendering itself (`scoreFidelity`): the label pass
 * and the second pass on the facts it rejected (`factDrift.ts`) together give the share of facts
 * with a figure, and of those without, that are faithful to their source: accepted by the label
 * pass, or rejected by it only for context its one sentence lacks. Pure.
 */
import { disagreement, spread, type Disagreement, type Spread } from '../repeats.js'
import type { ArmRuns, Labels, Verdict } from './factCheck.js'
import type { DriftReading } from './factDrift.js'
import { DRIFT_KINDS, type DriftKind } from './factDriftPrompt.js'
import type { FactFixture } from './factFixtures.js'
import { bar, ratio, reportOnly, type Bar } from './linkScore.js'
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

// ---------------------------------------------------------------------------
// The two strong-judge passes as a measure of the rendering
// ---------------------------------------------------------------------------

/** The level the two fidelity shares are shown against until the owner sets their bars: the neighboring `FIELDS_BAR`'s (`contextScore.ts`). */
export const FIDELITY_REFERENCE = 0.95
export const FIDELITY_REPORT_ONLY = 'report only: first measurement, the owner sets the bar'

export interface FidelityGroup {
  /** Facts the label pass gave a verdict for. */
  judged: number
  /** Of those, the facts it accepted as rendered. */
  accepted: number
  /** The rest of them: each fact it rejected, with its reason, in the labels' order. */
  rejected: Verdict[]
  /** Facts it gave no verdict for: in neither count, and in no share. */
  unlabeled: number
  /** accepted / judged: the label pass alone, which counts context its one sentence lacks against the fact. Null with none judged. */
  acceptedShare: number | null
  /** Of the rejected facts, those the second pass found to lack only context; null when it did not run. */
  context: number | null
  /** Those it found changed, with the kind and its reason, in the labels' order; empty when it did not run. */
  changed: DriftReading[]
  /** Those it left unanswered: counted as not faithful; empty when it did not run. */
  unjudged: DriftReading[]
  /** accepted + context; null when the second pass did not run. */
  faithful: number | null
  /** faithful / judged: the measure. Null when the second pass did not run, or with none judged. */
  share: number | null
}

export interface Fidelity {
  withFigure: FidelityGroup
  withoutFigure: FidelityGroup
  /** Two report-only bars on the faithful shares, with a figure first. */
  bars: Bar[]
  /** The changed facts of each group by kind, every kind of `DRIFT_KINDS` in its order; empty when the second pass did not run. */
  changedByKind: { kind: DriftKind; withFigure: number; withoutFigure: number }[]
}

/** A module-1 fact whose record holds a value; a fact with no record carries none. */
const hasFigure = (f: FactFixture) => f.context !== undefined && f.context.fact.value !== null

/** Each rejected fact's reading, met by the rejection's item id, never by position; a fact the second pass gave none is unjudged. */
function readingsOf(rejected: Verdict[], readings: DriftReading[]): DriftReading[] {
  const byId = new Map<string, DriftReading>()
  for (const r of readings) if (!byId.has(r.rejection.item.id)) byId.set(r.rejection.item.id, r)
  return rejected.map(v => byId.get(v.item.id) ?? { rejection: v, category: null, kind: null, reason: '' })
}

function fidelityGroup(labels: Labels, readings: DriftReading[] | null, inGroup: (f: FactFixture) => boolean): FidelityGroup {
  const accepted = labels.accepted.filter(inGroup).length
  const rejected = labels.unsupported.filter(v => inGroup(v.item.fact))
  const judged = accepted + rejected.length
  const labeled = { judged, accepted, rejected, unlabeled: labels.unlabeled.filter(inGroup).length, acceptedShare: ratio(accepted, judged) }
  if (readings === null) return { ...labeled, context: null, changed: [], unjudged: [], faithful: null, share: null }
  const read = readingsOf(rejected, readings)
  const context = read.filter(r => r.category === 'context').length
  return {
    ...labeled,
    context,
    changed: read.filter(r => r.category === 'changed'),
    unjudged: read.filter(r => r.category === null),
    faithful: accepted + context,
    share: ratio(accepted + context, judged),
  }
}

/**
 * The fact check's two strong-judge passes read as a measure of the rendering: each sampled fact as
 * `renderFact` shows it to writers and checks, against its source's sentence or passage and the
 * source's date, before any error is planted; split by whether the fact carries a figure. A fact is
 * faithful when the label pass accepts it, or rejects it only for context its one sentence lacks
 * (the second pass's `context`); a fact the second pass finds changed, or leaves unanswered, is not.
 * `readings` null: the second pass did not run, and only the label pass's own share is known. Every
 * fact is shown as its statement with its record beside it (ADR-0080; until 2026-11-24 a fact with a
 * figure and a counted thing was shown from its fields alone, so shares from before are not comparable
 * fact for fact). Both bars are report only until the owner sets them.
 */
export function scoreFidelity(labels: Labels, readings: DriftReading[] | null): Fidelity {
  const withFigure = fidelityGroup(labels, readings, hasFigure)
  const withoutFigure = fidelityGroup(labels, readings, f => !hasFigure(f))
  const count = (g: FidelityGroup, kind: DriftKind) => g.changed.filter(r => r.kind === kind).length
  return {
    withFigure,
    withoutFigure,
    bars: [
      reportOnly(bar('facts with a figure faithful to their source', withFigure.share, FIDELITY_REFERENCE), FIDELITY_REPORT_ONLY),
      reportOnly(bar('facts without a figure faithful to their source', withoutFigure.share, FIDELITY_REFERENCE), FIDELITY_REPORT_ONLY),
    ],
    changedByKind: readings === null ? [] : DRIFT_KINDS.map(k => ({ kind: k, withFigure: count(withFigure, k), withoutFigure: count(withoutFigure, k) })),
  }
}
