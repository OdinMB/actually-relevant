/**
 * Which owed stories a run of the overview step links (`.context/overviews.md`, "How a story is
 * linked"), the same in production (`owedStories`, over the tables) and in the eval's replay (over the
 * sandbox): a story's earlier link attempts say whether it is new to linking, due again, waiting on a
 * frozen overview, backing off after failures, or given up; then the run's slices, oldest first. Pure.
 */
import { config } from '../config.js'
import { dayStart, utcDay } from '../lib/days.js'
import type { LinkOutcome } from './overviewTypes.js'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** One of a story's `link` decisions as the owed rule reads it: production's rows, the sandbox's alike. */
export interface LinkAttempt {
  outcome: LinkOutcome
  /** It was undone: the story was owed afresh after it (an Undo of its join, its story unpublished). */
  undone: boolean
  /** The run time it was linked at (`linkedAt`, else when it was written). */
  at: Date
  /** A `held` one whose overview is still frozen. */
  heldFrozen: boolean
}

/** A story owed a link decision (published, within the backfill window, active in no overview, no live settling decision), with its link attempts in any order. */
export interface OwedStory {
  id: string
  datePublished: Date
  attempts: readonly LinkAttempt[]
}

/**
 * Where an owed story stands: `new` to linking; due again (`retry`, its last try when one more failure
 * gives it up); waiting, with no call, on an overview still `frozen`, or backing off after a failure
 * (`backoff`); or `given_up`.
 */
export type OwedStanding = { kind: 'new' } | { kind: 'retry'; lastTry: boolean } | { kind: 'frozen' } | { kind: 'backoff' } | { kind: 'given_up' }

export type OwedOptions = Pick<typeof config.overviews, 'retryAfterDays' | 'backfillDays' | 'nightHours' | 'backfillPerRun' | 'perRun'>

const FAILING: ReadonlySet<LinkOutcome> = new Set(['failed', 'conflict'])

/**
 * A story's standing from its attempts since it was last owed afresh (after its newest undone one):
 * none, new; the newest held by an overview still frozen, it waits until the freeze lifts, and is due
 * again once it has; after `n` failed or conflicting attempts in a row (back to a held one, which the
 * model answered), due `retryAfterDays[n - 1]` UTC days after the last of them, and given up past the
 * schedule.
 */
export function owedStanding(attempts: readonly LinkAttempt[], now: Date, options: Pick<OwedOptions, 'retryAfterDays'> = config.overviews): OwedStanding {
  const sorted = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime())
  const since = sorted.slice(sorted.map(a => a.undone).lastIndexOf(true) + 1)
  const newest = since.at(-1)
  if (!newest) return { kind: 'new' }
  if (newest.outcome === 'held' && newest.heldFrozen) return { kind: 'frozen' }
  let streak = 0
  for (let i = since.length - 1; i >= 0 && FAILING.has(since[i]!.outcome); i--) streak++
  if (streak === 0) return { kind: 'retry', lastTry: options.retryAfterDays.length === 0 }
  const wait = options.retryAfterDays[streak - 1]
  if (wait === undefined) return { kind: 'given_up' }
  const days = (dayStart(utcDay(now)).getTime() - dayStart(utcDay(newest.at)).getTime()) / DAY_MS
  return days >= wait ? { kind: 'retry', lastTry: streak === options.retryAfterDays.length } : { kind: 'backoff' }
}

export interface OwedSlices {
  /** Older owed stories new to linking, oldest first, at most `backfillPerRun`. */
  backlog: string[]
  /** Owed stories due again, oldest first, in the room the backlog leaves of `backfillPerRun`: after the new ones, so they never starve them. */
  retries: string[]
  /** The night's stories new to linking, oldest first, at most `perRun`; none while older new ones remain beyond the backlog's slice. */
  night: string[]
  /** Every older owed story new to linking, for the summary's "backfill N of M". */
  backlogTotal: number
  /** The retries on their last try: one more failure or conflict gives them up. */
  lastTries: string[]
  /** Owed stories waiting on an overview still frozen. */
  frozenWaiting: number
}

/**
 * The stories one run links: the backlog of older stories new to linking (the backfill) oldest first,
 * then the retries due in the room it leaves, then the night's new stories, only once the backlog's
 * slice takes every older new one. So no story is linked before an older one it may belong with
 * (while the backfill drains, the night's stories wait), and stories already tried, however many,
 * never hold a new one back.
 */
export function owedSlices(stories: readonly OwedStory[], now: Date, options: OwedOptions = config.overviews): OwedSlices {
  const since = now.getTime() - options.backfillDays * DAY_MS
  const nightStart = now.getTime() - options.nightHours * HOUR_MS
  const byAge = stories
    .filter(s => s.datePublished.getTime() >= since)
    .sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime() || a.id.localeCompare(b.id))
    .map(s => ({ story: s, standing: owedStanding(s.attempts, now, options) }))
  const fresh = byAge.filter(s => s.standing.kind === 'new')
  const older = fresh.filter(s => s.story.datePublished.getTime() < nightStart).map(s => s.story.id)
  const backlog = older.slice(0, options.backfillPerRun)
  const due = byAge.flatMap(s => (s.standing.kind === 'retry' ? [{ id: s.story.id, lastTry: s.standing.lastTry }] : []))
  const retries = due.slice(0, Math.max(0, options.backfillPerRun - backlog.length))
  const night =
    older.length > backlog.length
      ? []
      : fresh
          .filter(s => s.story.datePublished.getTime() >= nightStart)
          .slice(0, options.perRun)
          .map(s => s.story.id)
  return {
    backlog,
    retries: retries.map(r => r.id),
    night,
    backlogTotal: older.length,
    lastTries: retries.filter(r => r.lastTry).map(r => r.id),
    frozenWaiting: byAge.filter(s => s.standing.kind === 'frozen').length,
  }
}
