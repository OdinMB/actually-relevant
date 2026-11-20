/**
 * An overview's state as the status machine, the anomaly check and the review triggers read it
 * (`OverviewState`, `overviewStatus.ts`), from its row and its active entries: one function over
 * production's rows (`overviewStates`) and the eval sandbox's, so both judge the same overview alike.
 * The facts once folded from the decision log at each read are the row's own columns, written by the
 * lifecycle with the change they follow (`overviewChanges.ts`). Pure.
 */
import { config } from '../config.js'
import type { EntryRow, OverviewRow } from './overviewChanges.js'
import type { OverviewState } from './overviewTypes.js'

export type StateRow = Pick<
  OverviewRow,
  | 'id'
  | 'title'
  | 'scope'
  | 'status'
  | 'closedReason'
  | 'frozen'
  | 'frozenBy'
  | 'frozenAt'
  | 'hidden'
  | 'lastEntryAt'
  | 'closingSince'
  | 'closingStoryId'
  | 'closureReviewedAt'
  | 'entriesAtLastReview'
  | 'reviewedAt'
  | 'reopenedAt'
  | 'joinsCountedFrom'
  | 'recenteredAt'
  | 'recenteredBy'
>

export type StateEntry = Pick<EntryRow, 'id' | 'storyId' | 'status' | 'joinedBy' | 'joinedAt' | 'published' | 'datePublished'>

const HOUR_MS = 3_600_000

/**
 * The state (`.context/overviews.md`, "Status, closing and reviews"): its active entries of published
 * stories counted and those of stories no longer published listed; the burst count, the stories
 * published in the last `nightHours` of `now` that the pipeline joined after `joinsCountedFrom` (the
 * last freeze, unfreeze, review or undo), so a backfill's old stories and the joins one freeze answered
 * never count; while frozen by a burst and not reviewed since, when; while closing, its end-event story
 * and whether its closure review ran; when a person last reopened it; the newest reader's report
 * that queued a review (`reportAt`, from the feedback the caller reads); and its last re-center.
 */
export function overviewStateOf(
  o: StateRow,
  entries: readonly StateEntry[],
  reportAt: Date | null,
  now: Date,
  options: Pick<typeof config.overviews, 'nightHours'> = config.overviews,
): OverviewState {
  const active = entries.filter(e => e.status === 'active')
  const nightStart = now.getTime() - options.nightHours * HOUR_MS
  const countFrom = Math.max(nightStart, o.joinsCountedFrom?.getTime() ?? 0)
  const burstJoins = active.filter(
    e => e.joinedBy === 'pipeline' && e.published && e.datePublished !== null && e.datePublished.getTime() > nightStart && e.joinedAt.getTime() > countFrom,
  ).length
  const closing = o.status === 'closing'
  return {
    id: o.id,
    title: o.title,
    scope: o.scope,
    status: o.status,
    closedReason: o.closedReason,
    frozen: o.frozen,
    hidden: o.hidden,
    lastEntryAt: o.lastEntryAt,
    closingSince: o.closingSince,
    closingStoryId: closing ? o.closingStoryId : null,
    activeEntries: active.filter(e => e.published).length,
    unpublished: active.flatMap(e => (!e.published && e.storyId ? [{ entryId: e.id, storyId: e.storyId }] : [])),
    entriesAtLastReview: o.entriesAtLastReview,
    reviewedAt: o.reviewedAt,
    burstJoins,
    // An editor's freeze and the detach brake's hold until an editor lifts them: no burst review clears them
    burstAt: o.frozen && o.frozenBy === 'burst' && o.frozenAt && (o.reviewedAt === null || o.reviewedAt.getTime() < o.frozenAt.getTime()) ? o.frozenAt : null,
    closureReviewed: closing && o.closureReviewedAt !== null,
    reopenedAt: o.reopenedAt,
    reportAt,
    recenteredAt: o.recenteredAt,
    recenteredBy: o.recenteredBy,
  }
}
