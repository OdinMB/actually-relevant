/** How a published podcast episode is addressed and its facts are written on the public site. */

/** The episode's transcript page. The id is the feed GUID and never changes once published. */
export function podcastTranscriptPath(id: string): string {
  return `/podcast/${encodeURIComponent(id)}/transcript`
}

/** "6:12"; null when the duration is not known. */
export function formatEpisodeDuration(sec: number | null): string | null {
  if (sec == null) return null
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** "October 12, 2026", in UTC so it matches the feed's date. */
export function formatEpisodeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
