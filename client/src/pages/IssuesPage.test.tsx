import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { inAutomatedBrowser } from '../test/automatedBrowser'

const mockApi = vi.hoisted(() => ({ issues: { list: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import { ApiError, type PublicIssue } from '../lib/api'
import IssuesPage from './IssuesPage'

const ISSUE: PublicIssue = {
  id: 'i1',
  name: 'Planet & Climate',
  slug: 'planet-climate',
  description: 'Climate and ecosystems.',
  intro: 'Climate and ecosystems.',
  evaluationIntro: '',
  evaluationCriteria: [],
  sourceNames: [],
  makeADifference: [],
  parentId: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/issues']}>
        <QueryClientProvider client={client}>
          <IssuesPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
  return { ...result, client }
}

const failure = () => screen.findByRole('heading', { level: 2, name: "The issues couldn't load" })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('IssuesPage when the issues do not load', () => {
  it.each([
    ['the server fails', new ApiError(500, 'Failed to fetch issues')],
    ['the API is not there', new ApiError(404, 'Not Found')],
    ['the connection drops', new TypeError('Failed to fetch')],
  ])('says the issues could not load, under the page heading, when %s', async (_, error) => {
    mockApi.issues.list.mockRejectedValue(error)
    renderPage()

    const heading = await failure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.getByRole('heading', { level: 1, name: 'All Issues' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('loads the issues in place when "Try again" succeeds', async () => {
    mockApi.issues.list.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce([ISSUE])
    renderPage()
    await failure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Planet & Climate')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mockApi.issues.list).toHaveBeenCalledTimes(2)
  })

  it('shows an empty list, and no failure, when the API answers with no issues', async () => {
    mockApi.issues.list.mockResolvedValue([])
    const { container, client } = renderPage()

    await waitFor(() => expect(client.getQueryState(['public-issues'])?.status).toBe('success'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('shows the skeleton in the prerenderer, so the failure is never baked into the static page', async () => {
    await inAutomatedBrowser(async () => {
      mockApi.issues.list.mockRejectedValue(new TypeError('Failed to fetch'))
      const { container, client } = renderPage()

      await waitFor(() => expect(client.getQueryState(['public-issues'])?.status).toBe('error'))
      expect(container.querySelector('.animate-pulse')).not.toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
