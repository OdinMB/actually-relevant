/**
 * Which owed stories a run of the overview step links (`.context/overviews.md`, "How a story is
 * linked"), the same in production (`owedStories`, over the tables) and in the eval's replay (over the
 * sandbox): a story's earlier link attempts say whether it is new to linking, due again, waiting on a
 * frozen overview or for an overview's re-center (`waitInForce`, `waitsOf`), backing off after
 * failures, or given up; then the run's slices, oldest first. Pure.
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
  /** A `waiting` one whose wait for its overview's re-center is still in force (`waitInForce`). */
  waitInForce: boolean
}

/** A story's wait for an overview's re-center, as `waitInForce` reads it. */
export interface Wait {
  /** Automation may still re-center the overview (`recenterMayCome`). */
  recenterable: boolean
  /** The overview's last re-center attempt (`recenter_tried_at`, the run time it was made at). */
  triedAt: Date | null
  /** The run time the wait was written at (`linkedAt`). */
  linkedAt: Date
  /** The story's publication date. */
  datePublished: Date
}

/**
 * Whether a story published on `datePublished` may wait for a re-center at all (ADR-0078): it is within
 * `recenterLookbackDays` of `now`, the run's clock, as a re-center may take it in. A story past it never
 * waits (`linkStory`), and a wait ends once its story passes it (`waitInForce`). Pure.
 */
export const mayWaitForRecenter = (
  datePublished: Date,
  now: Date,
  options: Pick<typeof config.overviews, 'recenterLookbackDays'> = config.overviews,
): boolean => now.getTime() - datePublished.getTime() <= options.recenterLookbackDays * DAY_MS

/**
 * Whether a story's wait for an overview's re-center is still in force (ADR-0078): the overview may
 * still be re-centered by automation, has made no attempt since the wait was written (an attempt of
 * the same run, at the same run time, is after it: the upkeep runs after linking), and the story may
 * still wait (`mayWaitForRecenter`). Once not, the story is due again. Pure.
 */
export function waitInForce(w: Wait, now: Date, options: Pick<typeof config.overviews, 'recenterLookbackDays'> = config.overviews): boolean {
  const tried = w.triedAt !== null && w.triedAt.getTime() >= w.linkedAt.getTime()
  return w.recenterable && !tried && mayWaitForRecenter(w.datePublished, now, options)
}

/** A live `link` decision as the waits are read from it: production's rows, the sandbox's alike. */
export interface WaitDecision {
  storyId: string
  outcome: LinkOutcome
  /** The overview a `waiting` decision names. */
  overviewId: string | null
  /** The run time it was linked at (`linkedAt`, else when it was written). */
  at: Date
  datePublished: Date
  /** That overview as the wait reads it; null when there is none. */
  overview: Pick<Wait, 'recenterable' | 'triedAt'> | null
}

/**
 * The stories waiting for a re-center and the overviews that held each before, from their live `link`
 * decisions (ADR-0078): a story waits while its newest one is `waiting` with the wait in force
 * (`waitInForce`); every overview its `waiting` decisions name held it before. Pure.
 */
export function waitsOf(
  decisions: readonly WaitDecision[],
  now: Date,
  options: Pick<typeof config.overviews, 'recenterLookbackDays'> = config.overviews,
): { heldForRecenter: Set<string>; heldBefore: Map<string, string[]> } {
  const newest = new Map<string, WaitDecision>()
  const heldBefore = new Map<string, string[]>()
  for (const d of decisions) {
    const known = newest.get(d.storyId)
    if (!known || d.at.getTime() >= known.at.getTime()) newest.set(d.storyId, d)
    if (d.outcome === 'waiting' && d.overviewId) {
      const before = heldBefore.get(d.storyId) ?? []
      if (!before.includes(d.overviewId)) heldBefore.set(d.storyId, [...before, d.overviewId])
    }
  }
  const heldForRecenter = new Set<string>()
  for (const [storyId, d] of newest) {
    if (d.outcome === 'waiting' && d.overview && waitInForce({ ...d.overview, linkedAt: d.at, datePublished: d.datePublished }, now, options))
      heldForRecenter.add(storyId)
  }
  return { heldForRecenter, heldBefore }
}

/** A story owed a link decision (published, within the backfill window, active in no overview, no live settling decision), with its link attempts in any order. */
export interface OwedStory {
  id: string
  datePublished: Date
  attempts: readonly LinkAttempt[]
}

/**
 * Where an owed story stands: `new` to linking; due again (`retry`, its last try when one more failure
 * gives it up); waiting, with no call, on an overview still `frozen`, for an overview's re-center
 * (`waiting`, ADR-0078), or backing off after a failure (`backoff`); or `given_up`.
 */
export type OwedStanding =
  { kind: 'new' } | { kind: 'retry'; lastTry: boolean } | { kind: 'frozen' } | { kind: 'waiting' } | { kind: 'backoff' } | { kind: 'given_up' }

export type OwedOptions = Pick<typeof config.overviews, 'retryAfterDays' | 'backfillDays' | 'nightHours' | 'backfillPerRun' | 'perRun'>

const FAILING: ReadonlySet<LinkOutcome> = new Set(['failed', 'conflict'])

/**
 * A story's standing from its attempts since it was last owed afresh (after its newest undone one):
 * none, new; the newest held by an overview still frozen, it waits until the freeze lifts, and is due
 * again once it has; the newest waiting for a re-center with the wait in force, it waits until the
 * wait ends (ADR-0078); after `n` failed or conflicting attempts in a row (back to a held or waiting
 * one, which the model answered), due `retryAfterDays[n - 1]` UTC days after the last of them, and
 * given up past the schedule.
 */
export function owedStanding(attempts: readonly LinkAttempt[], now: Date, options: Pick<OwedOptions, 'retryAfterDays'> = config.overviews): OwedStanding {
  const sorted = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime())
  const since = sorted.slice(sorted.map(a => a.undone).lastIndexOf(true) + 1)
  const newest = since.at(-1)
  if (!newest) return { kind: 'new' }
  if (newest.outcome === 'held' && newest.heldFrozen) return { kind: 'frozen' }
  if (newest.outcome === 'waiting' && newest.waitInForce) return { kind: 'waiting' }
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
  /** Owed stories waiting for an overview's re-center (ADR-0078). */
  recenterWaiting: number
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
    recenterWaiting: byAge.filter(s => s.standing.kind === 'waiting').length,
  }
}
