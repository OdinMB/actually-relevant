import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { adminApi } from '../lib/admin-api'
import type { Story, StoryFilters, StoryStatus } from '@shared/types'

/**
 * After anything that changes stories on the server (a task, a job, a bulk action):
 * the lists, the counts and every story's detail query (`['story', id]`, the edit
 * panel and page), so an open or reopened story shows the new data.
 */
export function invalidateStoryQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['stories'] })
  queryClient.invalidateQueries({ queryKey: ['story'] })
  queryClient.invalidateQueries({ queryKey: ['storyStats'] })
}

export function useStories(filters: StoryFilters) {
  return useQuery({
    queryKey: ['stories', filters],
    queryFn: () => adminApi.stories.list(filters),
  })
}

export function useStory(id: string) {
  return useQuery({
    queryKey: ['story', id],
    queryFn: () => adminApi.stories.get(id),
    enabled: !!id,
  })
}

export function useUpdateStory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Story> }) => adminApi.stories.update(id, data),
    onSuccess: story => {
      queryClient.setQueryData(['story', story.id], story)
      queryClient.invalidateQueries({ queryKey: ['stories'] })
    },
  })
}

export function useUpdateStoryStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: StoryStatus }) => adminApi.stories.updateStatus(id, status),
    onSuccess: story => {
      queryClient.setQueryData(['story', story.id], story)
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      queryClient.invalidateQueries({ queryKey: ['storyStats'] })
    },
  })
}

export function useBulkUpdateStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: StoryStatus }) => adminApi.stories.bulkStatus(ids, status),
    onSuccess: () => invalidateStoryQueries(queryClient),
  })
}

export function useDissolveCluster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => adminApi.stories.dissolveCluster(id),
    onSuccess: story => {
      queryClient.setQueryData(['story', story.id], story)
      queryClient.invalidateQueries({ queryKey: ['stories'] })
    },
  })
}

export function useDeleteStory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => adminApi.stories.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      queryClient.invalidateQueries({ queryKey: ['storyStats'] })
    },
  })
}

export function useCrawlUrl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ url, feedId }: { url: string; feedId: string }) => adminApi.stories.crawlUrl(url, feedId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] })
      queryClient.invalidateQueries({ queryKey: ['storyStats'] })
    },
  })
}
