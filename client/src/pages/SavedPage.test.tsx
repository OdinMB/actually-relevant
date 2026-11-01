import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeStory } from '../test/stories'

const mockApi = vi.hoisted(() => ({ stories: { get: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import { ApiError } from '../lib/api'
import { toggleSaved } from '../lib/preferences'
import SavedPage from './SavedPage'
import { DefaultSeo } from '../lib/seo'

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/saved']}>
        <QueryClientProvider client={client}>
          {/* The site-wide defaults the app renders above every page */}
          <DefaultSeo />
          <SavedPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
  return client
}

function headContent(selector: string): (string | null)[] {
  return Array.from(document.head.querySelectorAll(selector)).map(el => el.getAttribute('content'))
}

describe('SavedPage', () => {
  it("gives link previews the page's own title, description and URL, not the homepage's, and no article author", async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Saved Stories' })).toBeInTheDocument()

    await waitFor(() => {
      expect(headContent('meta[property="og:url"]')).toEqual(['https://actuallyrelevant.news/saved'])
    })
    expect(headContent('meta[property="og:title"]')).toEqual(['Saved Stories - Actually Relevant'])
    expect(headContent('meta[property="og:description"]')).toEqual(['Your saved stories on Actually Relevant.'])
    expect(headContent('meta[name="description"]')).toEqual(['Your saved stories on Actually Relevant.'])
    expect(headContent('meta[property="article:author"]')).toEqual([])
  })
})

describe('SavedPage when the saved stories do not load', () => {
  const kept = makeStory({ id: 'kept', slug: 'kept', title: 'Kept headline' })
  const failure = () => screen.findByRole('heading', { level: 2, name: "Your saved stories couldn't load" })
  const NOTHING_SAVED = "You haven't saved any stories yet."

  beforeEach(() => {
    vi.resetAllMocks()
    toggleSaved('kept')
    toggleSaved('other')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it.each([
    ['the server fails', new ApiError(500, 'Failed to fetch story')],
    ['the connection drops', new TypeError('Failed to fetch')],
  ])('says they could not load, under the page heading, when none loads because %s', async (_, error) => {
    mockApi.stories.get.mockRejectedValue(error)
    renderPage()

    const heading = await failure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.getByRole('heading', { level: 1, name: 'Saved Stories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(NOTHING_SAVED)).toBeNull()
  })

  it('asks for each saved story once, without the automatic retry other queries get', async () => {
    mockApi.stories.get.mockRejectedValue(new TypeError('Failed to fetch'))
    // As the app's client (lib/query.ts): other queries retry once
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } }))

    await failure()
    expect(mockApi.stories.get).toHaveBeenCalledTimes(2)
  })

  it('loads the saved stories in place when "Try again" succeeds', async () => {
    mockApi.stories.get.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()
    await failure()

    mockApi.stories.get.mockImplementation((slug: string) => Promise.resolve(makeStory({ id: slug, slug, title: `${slug} headline` })))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: /kept headline/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /other headline/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('leaves out a saved story that is gone, without a failure', async () => {
    mockApi.stories.get.mockImplementation((slug: string) => (slug === 'kept' ? Promise.resolve(kept) : Promise.reject(new ApiError(404, 'Story not found'))))
    renderPage()

    expect(await screen.findByRole('link', { name: /Kept headline/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows no failure when every saved story is gone', async () => {
    mockApi.stories.get.mockRejectedValue(new ApiError(404, 'Story not found'))
    const client = renderPage()

    await waitFor(() => expect(client.getQueryState(['saved-stories', ['kept', 'other']])?.status).toBe('success'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('link', { name: /headline/ })).toBeNull()
  })

  it('still shows the stories that loaded when only some fail', async () => {
    mockApi.stories.get.mockImplementation((slug: string) => (slug === 'kept' ? Promise.resolve(kept) : Promise.reject(new TypeError('Failed to fetch'))))
    renderPage()

    expect(await screen.findByRole('link', { name: /Kept headline/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says nothing is saved, asking for nothing, when nothing is', async () => {
    localStorage.clear()
    renderPage()

    expect(await screen.findByText(NOTHING_SAVED)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockApi.stories.get).not.toHaveBeenCalled()
  })
})
