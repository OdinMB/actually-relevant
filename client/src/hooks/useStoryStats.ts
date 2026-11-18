import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../lib/admin-api'

/** The dashboard's last 7 and 30 days: stories crawled, screened, assessed and published. */
export function useRecentStoryStats() {
  return useQuery({
    // The key every story change invalidates (`invalidateStoryQueries`)
    queryKey: ['storyStats'],
    queryFn: () => adminApi.stories.recentStats(),
  })
}

export function useLifetimeStoryStats() {
  return useQuery({
    queryKey: ['lifetimeStoryStats'],
    queryFn: () => adminApi.stories.lifetimeStats(),
  })
}
