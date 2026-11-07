/** How a published podcast episode and its show are addressed and its facts are written on the public site. */
import type { PodcastEdition } from '@shared/types'

/** The episode's transcript page. The id is the feed GUID and never changes once published. */
export function podcastTranscriptPath(id: string): string {
  return `/podcast/${encodeURIComponent(id)}/transcript`
}

/**
 * Each show's name, page and public feed path (a Render rewrite to the API's feed route,
 * .context/seo.md): Actually Relevant at /podcast, Actually Uplifting at /podcast/uplifting.
 */
export const PODCAST_SHOWS: Record<PodcastEdition, { name: string; path: string; feedPath: string }> = {
  full: { name: 'Actually Relevant', path: '/podcast', feedPath: '/podcast.xml' },
  uplifting: { name: 'Actually Uplifting', path: '/podcast/uplifting', feedPath: '/podcast-uplifting.xml' },
}

/** The show page's Subscribe section, by its heading's id; the page scrolls to it on arrival. */
export function podcastSubscribePath(edition: PodcastEdition): string {
  return `${PODCAST_SHOWS[edition].path}#podcast-subscribe-heading`
}

/** /podcast's Subscribe section. */
export const PODCAST_SUBSCRIBE_PATH = podcastSubscribePath('full')

/** "6:12"; null when the duration is not known. */
export function formatEpisodeDuration(sec: number | null): string | null {
  if (sec == null) return null
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** "October 12, 2026", in UTC so it matches the feed's date. */
export function formatEpisodeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
