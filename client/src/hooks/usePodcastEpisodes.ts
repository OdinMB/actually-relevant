import { useQuery } from '@tanstack/react-query'
import { publicApi } from '../lib/api'

/** The public podcast: show information (feed URL, listen links) and published episodes. */
export function usePodcastEpisodes() {
  return useQuery({
    queryKey: ['public-podcast'],
    queryFn: () => publicApi.podcast(),
    staleTime: 5 * 60 * 1000,
  })
}
