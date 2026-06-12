import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import SubscribersPage from './SubscribersPage'
import { adminApi } from '../../lib/admin-api'

vi.mock('../../lib/admin-api', () => ({
  adminApi: { subscribers: { list: vi.fn() } },
}))

const listMock = vi.mocked(adminApi.subscribers.list)

const baseReconciliation = {
  db: { total: 2, confirmed: 1, pending: 1 },
  plunk: { available: true, partial: false, truncated: false, total: 3, subscribed: 2, unsubscribed: 1, unsubscribedNotInDb: 1, error: null },
  mismatches: 1,
  rows: [
    { email: 'alice@example.com', dbStatus: 'confirmed' as const, dbConfirmedAt: '2026-02-01T00:00:00Z', dbCreatedAt: '2026-01-01T00:00:00Z', plunkStatus: 'subscribed' as const, plunkContactId: 'p1', mismatch: false },
    { email: 'bob@example.com', dbStatus: 'confirmed' as const, dbConfirmedAt: '2026-02-01T00:00:00Z', dbCreatedAt: '2026-01-01T00:00:00Z', plunkStatus: null, plunkContactId: null, mismatch: true },
  ],
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <SubscribersPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('SubscribersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the reconciliation rows and flags a mismatch', async () => {
    listMock.mockResolvedValue(baseReconciliation)
    renderPage()

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getByText('drift')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()
  })

  it('shows a "Plunk unavailable" notice when Plunk could not be read', async () => {
    listMock.mockResolvedValue({
      ...baseReconciliation,
      plunk: { available: false, partial: false, truncated: false, total: null, subscribed: null, unsubscribed: null, unsubscribedNotInDb: null, error: 'PROJECT_DISABLED' },
      mismatches: 0,
      rows: [{ email: 'alice@example.com', dbStatus: 'confirmed' as const, dbConfirmedAt: null, dbCreatedAt: '2026-01-01T00:00:00Z', plunkStatus: null, plunkContactId: null, mismatch: false }],
    })
    renderPage()

    expect(await screen.findByText(/Plunk is unavailable/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no rows', async () => {
    listMock.mockResolvedValue({
      db: { total: 0, confirmed: 0, pending: 0 },
      plunk: { available: true, partial: false, truncated: false, total: 0, subscribed: 0, unsubscribed: 0, unsubscribedNotInDb: 0, error: null },
      mismatches: 0,
      rows: [],
    })
    renderPage()

    expect(await screen.findByText('No subscribers yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument()
  })
})
