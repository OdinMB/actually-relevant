/**
 * The `review` bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored on
 * reviews of each development with planted errors (`review.ts`): near misses inserted as wrong joins,
 * a role flipped, the charter's OUT list emptied. Caught: wrong joins detached, flipped roles set back
 * to the key's, emptied charters narrowed again (an OUT entry added) where a wrong join was planted
 * (≥90% of everything planted). Correct items, the key's entries, are held to two bars since the
 * owner split them on 2026-11-24 (a relabel weighs less than a removal): taken out (detached) ≤3%,
 * and roles kept, the share whose right role the review left alone, ≥90%.
 * Means over runs. Pure.
 */
import type { ReviewAction } from '../../../services/overviewReview.js'
import type { Role } from '../../../services/overviewTypes.js'
import { bar, mean, ratio, type Bar } from './linkScore.js'

/** Both 90% since the owner's ruling of 2026-11-24 (caught 80% until then; roles kept began that day at the `role` bar's 65%). */
export const CAUGHT_BAR = 0.9
export const ROLES_KEPT_BAR = 0.9
export const REMOVED_BAR = 0.03

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
  /** Correct entries taken out. */
  removed: number
  /** Correct entries kept with their right role changed. */
  relabeled: number
}

/** A correct entry the review changed: taken out, or its right role changed. */
export interface ReviewDemotion {
  key: string
  run: number
  entryId: string
  how: 'removed' | 'relabeled'
  keyRole: Role
  /** The role a relabel gave it. */
  to?: Role
  /** The review's reason for taking it out. */
  reason?: string
}

/** A planted error the review left standing. */
export interface ReviewMiss {
  key: string
  run: number
  what: 'wrong join kept' | 'flipped role kept' | 'charter not narrowed'
  /** The entry, for a join or a role. */
  entryId?: string
}

/** One reviewed case read against its plants: what was caught, and each demotion and miss by name. */
function readCase(c: ReviewCaseRun): { planted: number; demotions: ReviewDemotion[]; misses: ReviewMiss[] } {
  const at = { key: c.key, run: c.run }
  const detached = new Map(c.actions.flatMap(a => (a.kind === 'detach' ? [[a.entryId, a.reason] as const] : [])))
  const relabeled = new Map(c.actions.flatMap(a => (a.kind === 'relabel' ? [[a.entryId, a.to] as const] : [])))
  const misses: ReviewMiss[] = c.plantedJoins.filter(id => !detached.has(id)).map(entryId => ({ ...at, what: 'wrong join kept', entryId }))
  let planted = c.plantedJoins.length
  if (c.plantedRole) {
    planted++
    if (relabeled.get(c.plantedRole.entryId)?.role !== c.plantedRole.keyRole.role)
      misses.push({ ...at, what: 'flipped role kept', entryId: c.plantedRole.entryId })
  }
  if (c.plantedJoins.length > 0) {
    planted++
    if (!c.actions.some(a => a.kind === 'narrow')) misses.push({ ...at, what: 'charter not narrowed' })
  }
  const demotions = c.correct.flatMap((e): ReviewDemotion[] => {
    const entry = { ...at, entryId: e.entryId, keyRole: e.keyRole }
    if (detached.has(e.entryId)) return [{ ...entry, how: 'removed', reason: detached.get(e.entryId) }]
    const to = relabeled.get(e.entryId)
    return to && !e.eitherRole && to.role !== e.keyRole.role ? [{ ...entry, how: 'relabeled', to }] : []
  })
  return { planted, demotions, misses }
}

export function scoreReviewRun(cases: readonly ReviewCaseRun[]): Omit<ReviewRunScore, 'run'> {
  let planted = 0
  let caught = 0
  let correct = 0
  let removed = 0
  let relabeled = 0
  for (const c of cases) {
    if (c.outcome !== 'reviewed') continue
    const read = readCase(c)
    planted += read.planted
    caught += read.planted - read.misses.length
    correct += c.correct.length
    removed += read.demotions.filter(d => d.how === 'removed').length
    relabeled += read.demotions.filter(d => d.how === 'relabeled').length
  }
  return { planted, caught, correct, removed, relabeled }
}

export interface ReviewScore {
  runs: ReviewRunScore[]
  bars: Bar[]
  /** Every correct entry a review took out or relabeled, and every plant left standing, for a read. */
  demotions: ReviewDemotion[]
  misses: ReviewMiss[]
}

export function scoreReviews(cases: readonly ReviewCaseRun[]): ReviewScore {
  const runs = [...new Set(cases.map(c => c.run))].sort((a, b) => a - b).map(run => ({ run, ...scoreReviewRun(cases.filter(c => c.run === run)) }))
  const read = cases.filter(c => c.outcome === 'reviewed').map(readCase)
  return {
    runs,
    demotions: read.flatMap(r => r.demotions),
    misses: read.flatMap(r => r.misses),
    bars: [
      bar('planted errors caught', mean(runs.map(r => ratio(r.caught, r.planted))), CAUGHT_BAR),
      { ...bar('correct items taken out', mean(runs.map(r => ratio(r.removed, r.correct))), REMOVED_BAR, 'atMost'), share: true },
      bar('correct roles kept', mean(runs.map(r => ratio(r.correct - r.relabeled, r.correct))), ROLES_KEPT_BAR),
    ],
  }
}
