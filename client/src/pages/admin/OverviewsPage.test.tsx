import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { AdminOverviewListItem } from '@shared/types'
import { renderAdminRoutes } from '../../test/admin'
import OverviewsPage from './OverviewsPage'

const mockApi = vi.hoisted(() => ({ overviews: { state: vi.fn(), list: vi.fn() } }))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

function overview(over: Partial<AdminOverviewListItem> = {}): AdminOverviewListItem {
  return {
    id: 'o1',
    title: 'Ebola in Ituri',
    slug: null,
    scope: 'ongoing',
    status: 'open',
    closedReason: null,
    frozen: false,
    hidden: false,
    public: true,
    entries: 4,
    foundedAt: '2026-11-01T00:00:00.000Z',
    lastEntryAt: '2026-11-10T00:00:00.000Z',
    issue: null,
    ...over,
  }
}

const renderPage = (path = '/admin/overviews') => renderAdminRoutes([{ path: '/admin/overviews', element: <OverviewsPage /> }], { history: [path] })

describe('OverviewsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.overviews.state.mockResolvedValue({ on: true, count: 2 })
    mockApi.overviews.list.mockResolvedValue([
      overview(),
      overview({ id: 'o2', title: 'Cholera in Kasai', frozen: true, hidden: true, public: false, scope: 'forming' }),
    ])
  })

  it('lists each overview with its entries and whether readers see it, linking to its page', async () => {
    renderPage()
    const row = (await screen.findByRole('link', { name: 'Cholera in Kasai' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Not public')).toBeInTheDocument()
    expect(within(row).getByText('Frozen')).toBeInTheDocument()
    expect(within(row).getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ebola in Ituri' })).toHaveAttribute('href', '/admin/overviews/o1')
    expect(within(screen.getByRole('link', { name: 'Ebola in Ituri' }).closest('tr') as HTMLElement).getByText('Public')).toBeInTheDocument()
  })

  it('writes the filters to the address and asks for them, the flags as booleans', async () => {
    const { router } = renderPage()
    await screen.findByText('Ebola in Ituri')
    fireEvent.change(screen.getByLabelText('Filter by scope'), { target: { value: 'ongoing' } })
    fireEvent.change(screen.getByLabelText('Filter by frozen'), { target: { value: 'false' } })
    await waitFor(() => expect(router.state.location.search).toBe('?scope=ongoing&frozen=false'))
    await waitFor(() => expect(mockApi.overviews.list).toHaveBeenLastCalledWith({ scope: 'ongoing', status: undefined, frozen: false, hidden: undefined }))
  })

  it('reads the filters from the address, ignoring an unknown value, and clears one', async () => {
    const { router } = renderPage('/admin/overviews?status=closed&hidden=true&scope=big')
    await waitFor(() => expect(mockApi.overviews.list).toHaveBeenCalledWith({ scope: undefined, status: 'closed', frozen: undefined, hidden: true }))
    expect(await screen.findByText('Ebola in Ituri')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter by hidden'), { target: { value: '' } })
    await waitFor(() => expect(router.state.location.search).toBe('?scope=big'))
  })

  it('sorts by the column clicked', async () => {
    renderPage()
    await screen.findByText('Ebola in Ituri')
    const titles = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map(r => within(r).getAllByRole('cell')[0]!.textContent)
    fireEvent.click(screen.getByRole('button', { name: /Title/ }))
    expect(titles()).toEqual(['Cholera in Kasai', 'Ebola in Ituri'])
    for (const name of [/Scope/, /Status/, /Entries/, /Last entry/]) fireEvent.click(screen.getByRole('button', { name }))
    expect(titles()).toHaveLength(2)
  })

  it('says when no overview matches the filters, and when the list fails to load', async () => {
    mockApi.overviews.list.mockResolvedValue([])
    const { unmount } = renderPage('/admin/overviews?frozen=true')
    expect(await screen.findByText('No overviews match these filters')).toBeInTheDocument()
    unmount()

    mockApi.overviews.list.mockRejectedValue(new Error('down'))
    renderPage()
    expect(await screen.findByText('Failed to load overviews')).toBeInTheDocument()
  })

  it('says the step is off while overviews exist, and shows nothing while it is off and none exist', async () => {
    mockApi.overviews.state.mockResolvedValue({ on: false, count: 2 })
    const { unmount } = renderPage()
    expect(await screen.findByText(/The Link Overviews step is off/)).toBeInTheDocument()
    unmount()

    mockApi.overviews.state.mockResolvedValue({ on: false, count: 0 })
    mockApi.overviews.list.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/once the Link Overviews step is switched on/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter by scope')).not.toBeInTheDocument()
  })
})
