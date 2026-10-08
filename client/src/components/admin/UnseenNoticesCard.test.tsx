import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { AdminNotice } from '../../lib/admin-api'
import { renderAdminRoutes } from '../../test/admin'
import { UnseenNoticesCard } from './UnseenNoticesCard'

const mockApi = vi.hoisted(() => ({
  notices: { list: vi.fn() },
  jobs: { serverTime: vi.fn() },
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

const notice = (i: number): AdminNotice => ({
  id: `n-${i}`, source: 'jobs', severity: 'warning', title: `Notice ${i}`, message: 'm', link: null, dedupeKey: null, count: 1,
  firstOccurredAt: '2026-10-08T10:00:00.000Z', lastOccurredAt: '2026-10-08T10:00:00.000Z', seenAt: null,
})

function renderCard() {
  return renderAdminRoutes([{ path: '/admin', element: <UnseenNoticesCard /> }], { history: ['/admin'] })
}

describe('UnseenNoticesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.jobs.serverTime.mockResolvedValue({ time: '2026-10-08T12:00:00Z', timezone: 'UTC' })
  })

  it('renders nothing when no notice is unseen', async () => {
    mockApi.notices.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, unseenCount: 0 })
    renderCard()
    await waitFor(() => expect(mockApi.notices.list).toHaveBeenCalledWith(expect.objectContaining({ show: 'unseen', limit: 5 })))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('heading', { name: 'Unseen notices' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('lists at most five unseen notices and links to all of them', async () => {
    mockApi.notices.list.mockResolvedValue({ items: [1, 2, 3, 4, 5, 6, 7].map(notice), total: 7, page: 1, limit: 5, unseenCount: 7 })
    renderCard()
    await screen.findByText('Notice 1')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('link', { name: /see all 7/i })).toHaveAttribute('href', '/admin/notices?show=unseen')
  })
})
