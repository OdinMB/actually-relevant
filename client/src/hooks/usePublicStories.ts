import { useQuery } from '@tanstack/react-query'
import { publicApi } from '../lib/api'

type StoryListParams = { page?: number; pageSize?: number; issueSlug?: string; search?: string; emotionTags?: string }

export function usePublicStories(params?: StoryListParams) {
  return useQuery({
    queryKey: ['public-stories', params],
    queryFn: () => publicApi.stories.list(params),
  })
}

/**
 * One page of an issue's stories. While another page or mood of the same issue loads, the page on
 * screen stays; another issue's stories never stand in for this one's.
 */
export function useIssueStories(params: StoryListParams) {
  return useQuery({
    queryKey: ['public-stories', params] as const,
    queryFn: () => publicApi.stories.list(params),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1].issueSlug === params.issueSlug ? previous : undefined),
  })
}

export function usePublicStory(slug: string) {
  return useQuery({
    queryKey: ['public-story', slug],
    queryFn: () => publicApi.stories.get(slug),
    enabled: !!slug,
  })
}

export function useRelatedStories(slug: string | undefined) {
  return useQuery({
    queryKey: ['related-stories', slug],
    queryFn: () => publicApi.stories.related(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  })
}

export function useClusterMembers(slug: string | undefined) {
  return useQuery({
    queryKey: ['cluster-members', slug],
    queryFn: () => publicApi.stories.cluster(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}
