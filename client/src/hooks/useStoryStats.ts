import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../lib/admin-api'

export function useStoryStats() {
  return useQuery({
    queryKey: ['storyStats'],
    queryFn: () => adminApi.stories.stats(),
  })
}

export function useLifetimeStoryStats() {
  return useQuery({
    queryKey: ['lifetimeStoryStats'],
    queryFn: () => adminApi.stories.lifetimeStats(),
  })
}
