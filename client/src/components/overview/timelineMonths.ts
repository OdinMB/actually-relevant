import type { PublicOverviewEntry } from '@shared/types'

/*
 * An ongoing story's timeline as the page lays it out (`.context/public-website.md`, "Ongoing
 * stories"): its stories grouped by month, newest first. In each month the turning points show, and
 * the routine stories fold under "+ N stories"; a month without a turning point shows its newest
 * story and folds the rest. A fold of a single story is no fold: it shows. "Turning points" keeps
 * only the turning points, and only the months that have one.
 */

export type TimelineFilter = 'all' | 'turning'

export interface TimelineMonth {
  /** `YYYY-MM` (UTC), the month's key and its folds' id. */
  key: string
  /** "November 2026". */
  label: string
  /** What shows while the month's fold is closed, newest first. */
  shown: PublicOverviewEntry[]
  /** The routine stories under "+ N stories", newest first; empty when nothing folds. */
  folded: PublicOverviewEntry[]
  /** Every story of the month the filter keeps, newest first: what shows once the fold is open. */
  all: PublicOverviewEntry[]
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const monthKey = (iso: string): string => iso.slice(0, 7)

/** Whether the "Turning points" filter has anything to keep: at least one turning point and one routine story. */
export function offersFilter(entries: readonly PublicOverviewEntry[]): boolean {
  return entries.some(e => e.role === 'turning_point') && entries.some(e => e.role === 'routine')
}

/** The months of the timeline, newest first; `entries` come newest first, as the API serves them. */
export function timelineMonths(entries: readonly PublicOverviewEntry[], filter: TimelineFilter = 'all'): TimelineMonth[] {
  const months = new Map<string, PublicOverviewEntry[]>()
  for (const entry of entries) {
    const key = monthKey(entry.datePublished)
    months.set(key, [...(months.get(key) ?? []), entry])
  }
  return [...months]
    .sort(([a], [b]) => b.localeCompare(a))
    .flatMap(([key, items]): TimelineMonth[] => {
      const label = MONTH_LABEL.format(new Date(`${key}-01T00:00:00Z`))
      const turning = items.filter(e => e.role === 'turning_point')
      if (filter === 'turning') return turning.length > 0 ? [{ key, label, shown: turning, folded: [], all: turning }] : []
      const kept = turning.length > 0 ? new Set(turning) : new Set(items.slice(0, 1))
      const folded = items.filter(e => !kept.has(e))
      if (folded.length <= 1) return [{ key, label, shown: items, folded: [], all: items }]
      return [{ key, label, shown: items.filter(e => kept.has(e)), folded, all: items }]
    })
}
