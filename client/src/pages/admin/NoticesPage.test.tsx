import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { AdminNotice } from '../../lib/admin-api'
import { renderAdminRoutes } from '../../test/admin'
import NoticesPage from './NoticesPage'

const mockApi = vi.hoisted(() => ({
  notices: {
    list: vi.fn(),
    markSeen: vi.fn(),
    markAllSeen: vi.fn(),
  },
  jobs: { serverTime: vi.fn() },
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

function notice(overrides: Partial<AdminNotice> = {}): AdminNotice {
  return {
    id: 'n-1', source: 'plunk', severity: 'critical', title: 'Spam complaint in Plunk', message: 'A recipient marked an email as spam.',
    link: '/admin/subscribers', dedupeKey: 'plunk:e1_complaint', count: 1,
    firstOccurredAt: '2026-10-08T10:00:00.000Z', lastOccurredAt: '2026-10-08T10:00:00.000Z', seenAt: null, ...overrides,
  }
}

const UNSEEN = notice()
const SEEN = notice({ id: 'n-2', source: 'jobs', severity: 'warning', title: 'Job crawl_feeds failed', seenAt: '2026-10-08T11:00:00.000Z' })

function renderPage(path = '/admin/notices') {
  return renderAdminRoutes([{ path: '/admin/notices', element: <NoticesPage /> }], { history: [path] })
}

const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement

describe('NoticesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.notices.list.mockResolvedValue({ items: [UNSEEN, SEEN], total: 2, page: 1, limit: 25, unseenCount: 1 })
    mockApi.notices.markSeen.mockResolvedValue({ ...UNSEEN, seenAt: '2026-10-08T12:00:00.000Z' })
    mockApi.notices.markAllSeen.mockResolvedValue({ affected: 1 })
    mockApi.jobs.serverTime.mockResolvedValue({ time: '2026-10-08T12:00:00Z', timezone: 'UTC' })
  })

  it('labels an unseen notice "Unseen" and a seen one not', async () => {
    renderPage()
    await screen.findByText(UNSEEN.title)
    expect(within(rowOf(UNSEEN.title)).getByText('Unseen')).toBeInTheDocument()
    expect(within(rowOf(SEEN.title)).queryByText('Unseen')).not.toBeInTheDocument()
  })

  it('writes the source filter to the URL and asks for that source', async () => {
    const { router } = renderPage()
    await screen.findByText(UNSEEN.title)
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'plunk' } })
    await waitFor(() => expect(router.state.location.search).toBe('?source=plunk'))
    await waitFor(() => expect(mockApi.notices.list).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'plunk', show: 'all', page: 1 })))
  })

  it('reads the filters from the URL', async () => {
    renderPage('/admin/notices?source=podcast&show=unseen&page=2')
    await waitFor(() => expect(mockApi.notices.list).toHaveBeenCalledWith(expect.objectContaining({ source: 'podcast', show: 'unseen', page: 2 })))
  })

  it('marks one notice seen and refetches the list', async () => {
    renderPage()
    await screen.findByText(UNSEEN.title)
    const calls = mockApi.notices.list.mock.calls.length
    fireEvent.click(within(rowOf(UNSEEN.title)).getByRole('button', { name: /mark seen/i }))
    await waitFor(() => expect(mockApi.notices.markSeen).toHaveBeenCalledWith('n-1'))
    await waitFor(() => expect(mockApi.notices.list.mock.calls.length).toBeGreaterThan(calls))
  })

  it('marks a notice seen when it is expanded, and not one already seen', async () => {
    renderPage()
    await screen.findByText(UNSEEN.title)
    fireEvent.click(within(rowOf(SEEN.title)).getByRole('button', { expanded: false }))
    fireEvent.click(within(rowOf(UNSEEN.title)).getByRole('button', { expanded: false }))
    await waitFor(() => expect(mockApi.notices.markSeen).toHaveBeenCalledTimes(1))
    expect(mockApi.notices.markSeen).toHaveBeenCalledWith('n-1')
  })

  it('marks all seen for the current source filter', async () => {
    renderPage('/admin/notices?source=plunk')
    await screen.findByText(UNSEEN.title)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }))
    await waitFor(() => expect(mockApi.notices.markAllSeen).toHaveBeenCalledWith('plunk'))
  })
})
