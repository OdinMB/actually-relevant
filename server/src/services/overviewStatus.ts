/**
 * The overview scope and status machine, the anomaly check and the review triggers
 * (`.context/overviews.md`, "Status, closing and reviews"). Code only: the one model step of closing,
 * the end-event agreement, is `overviewClose.ts`'s; this module turns an overview's state into the
 * moves the lifecycle applies. Development time: `clock` is the day linking has reached (today, or
 * while a backfill drains the newest story it linked), so quiet, closing and fading count in the
 * development's own time; `now` is the wall clock reviews are spaced by. Pure.
 */
import { config } from '../config.js'
import type { OverviewScope, OverviewState, OverviewStatus, ReviewTrigger } from './overviewTypes.js'

const DAY_MS = 86_400_000
const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS

export type StatusOptions = Pick<
  typeof config.overviews,
  'quietAfterDays' | 'fadeAfterDays' | 'closingDays' | 'burstLimit' | 'reviewAt' | 'reviewEveryDays' | 'reportReviewEveryDays'
>

/** Why a status moved. */
export type StatusReason = 'quiet' | 'active' | 'faded' | 'end_event' | 'closing_cancelled'

/**
 * One move the lifecycle applies (`applyStatus`), each logged as a `status` decision. `cancel_closing`:
 * the story whose end-event report began the closing is no longer published, so the closing ends and
 * the overview is open again (part of the unpublished-member rule, so frozen or not).
 */
export type StatusMove =
  | { kind: 'detach'; entryId: string; storyId: string }
  | { kind: 'scope'; from: OverviewScope; to: OverviewScope }
  | { kind: 'cancel_closing'; storyId: string }
  | { kind: 'status'; from: OverviewStatus; to: OverviewStatus; reason: StatusReason }

/**
 * The scope the active entries leave: one or none is `single`; a single overview grown to two again is
 * `forming`. Forming becomes ongoing only through a review (`scopeAfterReview`), and an ongoing one
 * falling below 3 stays public until its next review decides.
 */
export function scopeAfter(scope: OverviewScope, activeEntries: number): OverviewScope {
  if (activeEntries <= 1) return 'single'
  return scope === 'single' ? 'forming' : scope
}

/** The scope a review leaves: at least 3 entries kept make it ongoing (public), 2 forming, 1 or none single. */
export const scopeAfterReview = (kept: number): OverviewScope => (kept >= 3 ? 'ongoing' : kept === 2 ? 'forming' : 'single')

/** A new entry after the end-event story: the closing is cancelled. */
const newerThanClosing = (s: OverviewState) => s.closingSince !== null && s.lastEntryAt !== null && s.lastEntryAt.getTime() > s.closingSince.getTime()

/** The closing period is over: `closingDays` since the end-event story, in development time. */
const closingOver = (s: OverviewState, clock: Date, options: StatusOptions) =>
  s.closingSince !== null && daysBetween(s.closingSince, clock) >= options.closingDays

function statusAfter(s: OverviewState, clock: Date, options: StatusOptions): { to: OverviewStatus; reason: StatusReason } | null {
  if (s.status === 'closing') {
    if (newerThanClosing(s)) return { to: 'open', reason: 'closing_cancelled' }
    // Closed only after the review the design requires before any closure
    return closingOver(s, clock, options) && s.closureReviewed ? { to: 'closed', reason: 'end_event' } : null
  }
  if (s.lastEntryAt === null) return null
  // A person's reopen counts as activity: the next run does not close it again
  const since = s.reopenedAt && s.reopenedAt.getTime() > s.lastEntryAt.getTime() ? s.reopenedAt : s.lastEntryAt
  const quiet = daysBetween(since, clock)
  if (s.status === 'closed') return s.closedReason === 'faded' && quiet < options.fadeAfterDays ? { to: 'open', reason: 'active' } : null
  if (quiet >= options.fadeAfterDays) return { to: 'closed', reason: 'faded' }
  if (quiet >= options.quietAfterDays) return s.status === 'quiet' ? null : { to: 'quiet', reason: 'quiet' }
  return s.status === 'quiet' ? { to: 'open', reason: 'active' } : null
}

/**
 * The moves an overview is due (`.context/overviews.md`, "Status, closing and reviews"): its active
 * entries whose story is no longer published detached, and its scope recomputed, frozen or not; then,
 * unless frozen, its status: open to quiet after `quietAfterDays` without a new entry (or since a
 * person reopened it, when later) and back on one,
 * closed as faded after `fadeAfterDays` and a faded one reopened by a new entry, a closing cancelled by
 * an entry after the end-event story, or closed at its end event once `closingDays` have passed and
 * its review has run. A closing whose end-event story is no longer published is cancelled instead,
 * frozen or not, since what began it is gone (the closure review cannot see that story to detach it).
 * An end-event closure itself begins only on the two calls' agreement (`overviewClose.ts`), never
 * here; an editor's closure never moves.
 */
export function nextState(state: OverviewState, clock: Date, options: StatusOptions = config.overviews): StatusMove[] {
  const moves: StatusMove[] = state.unpublished.map(u => ({ kind: 'detach', entryId: u.entryId, storyId: u.storyId }))
  const scope = scopeAfter(state.scope, state.activeEntries)
  if (scope !== state.scope) moves.push({ kind: 'scope', from: state.scope, to: scope })
  const closingStory = state.status === 'closing' ? state.closingStoryId : null
  if (closingStory !== null && state.unpublished.some(u => u.storyId === closingStory)) {
    moves.push({ kind: 'cancel_closing', storyId: closingStory })
    return moves
  }
  if (state.frozen) return moves
  const status = statusAfter(state, clock, options)
  if (status) moves.push({ kind: 'status', from: state.status, ...status })
  return moves
}

/** What the anomaly check finds: a burst, more than `burstLimit` stories published in the last day joined in one night (frozen overviews are already paused). */
export type Anomaly = 'burst'

export function anomalies(state: OverviewState, options: Pick<StatusOptions, 'burstLimit'> = config.overviews): Anomaly[] {
  return !state.frozen && state.burstJoins > options.burstLimit ? ['burst'] : []
}

/**
 * The review an overview is due, if any, the most pressing first: a burst's (the only one a frozen
 * overview gets, and the one that may clear its freeze); the review before an end-event closure once
 * its closing period is over; a reader's report that queued one, while no review has run since; an
 * editor's re-center, likewise (it reads every entry under the new charter; an Undo's queues none); each
 * time the active entries reach a count of `reviewAt` since the last review kept fewer (so a forming
 * overview cut back by one is reviewed again when it climbs back to 3); and every `reviewEveryDays` of
 * wall-clock time while public and not closed. A single overview is never reviewed.
 */
export function reviewDue(
  state: OverviewState,
  at: { clock: Date; now: Date },
  options: StatusOptions = config.overviews,
): Exclude<ReviewTrigger, 'audit'> | null {
  if (state.scope === 'single') return null
  if (state.burstAt !== null) return 'burst'
  if (state.frozen) return null
  if (state.status === 'closing' && !state.closureReviewed && !newerThanClosing(state) && closingOver(state, at.clock, options)) return 'closure'
  const sinceReview = (at: Date | null) => at !== null && (state.reviewedAt === null || at.getTime() > state.reviewedAt.getTime())
  if (sinceReview(state.reportAt)) return 'report'
  if (state.recenteredBy === 'editor' && sinceReview(state.recenteredAt)) return 'recenter'
  if (options.reviewAt.some(t => state.entriesAtLastReview < t && t <= state.activeEntries)) return 'entries'
  const spaced = state.reviewedAt !== null && daysBetween(state.reviewedAt, at.now) >= options.reviewEveryDays
  return state.scope === 'ongoing' && state.status !== 'closed' && spaced ? 'periodic' : null
}

/**
 * Whether a reader's "Report an error" queues the overview's review (`report` above): unless another
 * report queued one within `reportReviewEveryDays` (`lastQueued`, the newest that did), so a reader
 * queues at most one review per overview in that time, however many reports come.
 */
export function reportQueuesReview(lastQueued: Date | null, now: Date, options: Pick<StatusOptions, 'reportReviewEveryDays'> = config.overviews): boolean {
  return lastQueued === null || daysBetween(lastQueued, now) >= options.reportReviewEveryDays
}
