import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ResearchRun, ResearchUsage, Story } from '@shared/types'
import { adminApi, ApiError } from '../lib/admin-api'
import { bulkApplyOutcome, bulkResearchOutcome, type BulkResearchStory } from '../components/admin/bulkResearch'
import { useToast } from '../components/ui/Toast'
import { useBackgroundTasks } from './useBackgroundTasks'
import { invalidateStoryQueries } from './useStories'

/** How often a story's runs are re-read while one of them is running. */
export const RESEARCH_POLL_MS = 5000

const USAGE_KEY = ['research-usage'] as const
const runsKey = (storyId: string) => ['research', storyId] as const

/**
 * This month's research spend and whether a run may start now. `null` from a backend without
 * research (it answers 404), so a new client deployed before the server hides the section.
 */
export function useResearchUsage() {
  return useQuery({
    queryKey: USAGE_KEY,
    queryFn: async () => {
      try {
        return await adminApi.research.usage()
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
  })
}

const anyRunning = (runs: ResearchRun[] | undefined) => runs?.some(r => r.status === 'running') ?? false

/** The story's latest runs, newest first; re-read while one is running. */
export function useResearchRuns(storyId: string, enabled: boolean) {
  return useQuery({
    queryKey: runsKey(storyId),
    queryFn: () => adminApi.research.runs(storyId),
    enabled,
    refetchInterval: query => (anyRunning(query.state.data) ? RESEARCH_POLL_MS : false),
  })
}

/**
 * Start a run of the story as a polled background task; the story counts as processing until it
 * ends. Its runs and the month's spend are re-read once it has started and again when it ends.
 */
export function useStartResearch(storyId: string) {
  const { launchPolledTask, processingIds } = useBackgroundTasks()
  const queryClient = useQueryClient()

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: runsKey(storyId) })
    void queryClient.invalidateQueries({ queryKey: USAGE_KEY })
  }, [queryClient, storyId])

  const start = useCallback(() => {
    launchPolledTask({
      id: `research-${storyId}-${Date.now()}`,
      label: 'Researching the story',
      storyIds: [storyId],
      submitFn: async () => {
        const started = await adminApi.research.start(storyId)
        refresh()
        return started
      },
      onComplete: refresh,
    })
  }, [launchPolledTask, refresh, storyId])

  return { start, running: processingIds.has(storyId) }
}

/** The statuses a run may start from (server: `RESEARCHABLE_STATUSES` in services/researchInput.ts). */
const RESEARCHABLE: readonly string[] = ['analyzed', 'selected', 'published']

/** Why a run of the story cannot start now, or null when it may. */
export function researchRefusal(story: Pick<Story, 'status'>, usage: ResearchUsage | undefined, inProgress: boolean): string | null {
  if (!usage) return 'Research usage could not be loaded'
  if (usage.refusal) return usage.refusal
  if (!RESEARCHABLE.includes(story.status)) return `Only analyzed, selected or published stories can be researched; this one is ${story.status}`
  if (inProgress) return 'A research run of this story is in progress'
  return null
}

/**
 * The story page's Research action: null while the usage loads and against a backend without
 * research (the section hides itself then too), else why a run cannot start now (`researchRefusal`;
 * "in progress" from this tab's task or any `running` run) and `start`.
 */
export function useResearchAction(story: Pick<Story, 'id' | 'status'>): { reason: string | null; start: () => void } | null {
  const usage = useResearchUsage()
  const runs = useResearchRuns(story.id, usage.data != null)
  const { start, running } = useStartResearch(story.id)
  if (usage.isPending || usage.data === null) return null
  return { reason: researchRefusal(story, usage.data, running || anyRunning(runs.data)), start }
}

/**
 * The stories list's bulk Research: the chosen stories researched as one polled background task,
 * counted as processing until it ends, whose outcome names each skipped story with its reason
 * (`bulkResearchOutcome`). Every story's runs and the month's spend are re-read once it has started
 * and again when it ends; a run writes nothing to its story, so the story queries stay.
 */
export function useBulkResearch() {
  const { launchPolledTask } = useBackgroundTasks()
  const queryClient = useQueryClient()

  return useCallback(
    (chosen: BulkResearchStory[]) => {
      const storyIds = chosen.map(s => s.id)
      const label = `Researching ${storyIds.length} ${storyIds.length === 1 ? 'story' : 'stories'}`
      const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ['research'] })
        void queryClient.invalidateQueries({ queryKey: USAGE_KEY })
      }
      launchPolledTask({
        id: `research-bulk-${Date.now()}`,
        label,
        storyIds,
        submitFn: async () => {
          const started = await adminApi.research.startBulk(storyIds)
          refresh()
          return started
        },
        outcome: task => bulkResearchOutcome(label, task, chosen),
        onComplete: refresh,
      })
    },
    [launchPolledTask, queryClient],
  )
}

/**
 * The stories list's bulk "Use researched versions": each chosen story's newest run put on it in one
 * request, followed by a toast that becomes the outcome (`bulkApplyOutcome`), each story not applied
 * named with the reason. The applies rewrite the stories' text fields, so every story query is re-read.
 */
export function useBulkApplyResearch() {
  const queryClient = useQueryClient()
  const { addProgressToast, updateToast } = useToast()

  return useCallback(
    (chosen: BulkResearchStory[]) => {
      const id = `research-apply-${Date.now()}`
      const label = `Applying researched versions to ${chosen.length} ${chosen.length === 1 ? 'story' : 'stories'}`
      addProgressToast(id, `${label}...`)
      void adminApi.research
        .applyBulk(chosen.map(s => s.id))
        .then(({ outcomes }) => updateToast(id, bulkApplyOutcome(label, outcomes, chosen)))
        .catch((err: unknown) => updateToast(id, { type: 'error', message: `${label}: ${err instanceof Error ? err.message : 'Failed'}` }))
        .finally(() => invalidateStoryQueries(queryClient))
    },
    [addProgressToast, updateToast, queryClient],
  )
}

/** Put a run's researched version on the story. It rewrites the story's text fields, so every story query is re-read. */
export function useApplyResearch(storyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => adminApi.research.apply(storyId, runId),
    onSuccess: () => invalidateStoryQueries(queryClient),
  })
}

/** Give the story its single-source analysis back; every story query is re-read. */
export function useRevertResearch(storyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => adminApi.research.revert(storyId),
    onSuccess: () => invalidateStoryQueries(queryClient),
  })
}
