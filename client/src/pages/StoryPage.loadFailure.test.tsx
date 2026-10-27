import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { makeStory } from '../test/stories'
import { inAutomatedBrowser } from '../test/automatedBrowser'

const mockApi = vi.hoisted(() => ({ stories: { get: vi.fn(), related: vi.fn(), cluster: vi.fn() }, newsletterArchive: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import { ApiError } from '../lib/api'
import StoryPage from './StoryPage'

const story = makeStory({ slug: 'shared-story', title: 'Shared headline', titleLabel: 'Shared label' })

function renderPage(slug = 'shared-story') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/stories/${slug}`]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/stories/:slug" element={<StoryPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const failure = () => screen.findByRole('heading', { level: 1, name: "This story couldn't load" })
const tryAgain = () => screen.getByRole('button', { name: 'Try again' })

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.stories.related.mockResolvedValue([])
  mockApi.stories.cluster.mockResolvedValue({ sources: [] })
  mockApi.newsletterArchive.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })
})

describe('StoryPage when the story does not load', () => {
  it('says the story was not found when the API answers 404', async () => {
    mockApi.stories.get.mockRejectedValue(new ApiError(404, 'Story not found'))
    renderPage('gone')

    expect(await screen.findByRole('heading', { level: 1, name: 'Story Not Found' })).toBeInTheDocument()
    expect(screen.getByText('This story may have been removed or is not yet published.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('says the story was not found in an automated browser too, since story pages are never prerendered', async () => {
    await inAutomatedBrowser(async () => {
      mockApi.stories.get.mockRejectedValue(new ApiError(404, 'Story not found'))
      renderPage('gone')
      expect(await screen.findByRole('heading', { level: 1, name: 'Story Not Found' })).toBeInTheDocument()
    })
  })

  it.each([
    ['the server fails', new ApiError(500, 'Failed to fetch story')],
    ['the server is busy', new ApiError(503, 'Service Unavailable')],
    ['the connection drops', new TypeError('Failed to fetch')],
  ])('says the story could not load right now, never that it was removed, when %s', async (_, error) => {
    mockApi.stories.get.mockRejectedValue(error)
    renderPage()

    const heading = await failure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.getByRole('alert')).toHaveTextContent('The connection may have dropped, or the site is busy right now. Please try again.')
    expect(screen.queryByText(/not found|removed/i)).toBeNull()
    expect(tryAgain()).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Back to home' })).toHaveAttribute('href', '/')
  })

  it('does not move focus to the message', async () => {
    mockApi.stories.get.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    renderPage()
    await failure()
    expect(document.body).toHaveFocus()
  })

  it('loads the story in place when "Try again" succeeds', async () => {
    mockApi.stories.get.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable')).mockResolvedValueOnce(story)
    renderPage()
    await failure()

    await userEvent.click(tryAgain())

    expect(await screen.findByRole('heading', { level: 1, name: 'Shared headline' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockApi.stories.get).toHaveBeenCalledTimes(2)
    expect(mockApi.stories.get).toHaveBeenLastCalledWith('shared-story')
  })

  it('keeps the message, the button and its focus while "Try again" runs and when it fails too', async () => {
    let fail: (error: unknown) => void = () => {}
    mockApi.stories.get
      .mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    renderPage()
    await failure()
    const button = tryAgain()

    await userEvent.click(button)
    expect(await screen.findByRole('button', { name: 'Trying again...' })).toBe(button)
    expect(button).toHaveFocus()
    fail(new TypeError('Failed to fetch'))

    await waitFor(() => expect(tryAgain()).toBe(button))
    expect(button).toHaveFocus()
    expect(screen.getByRole('alert')).toContainElement(screen.getByRole('heading', { level: 1, name: "This story couldn't load" }))
  })
})
