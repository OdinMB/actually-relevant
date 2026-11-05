import { useQuery } from '@tanstack/react-query'
import { publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'

/**
 * The public podcast: show information (feed URL, listen links) and published episodes. Never asked
 * for while prerendering, so the static /podcast page keeps no dated episode list.
 */
export function usePodcastEpisodes() {
  return useQuery({
    queryKey: ['public-podcast'],
    queryFn: () => publicApi.podcast(),
    staleTime: 5 * 60 * 1000,
    enabled: !isPrerendering(),
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
