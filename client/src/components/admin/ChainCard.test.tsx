import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
    flexUntil: '03:30',
    deadline: '05:00',
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
    // The chain's own switch, then its three steps
    expect(checked(/^(Enable|Disable) /)).toEqual(['true', 'true', 'true', 'false'])
    expect(checked(/review after/)).toEqual(['false', 'true', 'false'])
    expect(screen.getByRole('switch', { name: 'Use flex processing for Select Stories' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /flex processing for Publish Stories/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Flex until/)).toHaveValue('03:30')
    expect(screen.getByLabelText(/^Done by/)).toHaveValue('05:00')
  })

  it('explains the clock times behind info buttons', () => {
    renderCard()
    expect(screen.getByRole('button', { name: 'About Flex until' })).toHaveAccessibleDescription('From this time on, AI calls go at standard price.')
    expect(screen.getByRole('button', { name: 'About Done by' })).toHaveAccessibleDescription('From this time on, research starts no other story.')
    expect(screen.getByRole('button', { name: 'About Review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About Flex' })).toBeInTheDocument()
  })

  it("saves a step's Review and Enabled switches", async () => {
    renderCard()
    await userEvent.click(screen.getByRole('switch', { name: 'Wait for review after Publish Stories' }))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('publish_stories', { pauseForReview: true }))
    await userEvent.click(screen.getByRole('switch', { name: 'Enable Publish Stories' }))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('publish_stories', { enabled: true }))
  })

  it('saves a changed clock time, and an emptied one as none', async () => {
    renderCard()
    const deadline = screen.getByLabelText(/^Done by/)
    await userEvent.clear(deadline)
    await userEvent.tab()
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('daily_edition_chain', { deadline: null }))
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
