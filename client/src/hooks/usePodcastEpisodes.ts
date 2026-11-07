import { useQuery } from '@tanstack/react-query'
import type { PodcastEdition } from '@shared/types'
import { publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'

/**
 * A public podcast show (the main one by default): show information (feed URL, listen links) and
 * published episodes. Never asked for while prerendering, so the static /podcast page keeps no dated
 * episode list. Actually Uplifting answers 404 while it is switched off.
 */
export function usePodcastEpisodes(edition: PodcastEdition = 'full', options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['public-podcast', edition],
    queryFn: () => publicApi.podcast(edition),
    staleTime: 5 * 60 * 1000,
    enabled: !isPrerendering() && (options.enabled ?? true),
  })
}

/** One published episode with its readable transcript, for its transcript page. */
export function usePodcastEpisode(id: string) {
  return useQuery({
    queryKey: ['public-podcast-episode', id],
    queryFn: () => publicApi.podcastEpisode(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}
