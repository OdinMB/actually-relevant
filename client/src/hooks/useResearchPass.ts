import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { PassUsage, Story, StoryPasses, TaskState } from '@shared/types'
import { adminApi, ApiError } from '../lib/admin-api'
import { bulkPassOutcome, type BulkResearchStory } from '../components/admin/bulkResearch'
import { useBackgroundTasks } from './useBackgroundTasks'
import { invalidateStoryQueries } from './useStories'

/*
 * Research passes in the admin (`.context/research-passes.md`, "Admin routes"): the month's usage
 * and whether the step is on, a story's passes, versions and pool, "Research again" for one story
 * or a bulk of them, and "Undo this update". A pass applies its own result, so every action that
 * starts one or undoes an update re-reads the story queries when it ends. While the step is off
 * (`PassUsage.on`), nothing here offers an action.
 */

/** How often a story's passes are re-read while one of them is running. */
export const PASS_POLL_MS = 5000

const USAGE_KEY = ['research-pass-usage'] as const
const passesKey = (storyId: string) => ['research-passes', storyId] as const

/** Null for a 404: a backend without passes (or a story gone meanwhile), so what reads it hides itself. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** This month's spend under the cap, why no pass can start now, and whether the step is on. */
export function usePassUsage() {
  return useQuery({ queryKey: USAGE_KEY, queryFn: () => orNull(() => adminApi.researchPasses.usage()) })
}

const anyRunning = (view: StoryPasses | null | undefined) => view?.passes.some(p => p.status === 'running') ?? false

/** The story's passes, versions, pool and legacy runs; re-read while a pass of it is running. */
export function usePasses(storyId: string, enabled = true) {
  return useQuery({
    queryKey: passesKey(storyId),
    queryFn: () => orNull(() => adminApi.researchPasses.story(storyId)),
    enabled,
    refetchInterval: query => (anyRunning(query.state.data) ? PASS_POLL_MS : false),
  })
}

/** After a pass or an undo: the story's passes, the month's spend, the story itself and its cards. */
function refreshAfterPass(queryClient: QueryClient, storyId?: string) {
  void queryClient.invalidateQueries({ queryKey: storyId ? passesKey(storyId) : ['research-passes'] })
  void queryClient.invalidateQueries({ queryKey: USAGE_KEY })
  void queryClient.invalidateQueries({ queryKey: storyId ? ['story-context-admin', storyId] : ['story-context-admin'] })
  void queryClient.invalidateQueries({ queryKey: ['story-context'] })
  invalidateStoryQueries(queryClient)
}

/** The finished pass in the editor's words: the server's reason when it failed or was skipped, kept until dismissed. */
export function passOutcome(task: TaskState): { message: string; sticky: boolean } {
  const skipped = task.skipped?.[0]
  if (skipped) return { message: `Researching again: skipped, ${skipped.reason}`, sticky: true }
  if (task.failed > 0) return { message: `Researching again: ${task.errors[0] ?? 'the pass failed'}`, sticky: true }
  return { message: 'Researched again: the Research tab shows what the pass found and changed.', sticky: false }
}

/** "Research again" as a polled background task; the story counts as processing until it ends. */
export function useStartPass(storyId: string) {
  const { launchPolledTask, processingIds } = useBackgroundTasks()
  const queryClient = useQueryClient()

  const start = useCallback(() => {
    const refresh = () => refreshAfterPass(queryClient, storyId)
    launchPolledTask({
      id: `research-pass-${storyId}-${Date.now()}`,
      label: 'Researching the story again',
      storyIds: [storyId],
      submitFn: async () => {
        const started = await adminApi.researchPasses.start(storyId)
        refresh()
        return started
      },
      outcome: passOutcome,
      onComplete: refresh,
    })
  }, [launchPolledTask, queryClient, storyId])

  return { start, running: processingIds.has(storyId) }
}

/** The statuses a pass may start from (server: `RESEARCHABLE_STATUSES`, as research's). */
const RESEARCHABLE: readonly string[] = ['analyzed', 'selected', 'published']

/** Why a pass of the story cannot start now, or null when it may. */
export function passRefusal(story: Pick<Story, 'status'>, usage: PassUsage, inProgress: boolean): string | null {
  if (usage.refusal) return usage.refusal
  if (!RESEARCHABLE.includes(story.status)) return `Only analyzed, selected or published stories can be researched; this one is ${story.status}`
  if (inProgress) return 'A research pass of this story is in progress'
  return null
}

/**
 * The story page's "Research again": null while the usage loads, against a backend without passes,
 * and while the step is off (the bar then offers Research and Gather context as before); else why a
 * pass cannot start now (`passRefusal`; "in progress" from this tab's task or a `running` pass) and
 * `start`.
 */
export function usePassAction(story: Pick<Story, 'id' | 'status'>): { reason: string | null; start: () => void } | null {
  const usage = usePassUsage()
  const on = usage.data?.on === true
  const passes = usePasses(story.id, on)
  const { start, running } = useStartPass(story.id)
  if (!on || !usage.data) return null
  return { reason: passRefusal(story, usage.data, running || anyRunning(passes.data)), start }
}

/** "Undo this update": the version before goes back on the story, and its Update leaves the page. */
export function useUndoUpdate(storyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => adminApi.researchPasses.undo(storyId),
    onSuccess: () => refreshAfterPass(queryClient, storyId),
  })
}

/**
 * The stories list's bulk "Research again": a pass of each chosen story as one polled background
 * task, counted as processing until it ends, whose outcome names each skipped story with its reason
 * (`bulkPassOutcome`). The passes apply themselves, so the story queries are re-read when it ends.
 */
export function useBulkPass() {
  const { launchPolledTask } = useBackgroundTasks()
  const queryClient = useQueryClient()

  return useCallback(
    (chosen: BulkResearchStory[]) => {
      const storyIds = chosen.map(s => s.id)
      const label = `Researching ${storyIds.length} ${storyIds.length === 1 ? 'story' : 'stories'} again`
      const refresh = () => refreshAfterPass(queryClient)
      launchPolledTask({
        id: `research-pass-bulk-${Date.now()}`,
        label,
        storyIds,
        submitFn: async () => {
          const started = await adminApi.researchPasses.startBulk(storyIds)
          refresh()
          return started
        },
        outcome: task => bulkPassOutcome(label, task, chosen),
        onComplete: refresh,
      })
    },
    [launchPolledTask, queryClient],
  )
}
