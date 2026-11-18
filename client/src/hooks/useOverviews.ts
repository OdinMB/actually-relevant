import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OverviewActionResult, OverviewsAdminState, OverviewScope, OverviewStatus } from '@shared/types'
import { adminApi, ApiError } from '../lib/admin-api'
import { useToast } from '../components/ui/Toast'

/*
 * Ongoing-story overviews in the admin (`.context/overviews.md`, "Admin"): whether the admin shows
 * them, the list, one overview, a story's Overview block, and the editor's actions and Undo. Every
 * action is the editor's logged decision; the server refuses one that would change nothing or whose
 * rows changed since, with the reason, which the toast shows. Each action re-reads every overview
 * query, since one action can move an entry between an overview's page and a story's block.
 */

const KEY = ['overviews'] as const
const STATE_KEY = ['overviews', 'state'] as const

export interface OverviewFilters {
  scope?: OverviewScope
  status?: OverviewStatus
  frozen?: boolean
  hidden?: boolean
}

/** The admin shows its overview pages and buttons while the step is on or any overview exists (as the research pass's admin). */
export const overviewsShown = (state: OverviewsAdminState | null | undefined): boolean => !!state && (state.on || state.count > 0)

/** Null for a 404: a backend without overviews, so what reads it hides itself. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Whether the step is on and how many overviews exist. */
export function useOverviewsState() {
  return useQuery({ queryKey: STATE_KEY, queryFn: () => orNull(() => adminApi.overviews.state()), staleTime: 60_000 })
}

export function useOverviewList(filters: OverviewFilters) {
  return useQuery({ queryKey: ['overviews', 'list', filters], queryFn: () => adminApi.overviews.list(filters) })
}

export function useOverview(id: string) {
  return useQuery({ queryKey: ['overviews', 'detail', id], queryFn: () => adminApi.overviews.get(id), enabled: !!id })
}

/** A story's Overview block; null against a backend without overviews. */
export function useStoryOverview(storyId: string) {
  return useQuery({ queryKey: ['overviews', 'story', storyId], queryFn: () => orNull(() => adminApi.overviews.story(storyId)) })
}

export interface OverviewAction {
  run: () => Promise<OverviewActionResult>
  /** The success toast, in the editor's words. */
  done: string
}

/** Runs one editor action or Undo, toasts what it did or the server's reason, and re-reads every overview query. */
export function useOverviewAction() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (action: OverviewAction) => action.run(),
    onSuccess: (_result, action) => toast('success', action.done),
    onError: err => toast('error', err instanceof Error ? err.message : 'The action failed'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
