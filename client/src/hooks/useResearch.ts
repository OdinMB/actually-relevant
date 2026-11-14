import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ResearchRun } from '@shared/types'
import { adminApi, ApiError } from '../lib/admin-api'
import { bulkResearchOutcome, type BulkResearchStory } from '../components/admin/bulkResearch'
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
