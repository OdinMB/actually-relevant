import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PassUsage, TaskState } from '@shared/types'

const mockPasses = vi.hoisted(() => ({ usage: vi.fn(), story: vi.fn(), start: vi.fn(), startBulk: vi.fn(), undo: vi.fn() }))
const launchPolledTask = vi.hoisted(() => vi.fn())
vi.mock('../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/admin-api')>()),
  adminApi: { researchPasses: mockPasses },
}))
vi.mock('./useBackgroundTasks', () => ({ useBackgroundTasks: () => ({ launchPolledTask, processingIds: new Set<string>() }) }))

import { ApiError } from '../lib/admin-api'
import { passOutcome, passRefusal, useBulkPass, usePasses, useUndoUpdate } from './useResearchPass'

const task = (over: Partial<TaskState> = {}): TaskState => ({
  id: 't',
  type: 'research',
  status: 'completed',
  total: 1,
  completed: 1,
  failed: 0,
  errors: [],
  storyIds: ['s1'],
  createdAt: '',
  ...over,
})

const usage = (over: Partial<PassUsage> = {}): PassUsage => ({
  spentUsd: 1,
  capUsd: 30,
  firstPassUsd: 0.4,
  laterPassUsd: 0.25,
  refusal: null,
  on: true,
  ...over,
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return { wrapper, keys: () => invalidated.mock.calls.map(([filters]) => filters?.queryKey) }
}

beforeEach(() => vi.clearAllMocks())

describe('passOutcome', () => {
  it('gives the reason a pass was skipped or failed, kept until dismissed, and a plain line when it ran', () => {
    expect(passOutcome(task({ skipped: [{ storyId: 's1', reason: 'a pass is running' }] }))).toEqual({
      message: 'Researching again: skipped, a pass is running',
      sticky: true,
    })
    expect(passOutcome(task({ failed: 1, errors: ['the model timed out'] }))).toEqual({ message: 'Researching again: the model timed out', sticky: true })
    expect(passOutcome(task({ failed: 1 }))).toEqual({ message: 'Researching again: the pass failed', sticky: true })
    expect(passOutcome(task())).toEqual({ message: 'Researched again: the Research tab shows what the pass found and changed.', sticky: false })
  })
})

describe('passRefusal', () => {
  it('refuses with the server’s reason first, then the status, then a pass in progress', () => {
    expect(passRefusal({ status: 'published' }, usage({ refusal: 'At the cap' }), false)).toBe('At the cap')
    expect(passRefusal({ status: 'rejected' }, usage(), false)).toBe('Only analyzed, selected or published stories can be researched; this one is rejected')
    expect(passRefusal({ status: 'selected' }, usage(), true)).toBe('A research pass of this story is in progress')
    expect(passRefusal({ status: 'analyzed' }, usage(), false)).toBeNull()
  })
})

describe('usePasses', () => {
  it('reads a 404 as no passes, and passes any other error on', async () => {
    const { wrapper } = setup()
    mockPasses.story.mockRejectedValueOnce(new ApiError(404, 'Not found'))
    const missing = renderHook(() => usePasses('s1'), { wrapper })
    await waitFor(() => expect(missing.result.current.isSuccess).toBe(true))
    expect(missing.result.current.data).toBeNull()

    mockPasses.story.mockRejectedValueOnce(new ApiError(500, 'Boom'))
    const failing = renderHook(() => usePasses('s2'), { wrapper })
    await waitFor(() => expect(failing.result.current.isError).toBe(true))
  })
})

describe('useUndoUpdate', () => {
  it('re-reads the story, its passes, the usage and its cards once the update is undone', async () => {
    const { wrapper, keys } = setup()
    mockPasses.undo.mockResolvedValue(undefined)
    const { result } = renderHook(() => useUndoUpdate('s1'), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(mockPasses.undo).toHaveBeenCalledWith('s1')
    expect(keys()).toEqual(
      expect.arrayContaining([['research-passes', 's1'], ['research-pass-usage'], ['story-context-admin', 's1'], ['story-context'], ['story']]),
    )
  })
})

describe('useBulkPass', () => {
  it('starts one polled task over the chosen stories, re-reads every story’s passes, and names skipped stories in the outcome', async () => {
    const { wrapper, keys } = setup()
    mockPasses.startBulk.mockResolvedValue({ taskId: 'task-1' })
    const { result } = renderHook(() => useBulkPass(), { wrapper })
    const chosen = [
      { id: 's1', title: 'One' },
      { id: 's2', title: 'Two' },
    ]
    act(() => result.current(chosen))
    const launched = launchPolledTask.mock.calls[0]![0]
    expect(launched).toMatchObject({ label: 'Researching 2 stories again', storyIds: ['s1', 's2'] })
    await expect(launched.submitFn()).resolves.toEqual({ taskId: 'task-1' })
    expect(mockPasses.startBulk).toHaveBeenCalledWith(['s1', 's2'])
    expect(keys()).toEqual(expect.arrayContaining([['research-passes'], ['story-context-admin']]))
    const outcome = launched.outcome(task({ total: 2, completed: 1, skipped: [{ storyId: 's2', reason: 'at the cap' }] }))
    expect(outcome.message).toMatch(/^Researching 2 stories again: 1 researched, 1 skipped\./)
    expect(outcome.message).toMatch(/Two.*at the cap/)

    act(() => result.current([{ id: 's3', title: 'Three' }]))
    expect(launchPolledTask.mock.calls[1]![0]).toMatchObject({ label: 'Researching 1 story again' })
  })
})
