import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { StoryContextAdmin, TaskState } from '@shared/types'
import { adminApi, ApiError } from '../lib/admin-api'
import { useBackgroundTasks } from './useBackgroundTasks'

const contextKey = (storyId: string) => ['story-context-admin', storyId] as const

/** How often the view is read again while a context run of the story is running. */
export const CONTEXT_POLL_MS = 5000

/**
 * A story's context as the admin sees it (`.context/story-context.md`, "Admin"), read again while
 * its newest run is running. `null` when the backend answers 404 (an older backend, or a story gone
 * meanwhile), so the section stays hidden.
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
    refetchInterval: query => (query.state.data?.run?.status === 'running' ? CONTEXT_POLL_MS : false),
  })
}

/**
 * Whether the story page shows its Context section: once the story has a context run or can have one
 * gathered (`gather.eligible`: published, with research facts), or to say its context could not be
 * loaded. A backend without context answers 404, which the query reads as null.
 */
export function contextShown(query: { data: StoryContextAdmin | null | undefined; isError: boolean }): boolean {
  if (query.isError) return true
  return !!query.data && (!!query.data.run || !!query.data.gather?.eligible)
}

/** After a change, the admin's view and any cached story page's context are read again. */
function useRefresh(storyId: string) {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: contextKey(storyId) })
    void queryClient.invalidateQueries({ queryKey: ['story-context'] })
  }, [queryClient, storyId])
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

/** The finished task in the editor's words: the server's reason when the run failed, kept until dismissed. */
export function gatherOutcome(task: TaskState): { message: string; sticky: boolean } {
  if (task.failed > 0) return { message: `Gathering context: ${task.errors[0] ?? 'the run failed'}`, sticky: true }
  return { message: 'Context gathered: the Context section shows what the run kept.', sticky: false }
}

/**
 * "Gather context" (`.context/story-context.md`, "On demand"): an editor's context run of the story
 * as a polled background task, with its progress toast; a refusal (409) or a failed run ends in an
 * error toast with the reason. The view and any cached story page are read again once it has started
 * and when it ends. `running` while its task runs in this tab.
 */
export function useGatherContext(storyId: string) {
  const { launchPolledTask, tasks } = useBackgroundTasks()
  const refresh = useRefresh(storyId)
  const prefix = `context-${storyId}-`

  const start = useCallback(() => {
    launchPolledTask({
      id: `${prefix}${Date.now()}`,
      label: 'Gathering context',
      submitFn: async () => {
        const started = await adminApi.storyContext.gather(storyId)
        refresh()
        return started
      },
      outcome: gatherOutcome,
      onComplete: refresh,
    })
  }, [launchPolledTask, prefix, refresh, storyId])

  return { start, running: tasks.some(t => t.id.startsWith(prefix) && t.status === 'running') }
}

/**
 * The story page's Gather context action, while its Context section shows (`contextShown`) and the
 * backend offers gathering: "Gather context", or "Gather more context" once the story has a run;
 * closed with the server's refusal, or while a run of the story is under way (this tab's task, or
 * the newest run `running`).
 */
export function useGatherAction(storyId: string): { label: string; reason: string | null; start: () => void } | null {
  const query = useStoryContextAdmin(storyId)
  const { start, running } = useGatherContext(storyId)
  const view = query.data
  if (!view?.gather || !contextShown(query)) return null
  const busy = running || view.run?.status === 'running'
  return {
    label: view.run ? 'Gather more context' : 'Gather context',
    reason: busy ? 'Context is being gathered for this story now' : view.gather.refusal,
    start,
  }
}
