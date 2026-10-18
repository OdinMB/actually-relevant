import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { ToastProvider } from '../../components/ui/Toast'
import { adminApi, ApiError } from '../../lib/admin-api'
import DashboardPage from './DashboardPage'

// Mock the API module
vi.mock('../../lib/admin-api', () => ({
  adminApi: {
    stories: {
      stats: vi.fn().mockResolvedValue({
        fetched: 10,
        pre_analyzed: 5,
        analyzed: 3,
        selected: 2,
        published: 8,
        rejected: 1,
        trashed: 0,
      }),
      lifetimeStats: vi.fn().mockResolvedValue({
        total: 1229,
        archived: 1200,
        byStatus: { rejected: 1201, published: 8 },
        byRelevancePre: { '7': 40, '3': 1100, none: 89 },
        byRelevance: { '7': 12, none: 1217 },
      }),
    },
    jobs: {
      list: vi.fn().mockResolvedValue([
        {
          id: '1',
          jobName: 'crawl_feeds',
          lastStartedAt: '2025-01-01T00:00:00Z',
          lastCompletedAt: '2025-01-01T00:01:00Z',
          lastSucceededAt: '2025-01-01T00:01:00Z',
          lastError: null,
          enabled: true,
          cronExpression: '0 */6 * * *',
          timeZone: null,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ]),
      run: vi.fn().mockResolvedValue({ message: 'Job triggered' }),
    },
    notices: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, unseenCount: 0 }),
    },
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <DashboardPage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page title', () => {
    renderDashboard()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows lifetime totals including deleted stories', async () => {
    renderDashboard()
    expect(await screen.findByText('1,229')).toBeInTheDocument()
    expect(screen.getByText(/including 1,200 deleted by the monthly cleanup/)).toBeInTheDocument()
    expect(screen.getByText('1,100')).toBeInTheDocument()
  })

  it('shows story stats after loading', async () => {
    renderDashboard()
    // Scoped to the status grid: the lifetime table's rating rows also read 10 and 8.
    const section = screen.getByRole('heading', { name: 'Stories by Status' }).closest('section')!
    expect(await within(section).findByText('10')).toBeInTheDocument()
    expect(within(section).getByText('8')).toBeInTheDocument()
  })

  it('shows jobs table after loading', async () => {
    renderDashboard()
    expect(await screen.findByText('Crawl Feeds')).toBeInTheDocument()
  })

  it('renders run buttons for each job', async () => {
    renderDashboard()
    expect(await screen.findByRole('button', { name: 'Run Crawl Feeds' })).toBeInTheDocument()
  })

  it('shows the server message when a run is refused', async () => {
    vi.mocked(adminApi.jobs.run).mockRejectedValueOnce(new ApiError(409, 'Job crawl_feeds is already running'))
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Run Crawl Feeds' }))
    expect(await screen.findByText('Job crawl_feeds is already running')).toBeInTheDocument()
  })
})
