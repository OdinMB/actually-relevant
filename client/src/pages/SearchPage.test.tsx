import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { makeStory } from '../test/stories'

const mockApi = vi.hoisted(() => ({ stories: { list: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import SearchPage from './SearchPage'
import { ApiError } from '../lib/api'

const ONE_RESULT = {
  data: [makeStory({ id: 'story-1', slug: 'climate-report', title: 'Climate Change Report' })],
  total: 1,
  page: 1,
  pageSize: 12,
  totalPages: 1,
}
const NO_RESULTS = { data: [], total: 0, page: 1, pageSize: 12, totalPages: 0 }

function renderSearchPage(initialEntry = '/search?q=climate') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <QueryClientProvider client={queryClient}>
          <SearchPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const failure = () => screen.findByRole('heading', { level: 2, name: "The search results couldn't load" })
const GENERIC_HINT = 'The connection may have dropped, or the site is busy right now. Please try again.'
const RATE_LIMIT_HINT = 'Too many searches from this network right now. Please try again in a few minutes.'

describe('SearchPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApi.stories.list.mockResolvedValue(ONE_RESULT)
  })

  it('renders search results heading with query', async () => {
    renderSearchPage('/search?q=climate')
    expect(await screen.findByText(/climate/)).toBeTruthy()
  })

  it('shows prompt when no query provided', async () => {
    renderSearchPage('/search')
    expect(await screen.findByText('Enter a search term to find stories.')).toBeTruthy()
  })

  it('reports a failed search as an error, not as zero results', async () => {
    mockApi.stories.list.mockRejectedValueOnce(new Error('429'))
    renderSearchPage('/search?q=climate')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/No results found/)).toBeNull()
    expect(screen.queryByText(/\d+ results?$/)).toBeNull()
  })

  it.each([
    ['the server fails', new ApiError(500, 'Failed to fetch stories')],
    ['the connection drops', new TypeError('Failed to fetch')],
  ])('says the results could not load, under the search heading, when %s', async (_, error) => {
    mockApi.stories.list.mockRejectedValue(error)
    renderSearchPage('/search?q=climate')

    const heading = await failure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.getByRole('alert')).toHaveTextContent(GENERIC_HINT)
    expect(screen.getByRole('heading', { level: 1, name: 'Search results for “climate”' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says to wait a few minutes when too many searches were made', async () => {
    mockApi.stories.list.mockRejectedValue(new ApiError(429, 'Too many search requests. Please try again later.'))
    renderSearchPage('/search?q=climate')

    const heading = await failure()
    const alert = screen.getByRole('alert')
    expect(alert).toContainElement(heading)
    expect(alert).toHaveTextContent(RATE_LIMIT_HINT)
    expect(alert).not.toHaveTextContent(GENERIC_HINT)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps saying to wait while "Try again" runs after too many searches', async () => {
    mockApi.stories.list
      .mockRejectedValueOnce(new ApiError(429, 'Too many search requests. Please try again later.'))
      .mockReturnValueOnce(new Promise(() => {}))
    renderSearchPage('/search?q=climate')
    await failure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('button', { name: 'Trying again...' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(RATE_LIMIT_HINT)
  })

  it('says the usual line when the next attempt fails for another reason', async () => {
    mockApi.stories.list
      .mockRejectedValueOnce(new ApiError(429, 'Too many search requests. Please try again later.'))
      .mockRejectedValueOnce(new ApiError(500, 'Failed to fetch stories'))
    renderSearchPage('/search?q=climate')
    await failure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(GENERIC_HINT))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the results in place when "Try again" succeeds', async () => {
    mockApi.stories.list.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ONE_RESULT)
    renderSearchPage('/search?q=climate')
    await failure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('1 result')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Climate Change Report/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockApi.stories.list).toHaveBeenCalledTimes(2)
  })

  it('says nothing was found only when the search answers with no results', async () => {
    mockApi.stories.list.mockResolvedValue(NO_RESULTS)
    renderSearchPage('/search?q=nothing')

    expect(await screen.findByText('No results found for “nothing”.')).toBeInTheDocument()
    expect(screen.getByText('0 results')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
