import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { makeStory } from '../test/stories'
import { inAutomatedBrowser } from '../test/automatedBrowser'

const mockApi = vi.hoisted(() => ({ homepage: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe: vi.fn() }),
}))

import { ApiError } from '../lib/api'
import HomePage from './HomePage'

const ISSUES = [
  { id: 'i1', name: 'Human Development', slug: 'human-development' },
  { id: 'i2', name: 'Planet & Climate', slug: 'planet-climate' },
]
const noStories = { uplifting: [], calm: [], negative: [] }

const lead = makeStory({ id: 'lead', slug: 'lead', title: 'Lead headline', issue: { id: 'i1', name: 'Human Development', slug: 'human-development' } })
const second = makeStory({ id: 'second', slug: 'second', title: 'Second headline', issue: { id: 'i1', name: 'Human Development', slug: 'human-development' } })
const WITH_STORIES = {
  issues: ISSUES,
  storiesByIssue: { 'human-development': { ...noStories, calm: [lead, second] }, 'planet-climate': noStories },
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <HomePage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
  return client
}

const failure = () => screen.findByRole('heading', { level: 1, name: "The stories couldn't load" })
const EMPTY = 'No stories published yet. Check back soon.'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HomePage when the stories do not load', () => {
  it.each([
    ['the server fails', new ApiError(500, 'Failed to fetch homepage data')],
    ['the server is busy', new ApiError(503, 'Service Unavailable')],
    ['the API is not there', new ApiError(404, 'Not Found')],
    ['the connection drops', new TypeError('Failed to fetch')],
  ])('says the stories could not load right now, not that none are published, when %s', async (_, error) => {
    mockApi.homepage.mockRejectedValue(error)
    renderHome()

    const heading = await failure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('says no stories are published only when the API answers with none', async () => {
    mockApi.homepage.mockResolvedValue({ issues: ISSUES, storiesByIssue: { 'human-development': noStories, 'planet-climate': noStories } })
    renderHome()

    expect(await screen.findByText(EMPTY)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says no stories are published when the API answers with no issues', async () => {
    mockApi.homepage.mockResolvedValue({ issues: [], storiesByIssue: {} })
    renderHome()
    expect(await screen.findByText(EMPTY)).toBeInTheDocument()
  })

  it('loads the stories in place when "Try again" succeeds', async () => {
    mockApi.homepage.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(WITH_STORIES)
    renderHome()
    await failure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Lead headline' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(mockApi.homepage).toHaveBeenCalledTimes(2)
  })

  it('shows the loading skeleton in the prerenderer, so the failure is never baked into the static page', async () => {
    await inAutomatedBrowser(async () => {
      mockApi.homepage.mockRejectedValue(new TypeError('Failed to fetch'))
      const client = renderHome()

      await waitFor(() => expect(client.getQueryState(['homepage-data'])?.status).toBe('error'))
      expect(screen.getByRole('heading', { level: 1, name: 'Loading stories' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(EMPTY)).toBeNull()
    })
  })
})
