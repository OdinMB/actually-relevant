import type { NewsletterEdition } from '@shared/types'

/** Which issues `/newsletter` lists: both editions', or only Actually Uplifting's. */
export type ArchiveFilter = 'all' | 'uplifting'

/** The query parameter that keeps the filter, e.g. `/newsletter?edition=uplifting`. */
export const ARCHIVE_FILTER_PARAM = 'edition'

/**
 * The filter a `?edition=` value names; with none (or one it doesn't know), the list opens on
 * Actually Uplifting inside that edition and on all issues elsewhere.
 */
export function archiveFilterOf(raw: string | null, inUpliftingEdition: boolean): ArchiveFilter {
  if (raw === 'all' || raw === 'uplifting') return raw
  return inUpliftingEdition ? 'uplifting' : 'all'
}

/** `params` with the filter set; the other parameters (the dial's `mix`) are kept. */
export function withArchiveFilter(params: URLSearchParams, filter: ArchiveFilter): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set(ARCHIVE_FILTER_PARAM, filter)
  return next
}

/** The edition the archive request asks for: none for all issues. */
export function archiveEdition(filter: ArchiveFilter): NewsletterEdition | undefined {
  return filter === 'uplifting' ? 'uplifting' : undefined
}
