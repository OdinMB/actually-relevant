import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { axe } from 'vitest-axe'
import type { JobRun } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { ChainCard } from './ChainCard'
import { makeJobRun } from '../../test/jobs'

const mockApi = vi.hoisted(() => ({ update: vi.fn(), continueChain: vi.fn(), list: vi.fn(), run: vi.fn(), serverTime: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/admin-api')>()
  return { ...actual, adminApi: { ...actual.adminApi, jobs: mockApi } }
})

const chain = (overrides: Partial<JobRun> = {}) =>
  makeJobRun('daily_edition_chain', {
    cronExpression: '0 23 * * *',
    flexHours: 4.5,
    steps: ['select_stories', 'research_stories', 'publish_stories'],
    ...overrides,
  })
const steps = () => [
  makeJobRun('select_stories', { chain: 'daily_edition_chain', usesModels: true }),
  makeJobRun('research_stories', { chain: 'daily_edition_chain', usesModels: true, pauseForReview: true }),
  makeJobRun('publish_stories', { chain: 'daily_edition_chain', enabled: false }),
]

function renderCard(c: JobRun = chain()) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <ChainCard chain={c} steps={steps()} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ChainCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.update.mockResolvedValue({})
    mockApi.continueChain.mockResolvedValue({ message: 'ok' })
    mockApi.list.mockResolvedValue([])
  })

  it('lists the steps in order, each with its Enabled and Review switches, and Flex only where a step makes AI calls', () => {
    renderCard()
    const checked = (pattern: RegExp) => screen.getAllByRole('switch', { name: pattern }).map(s => s.getAttribute('aria-checked'))
    // The chain's own switch in the Whole chain row, then the three steps under it
    expect(checked(/^(Enable|Disable) /)).toEqual(['true', 'true', 'true', 'false'])
    expect(screen.getByRole('switch', { name: 'Disable Daily Edition' })).toBeInTheDocument()
    expect(checked(/review after/)).toEqual(['false', 'true', 'false'])
    expect(screen.getByRole('switch', { name: 'Use flex processing for Select Stories' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /flex processing for Publish Stories/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Flex for/)).toHaveValue('4.5')
  })

  it("explains the Flex column's switch and the Whole chain row's hours, counted from the start of each run", () => {
    renderCard()
    expect(screen.getByRole('button', { name: 'About Flex' })).toHaveAccessibleDescription(
      /half price.*Whole chain row.*hours.*since the run started.*standard price/,
    )
    expect(screen.getByRole('button', { name: 'About Review' })).toBeInTheDocument()
  })

  it("puts the chain's own schedule, switch, flex hours, status and actions in a Whole chain row above its steps", () => {
    renderCard(chain({ lastStartedAt: '2026-11-16T23:00:00Z', lastCompletedAt: '2026-11-16T23:06:00Z', lastRunSummary: 'Published 4 stories' }))
    const total = screen.getByRole('rowheader', { name: /Whole chain/ }).closest('tr')!
    expect(total.parentElement!.firstElementChild).toBe(total)
    expect(within(total).getAllByRole('button', { name: /Daily at 11:00 PM/ }).length).toBeGreaterThan(0)
    expect(within(total).getByRole('switch', { name: 'Disable Daily Edition' })).toBeInTheDocument()
    expect(within(total).getByLabelText(/^Flex for/)).toHaveValue('4.5')
    expect(within(total).getByText('6 min')).toBeInTheDocument()
    // What each step did is in its own row, not repeated here
    expect(within(total).queryByText('Published 4 stories')).not.toBeInTheDocument()
    expect(within(total).getByRole('button', { name: 'Run Daily Edition' })).toBeInTheDocument()
    expect(within(total).getByRole('button', { name: 'Details of Daily Edition' })).toBeInTheDocument()
  })

  it("saves a step's Review and Enabled switches", async () => {
    renderCard()
    await userEvent.click(screen.getByRole('switch', { name: 'Wait for review after Publish Stories' }))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('publish_stories', { pauseForReview: true }))
    await userEvent.click(screen.getByRole('switch', { name: 'Enable Publish Stories' }))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('publish_stories', { enabled: true }))
  })

  it('saves changed flex hours, an emptied field as flex the whole run', async () => {
    renderCard()
    const flex = screen.getByLabelText(/^Flex for/)
    await userEvent.clear(flex)
    await userEvent.type(flex, '2,25')
    await userEvent.tab()
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('daily_edition_chain', { flexHours: 2.25 }))
  })

  it('saves an emptied flex field as no cut-off', async () => {
    renderCard()
    await userEvent.clear(screen.getByLabelText(/^Flex for/))
    await userEvent.tab()
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('daily_edition_chain', { flexHours: null }))
  })

  it('saves nothing for hours that are not quarter hours from 0.25 to 48, puts the value back and says why', async () => {
    renderCard()
    const flex = screen.getByLabelText(/^Flex for/)
    for (const value of ['0', '4.1', '49', 'five', '05:00']) {
      await userEvent.clear(flex)
      await userEvent.type(flex, value)
      await userEvent.tab()
    }
    expect(mockApi.update).not.toHaveBeenCalled()
    expect(flex).toHaveValue('4.5')
    expect(await screen.findAllByText(/quarter hours/)).not.toHaveLength(0)
  })

  it('shows a chain waiting for review and continues it', async () => {
    renderCard(chain({ canContinue: true, resumeStep: 'publish_stories', resumeReason: 'review' }))
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for review. Publish Stories runs next.')
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Publish Stories' }))
    await waitFor(() => expect(mockApi.continueChain).toHaveBeenCalledWith('daily_edition_chain'))
  })

  it('shows a chain stopped at a step, with a way to resume from it', () => {
    renderCard(chain({ canContinue: true, resumeStep: 'research_stories', resumeReason: 'failed', lastError: 'Stopped at research_stories' }))
    expect(screen.getByRole('status')).toHaveTextContent('Stopped at Research Stories.')
    expect(screen.getByRole('button', { name: 'Resume from Research Stories' })).toBeInTheDocument()
  })

  it('shows a chain held for a step’s time, with a way to run that step now', async () => {
    renderCard(chain({ canContinue: true, resumeStep: 'publish_stories', resumeReason: 'waiting', resumeAt: '2026-11-17T11:30:00.000Z' }))
    expect(screen.getByRole('status')).toHaveTextContent('Publish Stories runs at 11:30 UTC.')
    await userEvent.click(screen.getByRole('button', { name: 'Run Publish Stories now' }))
    await waitFor(() => expect(mockApi.continueChain).toHaveBeenCalledWith('daily_edition_chain'))
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = renderCard(chain({ canContinue: true, resumeStep: 'publish_stories', resumeReason: 'review' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
