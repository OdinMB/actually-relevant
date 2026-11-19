import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicOverviewHead } from '@shared/types'
import { announcedText } from '../test/stories'

const mockApi = vi.hoisted(() => ({ overviews: { list: vi.fn(), get: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import OverviewsIndexPage from './OverviewsIndexPage'

const head = (slug: string, title: string, overrides: Partial<PublicOverviewHead> = {}): PublicOverviewHead => ({
  slug,
  title,
  area: { name: 'Human Development', slug: 'human-development' },
  status: 'open',
  closedReason: null,
  closedAt: null,
  since: '2026-10-01T08:00:00.000Z',
  lastEntryAt: '2026-11-10T08:00:00.000Z',
  lastChange: '2026-11-10T08:00:00.000Z',
  stories: 4,
  ...overrides,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/ongoing']}>
        <QueryClientProvider client={client}>
          <OverviewsIndexPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OverviewsIndexPage', () => {
  it('lists the public ongoing stories in the order the API gives, the most recently changed first, each AI title linking its page', async () => {
    mockApi.overviews.list.mockResolvedValue({
      on: true,
      overviews: [head('ebola-in-ituri', 'Ebola in Ituri'), head('sudan-ceasefire', 'Sudan ceasefire talks', { status: 'quiet', area: null, stories: 1 })],
    })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Ongoing Stories' })).toBeInTheDocument()
    const titles = screen.getAllByRole('heading', { level: 2 })
    expect(titles.map(t => announcedText(t))).toEqual(['AI-generated Ebola in Ituri', 'AI-generated Sudan ceasefire talks'])
    expect(titles.every(t => t.getAttribute('data-ai-generated') === 'title')).toBe(true)
    expect(screen.getByRole('link', { name: 'AI-generated Ebola in Ituri' })).toHaveAttribute('href', '/ongoing/ebola-in-ituri')
    expect(screen.getByText('Ongoing story · since October 2026 · Human Development')).toBeInTheDocument()
    expect(screen.getByText('No new reporting since Nov 10, 2026')).toBeInTheDocument()
    expect(screen.getByText('1 story · last change Nov 10, 2026')).toBeInTheDocument()
    await waitFor(() => expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://actuallyrelevant.news/ongoing'))
  })

  it('says so when none is public right now', async () => {
    mockApi.overviews.list.mockResolvedValue({ on: true, overviews: [] })
    renderPage()
    expect(await screen.findByText('No ongoing stories right now.')).toBeInTheDocument()
  })

  it('is not found, with noindex, while overviews are switched off', async () => {
    mockApi.overviews.list.mockResolvedValue({ on: false, overviews: [] })
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Page Not Found' })).toBeInTheDocument()
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex'))
  })
})
