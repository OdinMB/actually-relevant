import type { PodcastListItem } from '@shared/types'

/**
 * Ever published: listed now, or listed once and taken down since. Such an episode keeps its audio
 * and feed GUID for good, so it is never regenerated, re-edited or deleted (the server refuses
 * with 409; this hides the buttons). Mirrors `wasPublished` in `server/src/services/podcastGuards.ts`.
 */
export function wasPublished(podcast: Pick<PodcastListItem, 'stage' | 'status' | 'publishedAt'>): boolean {
  if (podcast.stage === 'legacy') return false
  return podcast.publishedAt != null || podcast.status === 'published'
}
