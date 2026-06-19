import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { JobRun } from '@shared/types'
import { JobStatusBadge } from './JobStatusBadge'

function makeJob(overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: '1',
    jobName: 'crawl_feeds',
    lastStartedAt: null,
    lastCompletedAt: null,
    lastError: null,
    enabled: true,
    running: false,
    cronExpression: '0 1 * * *',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('JobStatusBadge', () => {
  it('shows OK when the last run completed after it started', () => {
    render(<JobStatusBadge job={makeJob({
      lastStartedAt: '2026-06-19T01:00:00.000Z',
      lastCompletedAt: '2026-06-19T01:05:00.000Z',
    })} />)
    expect(screen.getByText('OK')).toBeTruthy()
  })

  it('shows Incomplete when a run started but completion is older (hard kill / OOM)', () => {
    render(<JobStatusBadge job={makeJob({
      lastStartedAt: '2026-06-19T01:00:00.000Z',
      lastCompletedAt: '2026-06-17T01:09:00.000Z',
    })} />)
    expect(screen.getByText('Incomplete')).toBeTruthy()
  })

  it('shows Incomplete when a run started but never completed', () => {
    render(<JobStatusBadge job={makeJob({
      lastStartedAt: '2026-06-19T01:00:00.000Z',
      lastCompletedAt: null,
    })} />)
    expect(screen.getByText('Incomplete')).toBeTruthy()
  })

  it('prefers Error over Incomplete when lastError is set', () => {
    render(<JobStatusBadge job={makeJob({
      lastStartedAt: '2026-06-19T01:00:00.000Z',
      lastCompletedAt: '2026-06-17T01:09:00.000Z',
      lastError: 'boom',
    })} />)
    expect(screen.getByText('Error')).toBeTruthy()
  })

  it('shows Running while in progress regardless of timestamps', () => {
    render(<JobStatusBadge job={makeJob({
      running: true,
      lastStartedAt: '2026-06-19T01:00:00.000Z',
      lastCompletedAt: '2026-06-17T01:09:00.000Z',
    })} />)
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('shows Never run when there is no start timestamp', () => {
    render(<JobStatusBadge job={makeJob()} />)
    expect(screen.getByText('Never run')).toBeTruthy()
  })
})
