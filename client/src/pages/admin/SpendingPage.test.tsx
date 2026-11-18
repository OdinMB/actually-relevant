import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import type { SpendingOverview, SpendingRow, SpendScope } from '@shared/types'
import { renderAdminRoutes } from '../../test/admin'
import SpendingPage from './SpendingPage'

const mockApi = vi.hoisted(() => ({
  spending: { overview: vi.fn(), setLevel: vi.fn() },
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

const row = (scope: SpendScope, over: Partial<SpendingRow> = {}): SpendingRow => ({
  scope,
  thisMonth: { aiUsd: 1, searchUsd: 0, totalUsd: 1 },
  paceUsd: 1.88,
  previousUsd: [2, 2],
  levelUsd: null,
  warning: null,
  ...over,
})

const overview = (over: Partial<SpendingOverview> = {}): SpendingOverview => ({
  month: '2026-11',
  previousMonths: ['2026-10', '2026-09'],
  day: 16,
  daysInMonth: 30,
  groups: [
    { chain: 'intake_chain', rows: [row('preassess_stories'), row('assess_stories')] },
    {
      chain: 'daily_edition_chain',
      rows: [
        row('select_stories'),
        row('research_stories', { thisMonth: { aiUsd: 5.6, searchUsd: 8.6, totalUsd: 14.2 }, paceUsd: 26.63, levelUsd: 25, warning: 'on_pace' }),
      ],
    },
    {
      chain: 'podcast_chain',
      rows: [row('generate_podcast'), row('generate_uplifting_podcast', { thisMonth: { aiUsd: 0, searchUsd: 0, totalUsd: 0 }, paceUsd: 0 })],
    },
    { chain: null, rows: [row('editor_research'), row('social_auto_post')] },
  ],
  total: row('all', { thisMonth: { aiUsd: 30, searchUsd: 17, totalUsd: 47 }, paceUsd: 88.13, levelUsd: 40, warning: 'passed' }),
  voices: { usedChars: 18_400, capChars: 44_000 },
  ...over,
})

function renderCard() {
  return renderAdminRoutes([{ path: '/admin/spending', element: <SpendingPage /> }], { history: ['/admin/spending'] })
}

/** The table's row groups, each with its heading and the names of its rows. */
const groupsShown = () =>
  screen
    .getAllByRole('rowgroup')
    .slice(1, -1)
    .map(group =>
      within(group)
        .getAllByRole('rowheader')
        .map(cell => cell.textContent),
    )

describe('SpendingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.spending.overview.mockResolvedValue(overview())
    mockApi.spending.setLevel.mockImplementation(async (scope: SpendScope, levelUsd: number | null) => ({ scope, levelUsd }))
  })

  it("shows each group's rows under its heading, in the server's order, research started by an editor among the rest", async () => {
    renderCard()
    await screen.findByRole('table')
    expect(groupsShown()).toEqual([
      ['Intake', 'Pre-assess Stories', 'Assess Stories'],
      ['Daily Edition', 'Select Stories', 'Research Stories'],
      ['Weekly Podcast', 'Generate Podcast', 'Generate Actually Uplifting Podcast'],
      ['Other', 'Research started by an editor', 'Social Auto-Post'],
    ])
  })

  it('names the months from the data, and the days so far', async () => {
    mockApi.spending.overview.mockResolvedValue(overview({ month: '2027-01', previousMonths: ['2026-12', '2026-11'], day: 9, daysInMonth: 31 }))
    renderCard()
    expect(await screen.findByText('January so far (9 of 31 days)')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'December' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'November' })).toBeInTheDocument()
  })

  it('flags a row heading past its level at this pace, and the total that passed its own, and no other', async () => {
    renderCard()
    const research = (await screen.findByRole('rowheader', { name: 'Research Stories' })).closest('tr')!
    expect(within(research).getByText('on pace to pass')).toBeInTheDocument()
    const total = screen.getByRole('rowheader', { name: 'All jobs' }).closest('tr')!
    expect(within(total).getByText('passed $40')).toBeInTheDocument()
    expect(screen.getAllByText(/on pace to pass|passed \$/)).toHaveLength(2)
  })

  it('shows a dash for a month with nothing spent', async () => {
    renderCard()
    const uplifting = (await screen.findByRole('rowheader', { name: 'Generate Actually Uplifting Podcast' })).closest('tr')!
    expect(within(uplifting).getAllByText('—')).toHaveLength(4)
  })

  it("saves a level on blur, from '$30' or '30', and saves nothing when it did not change", async () => {
    renderCard()
    const field = await screen.findByLabelText('Warning level for Research Stories')
    expect(field).toHaveValue('$25')

    fireEvent.change(field, { target: { value: '30' } })
    fireEvent.blur(field)
    await waitFor(() => expect(mockApi.spending.setLevel).toHaveBeenCalledWith('research_stories', 30))

    const total = screen.getByLabelText('Warning level for all jobs')
    fireEvent.change(total, { target: { value: ' $1,200 ' } })
    fireEvent.blur(total)
    await waitFor(() => expect(mockApi.spending.setLevel).toHaveBeenCalledWith('all', 1200))

    const select = screen.getByLabelText('Warning level for Select Stories')
    fireEvent.blur(select)
    expect(mockApi.spending.setLevel).toHaveBeenCalledTimes(2)
  })

  it('clears a level when its field is left empty', async () => {
    renderCard()
    const field = await screen.findByLabelText('Warning level for Research Stories')
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    await waitFor(() => expect(mockApi.spending.setLevel).toHaveBeenCalledWith('research_stories', null))
  })

  it('saves nothing for a level that is not a whole number of dollars of at least 1, and says why', async () => {
    renderCard()
    const field = await screen.findByLabelText('Warning level for Research Stories')
    for (const value of ['0', '12.50', 'ten', '-5']) {
      fireEvent.change(field, { target: { value } })
      fireEvent.blur(field)
    }
    expect(mockApi.spending.setLevel).not.toHaveBeenCalled()
    expect(field).toHaveValue('$25')
    expect(await screen.findAllByText(/whole number of dollars/)).not.toHaveLength(0)
  })

  it('puts the level back and says so when saving fails', async () => {
    mockApi.spending.setLevel.mockRejectedValue(new Error('network down'))
    renderCard()
    const field = await screen.findByLabelText('Warning level for Research Stories')
    fireEvent.change(field, { target: { value: '30' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)
    expect(await screen.findByText('Failed to save the warning level')).toBeInTheDocument()
    expect(field).toHaveValue('$25')
  })

  it('offers a retry when the overview fails to load', async () => {
    mockApi.spending.overview.mockRejectedValueOnce(new Error('boom'))
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it("puts the voices' characters in the podcast's group, with thousands separated", async () => {
    renderCard()
    await screen.findByRole('table')
    const podcast = screen.getAllByRole('rowgroup').find(group => within(group).queryByRole('rowheader', { name: 'Weekly Podcast' }))!
    expect(within(podcast).getByText(/18,400 of the podcast’s 44,000 characters/)).toBeInTheDocument()
  })
})
