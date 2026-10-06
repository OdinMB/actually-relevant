import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../lib/admin-api'
import type { Podcast, PodcastMode, PodcastScriptEdit } from '@shared/types'
import { usePodcastProgress } from './usePodcastProgress'

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

/** Put a changed episode into the cache and refresh the list. */
function useStoreEpisode() {
  const queryClient = useQueryClient()
  return (podcast: Podcast) => {
    queryClient.setQueryData(['podcast', podcast.id], podcast)
    queryClient.invalidateQueries({ queryKey: ['podcasts'] })
  }
}

/**
 * For calls that start background work (202): the server claimed the lease before answering, so
 * the stored episode is already in progress; the progress provider follows it from here on.
 */
function useStoreStartedEpisode() {
  const store = useStoreEpisode()
  const { track } = usePodcastProgress()
  return (podcast: Podcast) => {
    store(podcast)
    track(podcast.id)
  }
}

export function useUpdatePodcast() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; humanEdited?: boolean } }) =>
      adminApi.podcasts.update(id, data),
    onSuccess: store,
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

/** Finds or creates this week's episode (starts nothing). */
export function useStartWeeklyPodcast() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: () => adminApi.podcasts.startWeekly(),
    onSuccess: store,
  })
}

/** Start in a mode, approve a review stop, finish automatically, or resume after a failure. */
export function useResumePodcast() {
  const started = useStoreStartedEpisode()
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode?: PodcastMode }) => adminApi.podcasts.resume(id, mode),
    onSuccess: started,
  })
}

export interface RewindRequest {
  id: string
  to: 'created' | 'selected' | 'scripted'
  advance: boolean
}

/** Go back to an earlier stage; with `advance` the episode continues in the background. */
export function useRewindPodcast() {
  const store = useStoreEpisode()
  const started = useStoreStartedEpisode()
  return useMutation({
    mutationFn: ({ id, to, advance }: RewindRequest) => adminApi.podcasts.rewind(id, to, advance),
    onSuccess: (podcast, { advance }) => (advance ? started(podcast) : store(podcast)),
  })
}

/** The week's story pool for the picker (only fetched while the picker is shown). */
export function usePodcastStoryPool(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['podcast-story-pool', id],
    queryFn: () => adminApi.podcasts.storyPool(id),
    enabled,
  })
}

export function useSavePodcastStories() {
  const store = useStoreEpisode()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, storyIds }: { id: string; storyIds: string[] }) => adminApi.podcasts.saveStories(id, storyIds),
    onSuccess: podcast => {
      store(podcast)
      queryClient.invalidateQueries({ queryKey: ['podcast-story-pool', podcast.id] })
    },
  })
}

/** Saves a script edit; a 422 rejects with an `ApiError` whose body carries `errors` and `warnings`. */
export function useSavePodcastScript() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: ({ id, edit }: { id: string; edit: PodcastScriptEdit }) => adminApi.podcasts.saveScript(id, edit),
    onSuccess: ({ podcast }) => store(podcast),
  })
}

/** Publish (list in the feed and on /podcast) or unpublish an episode. */
export function usePublishPodcast() {
  const store = useStoreEpisode()
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      publish ? adminApi.podcasts.publish(id) : adminApi.podcasts.unpublish(id),
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
