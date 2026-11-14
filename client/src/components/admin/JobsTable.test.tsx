import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { JobName, JobRun } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { JobsTable } from './JobsTable'

function job(jobName: JobName, overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: jobName,
    jobName,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSucceededAt: null,
    lastError: null,
    enabled: true,
    running: false,
    cronExpression: '0 1 * * *',
    timeZone: null,
    note: null,
    warning: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderTable(jobs: JobRun[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <JobsTable jobs={jobs} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('JobsTable', () => {
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
})
