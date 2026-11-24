/**
 * Scores the figure check (`figureCheck.ts`). Production against the labels: of the figures production
 * kept and the strong judge answered, the share it finds not given (drift that got through); of those
 * production removed, the share it finds given (false removals); each with its counts and the
 * disagreements to read. Each arm under planted errors: the share of planted errors answered anything
 * but `given` (caught) and of faithful figures answered anything but `given` (removed), every run
 * pooled, held against the fact check's bars (`CATCH_BAR`, `FALSE_REJECTION_BAR`), report only until the
 * owner sets the figure check's own; and the misses and false removals to read. As in the fact
 * check's scores (`factCheckScore.ts`), a figure or variant with no answer counts in no share: it is
 * reported as unlabeled or unjudged, never as caught (as production would remove it) nor as missed.
 * Pure.
 */
import type { FigureAnswer } from '../../../schemas/storyContext.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, FIDELITY_REPORT_ONLY, MAX_LISTED } from './factCheckScore.js'
import type { Answered, FigureArmRuns, FigureFixture, FigureVariant } from './figureCheck.js'
import { expectedGiven, FIGURE_KINDS, type FigureKind } from './plant.js'
import { bar, ratio, reportOnly, type Bar } from './linkScore.js'

/** Production's answers on one group of real figures, against the judge's. */
export interface ProductionGroup {
  /** Figures of the group the judge answered. */
  labeled: number
  /** Of those, the ones the judge disagrees with production on: a kept one it finds not given, a removed one it finds given. */
  disagreed: number
  /** Figures it gave no answer for: in no share. */
  unlabeled: number
  /** disagreed / labeled; null with none labeled. */
  share: number | null
  /** The disagreements, the first `MAX_LISTED`, in sample order, with the judge's answer. */
  listed: Answered<FigureFixture>[]
}

export interface FigureAgreement {
  /** The figures production kept: the share the judge finds not given is drift that got through. */
  kept: ProductionGroup
  /** The figures production removed: the share the judge finds given is false removals. */
  removed: ProductionGroup
}

export interface FigureKindRate {
  kind: FigureKind
  expected: 'given' | 'not given'
  /** Variants of the kind (each answered once per run). */
  items: number
  /** Answers given, over all runs. */
  answered: number
  /** Of those, anything but `given`. */
  notGiven: number
  share: number | null
}

/** A variant an arm got wrong in at least one run. */
export interface ListedVariant {
  variant: FigureVariant
  /** Each run's answer, run 1 first; null where it gave none. */
  answers: (FigureAnswer | null)[]
  /** Runs it went wrong in. */
  times: number
}

export interface FigureArmScore {
  arm: string
  runs: number
  perKind: FigureKindRate[]
  /** Planted errors answered anything but `given`, of those answered, every run pooled; null with none answered. */
  caught: number | null
  /** Faithful variants answered anything but `given`, of those answered; null with none answered. */
  removed: number | null
  /** Answers missing over all runs (left out of the answer, or a failed call's): in no share. */
  unjudged: number
  /** The two shares against their reference levels, report only. */
  bars: Bar[]
  /** Planted errors answered `given` in some run, the most often first, the first `MAX_LISTED`. */
  misses: ListedVariant[]
  /** Faithful variants answered anything but `given` in some run, the same way. */
  falseRemovals: ListedVariant[]
  /** Distinct variants missed, and wrongly removed, before the lists' cap. */
  missCount: number
  falseRemovalCount: number
}

export interface FigureCheckScore {
  /** Null when the label pass did not run. */
  agreement: FigureAgreement | null
  arms: FigureArmScore[]
  /** Every arm's bars, in arm order. */
  bars: Bar[]
}

const notGiven = (answer: FigureAnswer | null) => answer !== null && answer !== 'given'

function productionGroup(labels: Answered<FigureFixture>[], disagrees: (answer: FigureAnswer) => boolean): ProductionGroup {
  const labeled = labels.filter(l => l.answer !== null)
  const disagreed = labeled.filter(l => l.answer !== null && disagrees(l.answer))
  return {
    labeled: labeled.length,
    disagreed: disagreed.length,
    unlabeled: labels.length - labeled.length,
    share: ratio(disagreed.length, labeled.length),
    listed: disagreed.slice(0, MAX_LISTED),
  }
}

/** The share of answered items answered anything but `given`; null with none answered. */
function notGivenShare(answers: Answered<FigureVariant>[]): number | null {
  const answered = answers.filter(a => a.answer !== null)
  return ratio(answered.filter(a => notGiven(a.answer)).length, answered.length)
}

/** The variants some run got wrong, the most often wrong first, then in variant order. */
function wrongVariants(runs: Answered<FigureVariant>[][], wrong: (a: Answered<FigureVariant>) => boolean): ListedVariant[] {
  const first = runs[0] ?? []
  return first
    .map((a, i) => ({ variant: a.item, answers: runs.map(run => run[i]?.answer ?? null), times: runs.filter(run => run[i] && wrong(run[i]!)).length }))
    .filter(x => x.times > 0)
    .sort((a, b) => b.times - a.times)
}

function scoreArm({ arm, runs }: FigureArmRuns): FigureArmScore {
  const pooled = runs.flat()
  const first = runs[0] ?? []
  const caught = notGivenShare(pooled.filter(a => !expectedGiven(a.item.kind)))
  const removed = notGivenShare(pooled.filter(a => expectedGiven(a.item.kind)))
  const misses = wrongVariants(runs, a => !expectedGiven(a.item.kind) && a.answer === 'given')
  const falseRemovals = wrongVariants(runs, a => expectedGiven(a.item.kind) && notGiven(a.answer))
  return {
    arm,
    runs: runs.length,
    perKind: FIGURE_KINDS.map(kind => {
      const ofKind = pooled.filter(a => a.item.kind === kind)
      const answered = ofKind.filter(a => a.answer !== null)
      return {
        kind,
        expected: expectedGiven(kind) ? 'given' : 'not given',
        items: first.filter(a => a.item.kind === kind).length,
        answered: answered.length,
        notGiven: answered.filter(a => notGiven(a.answer)).length,
        share: notGivenShare(ofKind),
      }
    }),
    caught,
    removed,
    unjudged: pooled.filter(a => a.answer === null).length,
    bars: [
      reportOnly(bar(`planted figure errors caught (${arm})`, caught, CATCH_BAR), FIDELITY_REPORT_ONLY),
      reportOnly({ ...bar(`faithful figures removed (${arm})`, removed, FALSE_REJECTION_BAR, 'atMost'), share: true }, FIDELITY_REPORT_ONLY),
    ],
    misses: misses.slice(0, MAX_LISTED),
    falseRemovals: falseRemovals.slice(0, MAX_LISTED),
    missCount: misses.length,
    falseRemovalCount: falseRemovals.length,
  }
}

/** The label pass's answers against production's (null: it did not run), and each arm's runs on the variants. */
export function scoreFigureCheck(labels: Answered<FigureFixture>[] | null, runs: FigureArmRuns[]): FigureCheckScore {
  const arms = runs.map(scoreArm)
  return {
    agreement: labels && {
      kept: productionGroup(
        labels.filter(l => l.item.kept),
        a => a !== 'given',
      ),
      removed: productionGroup(
        labels.filter(l => !l.item.kept),
        a => a === 'given',
      ),
    },
    arms,
    bars: arms.flatMap(a => a.bars),
  }
}
