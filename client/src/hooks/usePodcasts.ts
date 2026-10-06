import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../lib/admin-api'
import type { Podcast } from '@shared/types'

/** How often an episode is re-read while a process works on it. */
export const PODCAST_POLL_MS = 5000

export function usePodcasts(params?: { status?: string }) {
  return useQuery({
    queryKey: ['podcasts', params],
    queryFn: () => adminApi.podcasts.list(params),
  })
}

/** Re-read only while a process works on the episode. */
export function podcastRefetchInterval(podcast: Podcast | undefined): number | false {
  return podcast?.inProgress ? PODCAST_POLL_MS : false
}

/** Polls only while the episode is in progress, so the stage and errors appear without a reload. */
export function usePodcast(id: string) {
  return useQuery({
    queryKey: ['podcast', id],
    queryFn: () => adminApi.podcasts.get(id),
    enabled: !!id,
    refetchInterval: query => podcastRefetchInterval(query.state.data),
  })
}

function useStoreEpisode() {
  const queryClient = useQueryClient()
  return (podcast: Podcast) => {
    // The background run takes the lease a moment after the 202; show it as in progress so polling starts.
    queryClient.setQueryData(['podcast', podcast.id], { ...podcast, inProgress: true })
    queryClient.invalidateQueries({ queryKey: ['podcasts'] })
  }
}

export function useUpdatePodcast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title: string } }) =>
      adminApi.podcasts.update(id, data),
    onSuccess: (podcast) => {
      queryClient.setQueryData(['podcast', podcast.id], podcast)
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
    },
  })
}

export function useDeletePodcast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => adminApi.podcasts.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
    },
  })
}

export function useStartWeeklyPodcast() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: () => adminApi.podcasts.startWeekly(),
    onSuccess: store,
  })
}

export function useResumePodcast() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: (id: string) => adminApi.podcasts.resume(id),
    onSuccess: store,
  })
}

export function useRegeneratePodcast() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: (id: string) => adminApi.podcasts.regenerate(id),
    onSuccess: store,
  })
}

/** TTS characters this month against the cap. */
export function usePodcastUsage() {
  return useQuery({
    queryKey: ['podcast-usage'],
    queryFn: () => adminApi.podcasts.usage(),
  })
}
