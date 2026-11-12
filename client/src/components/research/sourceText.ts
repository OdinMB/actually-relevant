import type { ResearchedSource } from '@shared/types'

/**
 * How a researched story's sources read (`.context/public-website.md`, "Researched stories"): the
 * date, the details line and the outlet's initial. News reports, the usual kind, carry no kind name.
 */

/** What our own earlier stories are called in the sources list and the citation cards. */
export const EARLIER_LABEL = 'Earlier on Actually Relevant'

const KIND_NAMES: Partial<Record<NonNullable<ResearchedSource['kind']>, string>> = {
  analysis: 'analysis',
  opinion: 'opinion',
  'press-release': 'press release',
  'official-body': 'official body',
}

/** "Nov 12, 2026", or "Mar 2026" for our earlier stories; null when the source has no readable date. */
export function sourceDate(source: Pick<ResearchedSource, 'date' | 'origin'>): string | null {
  if (!source.date) return null
  const date = new Date(source.date)
  if (Number.isNaN(date.getTime())) return null
  const parts: Intl.DateTimeFormatOptions =
    source.origin === 'earlier' ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  return date.toLocaleDateString('en-US', { ...parts, timeZone: 'UTC' })
}

/** The parts of a source's details line that it has: country, kind, date. */
export function sourceDetails(source: ResearchedSource): string[] {
  const kind = source.kind ? KIND_NAMES[source.kind] : undefined
  return [source.country, kind, sourceDate(source)].filter((part): part is string => Boolean(part))
}

/** The outlet's first letter, for a source without a stored favicon. */
export function initialOf(outlet: string): string {
  return outlet.trim().charAt(0).toUpperCase() || '?'
}
