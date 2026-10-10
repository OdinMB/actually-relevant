import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { PodcastWeekSlot } from '@shared/types'
import { renderAdminRoutes, Where } from '../../test/admin'
import { makePodcast } from '../../test/podcasts'
import PodcastsPage from './PodcastsPage'

const mockApi = vi.hoisted(() => ({
  podcasts: {
    list: vi.fn(),
    weekSlot: vi.fn(),
    startWeekly: vi.fn(),
    createStandalone: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

const FREE: PodcastWeekSlot = { weekKey: '2026-W41', episode: null, fridayRun: 'create', fridayWindow: 'ahead', automaticRunEnabled: true }

function renderPage() {
  return renderAdminRoutes([
    { path: '/admin/podcasts', element: <PodcastsPage /> },
    { path: '/admin/podcasts/:id', element: <Where /> },
  ], { history: ['/admin/podcasts'] })
}

const weeklyButton = () => screen.findByRole('button', { name: /this week's episode/i })

describe('PodcastsPage: this week\'s slot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.podcasts.list.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })
    mockApi.podcasts.weekSlot.mockResolvedValue(FREE)
    mockApi.podcasts.startWeekly.mockResolvedValue(makePodcast({ id: 'pod-new' }))
  })

  it('keeps the weekly button busy while the slot is still loading, so no dialog misstates it', async () => {
    mockApi.podcasts.weekSlot.mockReturnValue(new Promise(() => {}))
    renderPage()
    const button = await weeklyButton()
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.podcasts.startWeekly).not.toHaveBeenCalled()
  })

  it('asks before claiming a free slot, and cancel claims nothing', async () => {
    renderPage()
    await screen.findByText(/no episode for this week yet/i)
    fireEvent.click(await weeklyButton())
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockApi.podcasts.startWeekly).not.toHaveBeenCalled()
  })

  it('claims the slot on confirm and opens the episode', async () => {
    renderPage()
    await screen.findByText(/no episode for this week yet/i)
    fireEvent.click(await weeklyButton())
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: "Start this week's episode" }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/admin/podcasts/pod-new')
    expect(mockApi.podcasts.startWeekly).toHaveBeenCalledTimes(1)
  })

  it('opens a claimed slot\'s episode directly, with no dialog and no claim', async () => {
    mockApi.podcasts.weekSlot.mockResolvedValue({ ...FREE, episode: makePodcast({ id: 'pod-7', title: 'Midweek test' }), fridayRun: 'waiting-for-person' })
    renderPage()
    await screen.findByRole('link', { name: 'Midweek test' })
    fireEvent.click(await screen.findByRole('button', { name: "Open this week's episode" }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/admin/podcasts/pod-7')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.podcasts.startWeekly).not.toHaveBeenCalled()
  })

  it('still asks first when the slot could not be read', async () => {
    mockApi.podcasts.weekSlot.mockRejectedValue(new Error('down'))
    renderPage()
    await screen.findByText(/could not check/i)
    fireEvent.click(await screen.findByRole('button', { name: "Start this week's episode" }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(mockApi.podcasts.startWeekly).not.toHaveBeenCalled()
  })
})
