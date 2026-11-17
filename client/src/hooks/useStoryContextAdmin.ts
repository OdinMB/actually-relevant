import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, ApiError } from '../lib/admin-api'

const contextKey = (storyId: string) => ['story-context-admin', storyId] as const

/**
 * A story's context as the admin sees it (`.context/story-context.md`, "Admin"). `null` when the
 * backend answers 404 (an older backend, or a story gone meanwhile), so the section stays hidden.
 */
export function useStoryContextAdmin(storyId: string) {
  return useQuery({
    queryKey: contextKey(storyId),
    queryFn: async () => {
      try {
        return await adminApi.storyContext.get(storyId)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
  })
}

/** After a change, the admin's view and any cached story page's context are read again. */
function useRefresh(storyId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: contextKey(storyId) })
    void queryClient.invalidateQueries({ queryKey: ['story-context'] })
  }
}

/** Hide every card of the story, or show the hidden ones again. */
export function useSetContextHidden(storyId: string) {
  const refresh = useRefresh(storyId)
  return useMutation({
    mutationFn: (hidden: boolean) => adminApi.storyContext.setHidden(storyId, hidden),
    onSuccess: refresh,
  })
}

/** Hide, show or move one card; a moved card keeps its place in every placement mode. */
export function useUpdateContextBox(storyId: string) {
  const refresh = useRefresh(storyId)
  return useMutation({
    mutationFn: ({ boxId, change }: { boxId: string; change: { hidden?: boolean; place?: string } }) => adminApi.storyContext.updateBox(storyId, boxId, change),
    onSuccess: refresh,
  })
}
