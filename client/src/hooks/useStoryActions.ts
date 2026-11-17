import { useQueryClient } from '@tanstack/react-query'
import type { StoryStatus } from '@shared/types'
import { adminApi } from '../lib/admin-api'
import { useToast } from '../components/ui/Toast'
import { useBackgroundTasks } from './useBackgroundTasks'
import { invalidateStoryQueries, useUpdateStoryStatus } from './useStories'

/**
 * One story's actions as the stories list's rows run them and the story's page reuses them:
 * pre-assess, assess and publish as background tasks with a progress toast, the story counted as
 * processing until each ends and the story queries re-read after it; a status move (reject, trash)
 * as a mutation with its toast.
 */
export function useStoryActions() {
  const queryClient = useQueryClient()
  const { launchTask } = useBackgroundTasks()
  const { toast } = useToast()
  const updateStatus = useUpdateStoryStatus()

  const task = (kind: string, label: string, run: (id: string) => Promise<unknown>) => (id: string) =>
    launchTask({
      id: `${kind}-${id}-${Date.now()}`,
      label,
      executor: async () => {
        await run(id)
        return { succeeded: 1, failed: 0 }
      },
      onComplete: () => invalidateStoryQueries(queryClient),
      storyIds: [id],
    })

  const setStatus = (id: string, status: StoryStatus) =>
    updateStatus.mutate(
      { id, status },
      {
        onSuccess: () => toast('success', 'Status updated'),
        onError: () => toast('error', 'Failed to update status'),
      },
    )

  return {
    preassess: task('preassess', 'Pre-assessing story', id => adminApi.stories.preassess([id])),
    assess: task('assess', 'Assessing story', id => adminApi.stories.assess(id)),
    publish: task('publish', 'Publishing story', id => adminApi.stories.publish(id)),
    setStatus,
    /** A status move is under way. */
    changingStatus: updateStatus.isPending,
  }
}
