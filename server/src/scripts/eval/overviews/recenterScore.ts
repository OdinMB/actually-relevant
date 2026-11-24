/**
 * The `recenter` bars (`.context/model-eval.md`, "Overview evals"; plan
 * `.plans/2026-11-19_overview-recentering.md`, "Evals"), scored on production's automated re-center
 * run directly on cases built from the answer keys (`recenter.ts`): re-centered where a re-center is
 * expected (the planted narrowed charters and a reviewed center of a key, ≥90%, left to the owner under
 * 20 judgments); no named END_EVENT other than the expected one (the strong judge; one naming none is
 * counted, never wrong; report only); and, each a share of at most 10% since the owner's ruling of
 * 2026-11-24 (none until then): false re-centers (of the anchor breach, the neighbor a wider charter
 * would absorb and the end-checkpoint negatives), near misses among the stories the applied re-centers
 * took in, and proposals whose own judgments
 * broke the anchor (`draftHoldsAnchor`: what the model made of it before code held both calls to it,
 * since an applied re-center holds it by construction). Counts over all runs. Pure.
 */
import type { RecenterOutcome, RecenterRule } from '../../../services/overviewRecenter.js'
import { bar, END_EVENT_REPORT_ONLY, rateBar, ratio, RECENTER_MISTAKES_BAR, reportOnly, shareBar, type Bar, type EndEventVerdict } from './linkScore.js'

/** 90% since the owner raised it on 2026-11-24 (80% until then). */
export const RECENTERED_BAR = 0.9

/** The cases' kinds, and the runs each is asked (the plan's table; the neighbor case as the breach). */
export type RecenterCaseKind = 'planted' | 'center' | 'breach' | 'neighbour' | 'negative'
export const RECENTER_RUNS: Readonly<Record<RecenterCaseKind, number>> = { planted: 3, center: 3, breach: 3, neighbour: 3, negative: 1 }
/** A re-center is expected of a planted narrowed charter and of a key's center; of a breach, a neighbor case or a negative it is a false one. */
export const expectsRecenter = (kind: RecenterCaseKind): boolean => kind === 'planted' || kind === 'center'

/** One attempt on one case, as the bars and the report read it; stories by slug. */
export interface RecenterCaseRun {
  case: string
  kind: RecenterCaseKind
  key: string
  day: string
  run: number
  outcome: RecenterOutcome
  /** The first rule that refused it, and every rule that did. */
  rule: RecenterRule | null
  refusals: RecenterRule[]
  title: string | null
  endEvent: string | null
  joined: string[]
  /** The joined stories that are near misses of the case. */
  nearMissesJoined: string[]
  detached: string[]
  /** For a draft that proposed a re-center: whether its own judgments held the anchor, before the check and the code rules; null otherwise. */
  draftAnchorHeld: boolean | null
  /** For an expected re-center applied: its END_EVENT against the expected one; null otherwise. */
  endEventVerdict: EndEventVerdict
  why: string | null
  costUsd: number
}

export interface RecenterScore {
  /** Expected re-centers answered (not failed), and those re-centered. */
  positives: number
  recentered: number
  /** Breach, neighbor and negative attempts answered, and those re-centered. */
  negatives: number
  falseRecenters: number
  nearMissesJoined: number
  /** Proposals made (drafts answering `recenter`), and those whose own judgments broke the anchor. */
  proposals: number
  anchorBreaks: number
  failed: number
  endEvents: Record<'right' | 'wrong' | 'none' | 'unjudged', number>
  /** What held where no re-center was expected: `kept`, or the refusing rule. */
  heldBy: Record<string, number>
  bars: Bar[]
}

export function scoreRecenters(runs: readonly RecenterCaseRun[]): RecenterScore {
  const answered = runs.filter(r => r.outcome !== 'failed')
  const positives = answered.filter(r => expectsRecenter(r.kind))
  const negatives = answered.filter(r => !expectsRecenter(r.kind))
  const applied = answered.filter(r => r.outcome === 'recentered')
  const endEvents = { right: 0, wrong: 0, none: 0, unjudged: 0 }
  for (const r of positives) if (r.endEventVerdict) endEvents[r.endEventVerdict]++
  const heldBy: Record<string, number> = {}
  for (const r of negatives.filter(x => x.outcome !== 'recentered')) {
    const by = r.outcome === 'kept' ? 'kept' : `refused (${r.rule ?? 'unknown'})`
    heldBy[by] = (heldBy[by] ?? 0) + 1
  }
  const recentered = positives.filter(r => r.outcome === 'recentered').length
  const falseRecenters = negatives.filter(r => r.outcome === 'recentered').length
  const nearMissesJoined = applied.reduce((s, r) => s + r.nearMissesJoined.length, 0)
  const proposals = runs.filter(r => r.draftAnchorHeld !== null)
  const anchorBreaks = proposals.filter(r => r.draftAnchorHeld === false).length
  const judgedEnds = endEvents.right + endEvents.wrong + endEvents.none
  return {
    positives: positives.length,
    recentered,
    negatives: negatives.length,
    falseRecenters,
    nearMissesJoined,
    proposals: proposals.length,
    anchorBreaks,
    failed: runs.length - answered.length,
    endEvents,
    heldBy,
    bars: [
      rateBar('re-centered where expected', ratio(recentered, positives.length), RECENTERED_BAR, positives.length),
      reportOnly(
        bar('wrong end events (where one is named)', endEvents.unjudged > 0 || judgedEnds === 0 ? null : endEvents.wrong, 0, 'atMost'),
        END_EVENT_REPORT_ONLY,
      ),
      shareBar('false re-centers', falseRecenters, negatives.length, RECENTER_MISTAKES_BAR),
      shareBar(
        // Of the stories the applied re-centers took in
        'near misses joined',
        nearMissesJoined,
        applied.reduce((s, r) => s + r.joined.length, 0),
        RECENTER_MISTAKES_BAR,
        answered.length > 0,
      ),
      shareBar('proposals whose own judgments broke the anchor', anchorBreaks, proposals.length, RECENTER_MISTAKES_BAR),
    ],
  }
}
