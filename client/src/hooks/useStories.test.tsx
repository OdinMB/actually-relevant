import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invalidateStoryQueries, useBulkUpdateStatus } from './useStories'

vi.mock('../lib/admin-api', () => ({
  adminApi: {
    stories: {
      bulkStatus: vi.fn().mockResolvedValue({ updated: 1 }),
    },
  },
}))

function invalidatedKeys(queryClient: QueryClient) {
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  return () => spy.mock.calls.map(([filters]) => filters?.queryKey)
}

describe('invalidateStoryQueries', () => {
  it('marks the story detail queries stale with the list and the stats', () => {
    const queryClient = new QueryClient()
    const keys = invalidatedKeys(queryClient)

    invalidateStoryQueries(queryClient)

    expect(keys()).toEqual(expect.arrayContaining([['stories'], ['story'], ['storyStats']]))
  })

  it('makes an open story panel refetch after a background assessment', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['story', 's1'], { id: 's1', summary: null })

    invalidateStoryQueries(queryClient)

    expect(queryClient.getQueryState(['story', 's1'])?.isInvalidated).toBe(true)
  })
})

describe('useBulkUpdateStatus', () => {
  it('invalidates the story detail queries', async () => {
    const queryClient = new QueryClient()
    const keys = invalidatedKeys(queryClient)
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useBulkUpdateStatus(), { wrapper })

    await act(() => result.current.mutateAsync({ ids: ['s1'], status: 'rejected' }))

    expect(keys()).toEqual(expect.arrayContaining([['story']]))
  })
})
