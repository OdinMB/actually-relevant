import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import StatsPage from './StatsPage'

vi.mock('../../lib/admin-api', () => ({
  adminApi: {
    stories: {
      lifetimeStats: vi.fn().mockResolvedValue({
        total: 1500,
        archived: 1200,
        byStatus: { rejected: 1400, published: 100 },
        byRelevancePre: { '8': 150, '3': 1300, none: 50 },
        byRelevance: { '7': 100, none: 1400 },
        byMonth: [
          { month: '2026-09', crawled: 300, screened: 290, assessed: 60, published: 30, archived: 0 },
          { month: '2025-08', crawled: 1200, screened: 1160, assessed: 40, published: 70, archived: 1200 },
        ],
        byFeed: [
          { id: 'feed-a', name: 'Alpha News', crawled: 1000, published: 20, archived: 900, avgRelevancePre: 3.1, highPre: 30 },
          { id: 'feed-b', name: 'Beta Times', crawled: 500, published: 80, archived: 300, avgRelevancePre: 6.4, highPre: 120 },
        ],
        byIssue: [
          { id: 'issue-1', name: 'Climate', crawled: 1500, published: 100, archived: 1200, avgRelevancePre: 4.2, highPre: 150 },
        ],
      }),
    },
  },
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <StatsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const sourceRows = () => {
  const table = screen.getByRole('table', { name: /By source/ })
  return within(table).getAllByRole('row').slice(1).map(row => within(row).getByRole('rowheader').textContent)
}

describe('StatsPage', () => {
  it('shows lifetime tiles, including the deleted stories', async () => {
    renderPage()
    expect((await screen.findByText('Stories crawled')).nextSibling).toHaveTextContent('1,500')
    expect(screen.getByText('Deleted by cleanup').nextSibling).toHaveTextContent('1,200')
    expect(screen.getByText('Fully assessed').nextSibling).toHaveTextContent('100')
  })

  it('links each source to its feed and sorts by a chosen column', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: 'Alpha News' })).toHaveAttribute('href', '/admin/feeds?open=feed-a')
    expect(sourceRows()).toEqual(['Alpha News', 'Beta Times'])

    const table = screen.getByRole('table', { name: /By source/ })
    fireEvent.click(within(table).getByRole('button', { name: 'Avg screening' }))
    expect(sourceRows()).toEqual(['Beta Times', 'Alpha News'])
    expect(within(table).getByRole('columnheader', { name: 'Avg screening' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('lists months newest first with their deleted counts', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: /by month crawled/ })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('2026-09')
    expect(rows[1]).toHaveTextContent('1,200')
  })
})
