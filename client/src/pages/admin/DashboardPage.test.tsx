import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { JobRun, SpendingRow, SpendScope } from '@shared/types'
import { makeJobRun } from '../../test/jobs'
import { renderAdminRoutes } from '../../test/admin'
import { adminApi } from '../../lib/admin-api'
import DashboardPage from './DashboardPage'

const row = (scope: SpendScope, over: Partial<SpendingRow> = {}): SpendingRow => ({
  scope,
  thisMonth: { aiUsd: 1, searchUsd: 0, totalUsd: 1 },
  paceUsd: 1.88,
  previousUsd: [2, 2],
  levelUsd: null,
  warning: null,
  ...over,
})

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: {
    stories: {
      recentStats: vi.fn(),
    },
    spending: { overview: vi.fn() },
    notices: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, unseenCount: 0 }),
    },
    feedback: { list: vi.fn() },
    jobs: { list: vi.fn(), continueChain: vi.fn() },
    cache: {
      clear: vi.fn().mockResolvedValue({ caches: [{ name: 'homepage', entries: 3 }], entries: 3 }),
    },
  },
}))

const api = vi.mocked(adminApi, true)

function renderDashboard(path = '/admin') {
  return renderAdminRoutes(
    [
      { path: '/admin', element: <DashboardPage /> },
      { path: '/admin/spending', element: <h1>Spending page</h1> },
    ],
    { history: [path] },
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.stories.recentStats.mockResolvedValue([
      { days: 7, crawled: 1200, screened: 1100, assessed: 300, published: 21 },
      { days: 30, crawled: 5000, screened: 4900, assessed: 1200, published: 90 },
    ])
    api.spending.overview.mockResolvedValue({
      month: '2026-11',
      previousMonths: ['2026-10', '2026-09'],
      day: 16,
      daysInMonth: 30,
      groups: [{ chain: 'daily_edition_chain', rows: [row('research_stories', { levelUsd: 25, warning: 'on_pace' })] }],
      total: row('all', { thisMonth: { aiUsd: 30, searchUsd: 17, totalUsd: 47 }, paceUsd: 88.13, previousUsd: [61.5, 40] }),
      voices: { usedChars: 0, capChars: 44_000 },
    })
    api.feedback.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, unreadCount: 0 })
    api.jobs.list.mockResolvedValue([])
    api.jobs.continueChain.mockResolvedValue({ message: 'ok' })
  })

  it('lists the chains waiting for review or stopped at a step, and continues one; a chain held for its time is not listed', async () => {
    const chainJob = (jobName: Parameters<typeof makeJobRun>[0], over: Partial<JobRun>) =>
      makeJobRun(jobName, { steps: ['crawl_feeds'], canContinue: true, ...over })
    api.jobs.list.mockResolvedValue([
      chainJob('newsletter_chain', { resumeStep: 'publish_newsletter', resumeReason: 'review' }),
      chainJob('daily_edition_chain', { resumeStep: 'research_stories', resumeReason: 'failed' }),
      chainJob('podcast_chain', { resumeStep: 'publish_podcast', resumeReason: 'waiting', resumeAt: '2026-11-21T06:00:00Z' }),
      chainJob('intake_chain', { canContinue: false }),
    ])
    renderDashboard()
    const card = (await screen.findByRole('heading', { name: 'Waiting on you' })).closest('section')!
    expect(within(card).getByText(/waiting for your review\. Publish Newsletter runs next\./)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open newsletters' })).toHaveAttribute('href', '/admin/newsletters')
    expect(within(card).getByText(/stopped at Research Stories/)).toBeInTheDocument()
    expect(within(card).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(card).getByRole('button', { name: 'Continue with Publish Newsletter' }))
    await waitFor(() => expect(api.jobs.continueChain).toHaveBeenCalledWith('newsletter_chain'))
  })

  it('shows no Waiting on you card when no chain waits', async () => {
    renderDashboard()
    await screen.findByText('$47.00')
    expect(screen.queryByRole('heading', { name: 'Waiting on you' })).not.toBeInTheDocument()
  })

  it('shows stories crawled, screened, assessed and published in the last 7 and 30 days, linking to the stats page', async () => {
    renderDashboard()
    const week = (await screen.findByRole('heading', { name: 'Last 7 days' })).parentElement!
    expect(within(week).getByText('1,200')).toBeInTheDocument()
    expect(within(week).getByText('92% of crawled')).toBeInTheDocument()
    expect(within(week).getByText('21')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Last 30 days' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all stats' })).toHaveAttribute('href', '/admin/stats')
  })

  it("shows this month's spending, the pace, last month and any warning, linking to the Spending page", async () => {
    renderDashboard()
    expect(await screen.findByText('$47.00')).toBeInTheDocument()
    expect(screen.getByText('$88.13')).toBeInTheDocument()
    expect(screen.getByText('October')).toBeInTheDocument()
    expect(screen.getByText('$61.50')).toBeInTheDocument()
    expect(screen.getByText('Research Stories on pace to pass $25')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See spending per job' })).toHaveAttribute('href', '/admin/spending')
  })

  it('lists unread feedback, and hides the card when there is none', async () => {
    api.feedback.list.mockResolvedValue({
      items: [
        {
          id: 'f1',
          category: 'bug',
          message: 'The search box does nothing',
          email: null,
          status: 'unread',
          createdAt: '2026-11-17T10:00:00Z',
          updatedAt: '2026-11-17T10:00:00Z',
          storyId: null,
          story: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
      unreadCount: 1,
    })
    renderDashboard()
    expect(await screen.findByText('The search box does nothing')).toBeInTheDocument()
    expect(api.feedback.list).toHaveBeenCalledWith({ status: 'unread', page: 1, limit: 5 })
    expect(screen.getByRole('link', { name: 'Open feedback' })).toHaveAttribute('href', '/admin/feedback?status=unread')
  })

  it('shows no unread feedback card when there is none', async () => {
    renderDashboard()
    await screen.findByText('$47.00')
    expect(screen.queryByText('Unread feedback')).not.toBeInTheDocument()
  })

  it('offers a retry when the story numbers or the spending fail to load', async () => {
    api.stories.recentStats.mockRejectedValueOnce(new Error('boom'))
    api.spending.overview.mockRejectedValueOnce(new Error('boom'))
    renderDashboard()
    await screen.findByText('Failed to load story numbers')
    await screen.findByText('Failed to load spending')
    const retries = screen.getAllByRole('button', { name: /try again/i })
    expect(retries).toHaveLength(2)
    retries.forEach(button => fireEvent.click(button))
    expect(await screen.findByRole('heading', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(await screen.findByText('$47.00')).toBeInTheDocument()
  })

  it('sends an old spending notice link on to the Spending page', async () => {
    renderDashboard('/admin#spending')
    expect(await screen.findByRole('heading', { name: 'Spending page' })).toBeInTheDocument()
  })

  it('clears the site cache and says how much it dropped', async () => {
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Clear site cache' }))
    expect(await screen.findByText(/Site cache cleared \(3 cached items\)/)).toBeInTheDocument()
    expect(api.cache.clear).toHaveBeenCalledTimes(1)
  })

  it('says so when clearing the site cache fails', async () => {
    api.cache.clear.mockRejectedValueOnce(new Error('network'))
    renderDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Clear site cache' }))
    expect(await screen.findByText('Failed to clear the site cache')).toBeInTheDocument()
  })
})
