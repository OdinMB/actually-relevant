import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { JobRun } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { JobTable, OtherJobRows } from './jobTable'
import { makeJobRun as job, makeRunUsage } from '../../test/jobs'

function renderTable(jobs: JobRun[], heading = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <JobTable>
          <OtherJobRows jobs={jobs} heading={heading} onOpen={() => {}} />
        </JobTable>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('OtherJobRows', () => {
  it('lists the jobs in pipeline order, under an Other jobs heading when asked for one', () => {
    renderTable([job('publish_stories'), job('crawl_feeds')], true)
    expect(screen.getByRole('columnheader', { name: 'Other jobs' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^(Crawl Feeds|Publish Stories)$/ }).map(b => b.textContent)).toEqual(['Crawl Feeds', 'Publish Stories'])
  })

  it("puts a job's note behind an info button named for the job, and shows no button for a job without one", () => {
    renderTable([job('research_stories', { note: 'Researches each selected story.' }), job('crawl_feeds')])

    const info = screen.getByRole('button', { name: 'About Research Stories' })
    expect(info).toHaveAccessibleDescription('Researches each selected story.')
    expect(screen.getByText('Researches each selected story.')).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'About Crawl Feeds' })).not.toBeInTheDocument()
  })

  it('keeps a warning visible under the job name', () => {
    renderTable([job('research_stories', { note: 'Researches each selected story.', warning: 'Research is off.' })])
    expect(screen.getByText('Research is off.')).toBeVisible()
  })

  it('offers a Flex switch only for a job that makes AI calls', () => {
    renderTable([job('generate_newsletter', { usesModels: true, flex: true }), job('poll_plunk_activity')])
    expect(screen.getByRole('switch', { name: 'Stop using flex processing for Generate Newsletter' })).toBeChecked()
    expect(screen.queryByRole('switch', { name: /flex processing for Plunk Complaints/ })).not.toBeInTheDocument()
  })

  it("shows the last run's length and cost, the cost explained", () => {
    renderTable([
      job('generate_newsletter', {
        lastStartedAt: '2026-11-16T04:00:00Z',
        lastCompletedAt: '2026-11-16T04:12:00Z',
        lastRunUsage: makeRunUsage({ calls: 3, flexCalls: 3, costUsd: 0.21, standardCostUsd: 0.42 }),
      }),
    ])
    expect(screen.getByText('12 min')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$0.21' })).toHaveAccessibleDescription('3 AI calls, 3 at flex price, $0.42 at standard price')
  })
})
