import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePodcastEpisodes } from './usePodcastEpisodes'
import { ApiError } from '../lib/api'

const mockApi = vi.hoisted(() => ({ podcast: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

function renderEpisodes() {
  // The app's own retry count, with no delay, so the hook's retry rule is what the test sees
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return renderHook(() => usePodcastEpisodes('uplifting'), { wrapper })
}

beforeEach(() => {
  mockApi.podcast.mockReset()
})

describe('usePodcastEpisodes', () => {
  it('fails at once on a 404 (a closed show), so the page shows Page not found without a retry', async () => {
    mockApi.podcast.mockRejectedValue(new ApiError(404, 'Not found'))
    const { result } = renderEpisodes()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockApi.podcast).toHaveBeenCalledOnce()
  })

  it('retries any other failure once', async () => {
    mockApi.podcast.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    const { result } = renderEpisodes()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockApi.podcast).toHaveBeenCalledTimes(2)
  })
})
