/**
 * The `review` bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored on
 * reviews of each development with planted errors (`review.ts`): near misses inserted as wrong joins,
 * a role flipped, the charter's OUT list emptied. Caught: wrong joins detached, flipped roles set back
 * to the key's, emptied charters narrowed again (an OUT entry added) where a wrong join was planted
 * (≥80% of everything planted). Correct items demoted: the key's entries detached or their right
 * roles changed (≤3%). Means over runs. Pure.
 */
import type { ReviewAction } from '../../../services/overviewReview.js'
import type { Role } from '../../../services/overviewTypes.js'
import { bar, mean, ratio, type Bar } from './linkScore.js'

export const CAUGHT_BAR = 0.8
export const DEMOTED_BAR = 0.03

/** One development's planted review and what code allowed of its answer. */
export interface ReviewCaseRun {
  key: string
  run: number
  /** Entries planted as wrong joins (near misses), by entry id. */
  plantedJoins: string[]
  /** The entry whose role was flipped, with the key's role. */
  plantedRole: { entryId: string; keyRole: Role } | null
  /** Correct entries (the key's), by entry id, with their key roles; one that accepts either role (`eitherRole`) is not demoted by a relabel. */
  correct: { entryId: string; keyRole: Role; eitherRole?: boolean }[]
  /** The review's outcome and the actions code allowed. */
  outcome: 'reviewed' | 'failed'
  actions: ReviewAction[]
  costUsd: number
}

export interface ReviewRunScore {
  run: number
  planted: number
  caught: number
  correct: number
  demoted: number
}

export function scoreReviewRun(cases: readonly ReviewCaseRun[]): Omit<ReviewRunScore, 'run'> {
  let planted = 0
  let caught = 0
  let correct = 0
  let demoted = 0
  for (const c of cases) {
    if (c.outcome !== 'reviewed') continue
    const detached = new Set(c.actions.flatMap(a => (a.kind === 'detach' ? [a.entryId] : [])))
    const relabeled = new Map(c.actions.flatMap(a => (a.kind === 'relabel' ? [[a.entryId, a.to] as const] : [])))
    planted += c.plantedJoins.length
    caught += c.plantedJoins.filter(id => detached.has(id)).length
    if (c.plantedRole) {
      planted++
      if (relabeled.get(c.plantedRole.entryId)?.role === c.plantedRole.keyRole.role) caught++
    }
    if (c.plantedJoins.length > 0) {
      planted++
      if (c.actions.some(a => a.kind === 'narrow')) caught++
    }
    for (const e of c.correct) {
      correct++
      const to = relabeled.get(e.entryId)
      if (detached.has(e.entryId) || (to && !e.eitherRole && to.role !== e.keyRole.role)) demoted++
    }
  }
  return { planted, caught, correct, demoted }
}

export interface ReviewScore {
  runs: ReviewRunScore[]
  bars: Bar[]
}

export function scoreReviews(cases: readonly ReviewCaseRun[]): ReviewScore {
  const runs = [...new Set(cases.map(c => c.run))].sort((a, b) => a - b).map(run => ({ run, ...scoreReviewRun(cases.filter(c => c.run === run)) }))
  return {
    runs,
    bars: [
      bar('planted errors caught', mean(runs.map(r => ratio(r.caught, r.planted))), CAUGHT_BAR),
      bar('correct items demoted', mean(runs.map(r => ratio(r.demoted, r.correct))), DEMOTED_BAR, 'atMost'),
    ],
  }
}
