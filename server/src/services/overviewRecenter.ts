/**
 * The rules that hold re-centering to where a development began (`.context/overviews.md`,
 * "Re-centering"; D-RC14, the owner's): the anchor every re-center must still cover, and the fixed
 * limits on an automated one (its scope and status, the limit of applied automated re-centers, and the
 * lock an editor's or an Undo's re-center sets). The admin reads the anchor to show it in the editor's
 * form; the automated re-center applies both. Pure.
 */
import { config } from '../config.js'
import type { EntryRole, OverviewScope, OverviewStatus } from './overviewTypes.js'

const DAY_MS = 86_400_000

export type RecenterOptions = Pick<typeof config.overviews, 'anchorTurningShare' | 'anchorStandIns' | 'maxAutomatedRecenters' | 'editorRecenterLockDays'>

/** An entry as the anchor reads it. */
export interface AnchorEntry {
  entryId: string
  status: 'active' | 'detached'
  /** Its story is published: an unpublished story cannot be judged, so it is no part of the anchor. */
  published: boolean
  datePublished: Date | null
  role: EntryRole
}

/** The anchor: the entries a re-center must still cover, oldest first. */
export interface Anchor {
  /** The founding entries still active and published; with none left, the oldest active ones standing in (`standIns`). */
  founding: string[]
  standIns: boolean
  /** The other active published entries that are turning points. */
  turningPoints: string[]
}

/**
 * The anchor of an overview (`foundingIds`: the entries its founding made). A founding entry detached
 * since, or whose story is no longer published, leaves it: its removal already said it does not belong.
 * When no founding entry is left, the `anchorStandIns` oldest active entries stand in, so the anchor
 * always holds the development's start.
 */
export function anchorOf(entries: readonly AnchorEntry[], foundingIds: Iterable<string>, options: RecenterOptions = config.overviews): Anchor {
  const founded = new Set(foundingIds)
  const counted = entries
    .filter(e => e.status === 'active' && e.published && e.datePublished !== null)
    .sort((a, b) => a.datePublished!.getTime() - b.datePublished!.getTime() || a.entryId.localeCompare(b.entryId))
  const left = counted.filter(e => founded.has(e.entryId))
  const standIns = left.length === 0
  const founding = (standIns ? counted.slice(0, options.anchorStandIns) : left).map(e => e.entryId)
  const turningPoints = counted.filter(e => e.role === 'turning_point' && !founding.includes(e.entryId)).map(e => e.entryId)
  return { founding, standIns, turningPoints }
}

/**
 * Whether a re-center still covers the anchor: every founding entry, and at least `anchorTurningShare`
 * of the turning points rounded up (so one or two misreads in a long overview do not block it; 1 or 2
 * turning points must all pass), each judged to belong by both calls (`belongs`). `failed` names every
 * anchor entry judged not to belong.
 */
export function anchorHolds(
  anchor: Anchor,
  belongs: (entryId: string) => boolean,
  options: RecenterOptions = config.overviews,
): { holds: boolean; failed: string[] } {
  const failed = [...anchor.founding, ...anchor.turningPoints].filter(id => !belongs(id))
  const needed = Math.ceil(anchor.turningPoints.length * options.anchorTurningShare - 1e-9)
  const passed = anchor.turningPoints.filter(belongs).length
  return { holds: anchor.founding.every(belongs) && passed >= needed, failed }
}

/** An overview as the fixed limits on an automated re-center read it. */
export interface RecenterState {
  scope: OverviewScope
  status: OverviewStatus
  frozen: boolean
  automatedRecenters: number
  recenteredAt: Date | null
  recenteredBy: string | null
}

/** Until when an editor's or an Undo's re-center keeps automation off (`editorRecenterLockDays`); null when neither made the last one. */
export function recenterLockedUntil(o: Pick<RecenterState, 'recenteredAt' | 'recenteredBy'>, options: RecenterOptions = config.overviews): Date | null {
  if (!o.recenteredAt || (o.recenteredBy !== 'editor' && o.recenteredBy !== 'undo')) return null
  return new Date(o.recenteredAt.getTime() + options.editorRecenterLockDays * DAY_MS)
}

/**
 * Why automation may not re-center the overview at `now` (the wall clock an editor acts on), or null
 * when it may: only an ongoing overview, open or quiet and not frozen (a forming one is not
 * re-centered by automation); fewer than `maxAutomatedRecenters` applied automated re-centers (after
 * that only an editor re-centers it); and no editor's or Undo's re-center within
 * `editorRecenterLockDays`.
 */
export function automatedRecenterBlocked(
  o: RecenterState,
  now: Date,
  options: RecenterOptions = config.overviews,
): 'scope' | 'status' | 'frozen' | 'limit' | 'locked' | null {
  if (o.scope !== 'ongoing') return 'scope'
  if (o.status !== 'open' && o.status !== 'quiet') return 'status'
  if (o.frozen) return 'frozen'
  if (o.automatedRecenters >= options.maxAutomatedRecenters) return 'limit'
  const until = recenterLockedUntil(o, options)
  return until && now.getTime() < until.getTime() ? 'locked' : null
}
