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

const FREE: PodcastWeekSlot = {
  edition: 'full',
  weekKey: '2026-W41',
  episode: null,
  fridayRun: 'create',
  fridayWindow: 'ahead',
  automaticRunEnabled: true,
  showProblem: null,
}
const CLOSED_UPLIFTING: PodcastWeekSlot = {
  ...FREE,
  edition: 'uplifting',
  automaticRunEnabled: false,
  showProblem: 'Actually Uplifting is switched off: PODCAST_UPLIFTING_ENABLED is not "true" on the API service',
}

/** The main show's slot answer, and Actually Uplifting's (switched off unless a test says otherwise). */
function slots(full: PodcastWeekSlot | Promise<PodcastWeekSlot> | Error, uplifting: PodcastWeekSlot = CLOSED_UPLIFTING) {
  mockApi.podcasts.weekSlot.mockImplementation(async (edition: string) => {
    if (edition === 'uplifting') return uplifting
    if (full instanceof Error) throw full
    return full
  })
}

function renderPage() {
  return renderAdminRoutes(
    [
      { path: '/admin/podcasts', element: <PodcastsPage /> },
      { path: '/admin/podcasts/:id', element: <Where /> },
    ],
    { history: ['/admin/podcasts'] },
  )
}

const weeklyButton = () => screen.findByRole('button', { name: /this week's episode/i })

describe("PodcastsPage: this week's slot", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.podcasts.list.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })
    slots(FREE)
    mockApi.podcasts.startWeekly.mockResolvedValue(makePodcast({ id: 'pod-new' }))
  })

  it('keeps the weekly button busy while the slot is still loading, so no dialog misstates it', async () => {
    slots(new Promise(() => {}))
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
    expect(mockApi.podcasts.startWeekly).toHaveBeenCalledWith('full')
  })

  it("opens a claimed slot's episode directly, with no dialog and no claim", async () => {
    slots({ ...FREE, episode: makePodcast({ id: 'pod-7', title: 'Midweek test' }), fridayRun: 'waiting-for-person' })
    renderPage()
    await screen.findByRole('link', { name: 'Midweek test' })
    fireEvent.click(await screen.findByRole('button', { name: "Open this week's episode" }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/admin/podcasts/pod-7')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockApi.podcasts.startWeekly).not.toHaveBeenCalled()
  })

  it('still asks first when the slot could not be read', async () => {
    slots(new Error('down'))
    renderPage()
    await screen.findByText(/could not check this week's episode/i)
    fireEvent.click(await screen.findByRole('button', { name: "Start this week's episode" }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(mockApi.podcasts.startWeekly).not.toHaveBeenCalled()
  })
})

describe("PodcastsPage: Actually Uplifting's slot", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.podcasts.list.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 })
    mockApi.podcasts.startWeekly.mockResolvedValue(makePodcast({ id: 'pod-up', edition: 'uplifting' }))
  })

  const upliftingNotice = () => screen.findByRole('region', { name: "This week's Actually Uplifting episode" })

  it('shows the show as switched off, naming what it waits for, with no button to start it', async () => {
    slots(FREE)
    renderPage()
    expect(await upliftingNotice()).toHaveTextContent(/Actually Uplifting is switched off: PODCAST_UPLIFTING_ENABLED/)
    expect(screen.queryByRole('button', { name: /Actually Uplifting episode/ })).not.toBeInTheDocument()
  })

  it('starts the show’s own episode once it is open, after asking', async () => {
    slots(FREE, { ...CLOSED_UPLIFTING, automaticRunEnabled: true, showProblem: null })
    renderPage()
    await upliftingNotice()
    fireEvent.click(await screen.findByRole('button', { name: "Start this week's Actually Uplifting episode" }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: "Start this week's Actually Uplifting episode?" })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: "Start this week's Actually Uplifting episode" }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/admin/podcasts/pod-up')
    expect(mockApi.podcasts.startWeekly).toHaveBeenCalledWith('uplifting')
  })
})
