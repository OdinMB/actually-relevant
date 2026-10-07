import { describe, it, expect } from 'vitest'
import type { JobName, JobRun } from '@shared/types'
import { needsAlertChannelWarning } from './AlertChannelWarning'

function job(jobName: JobName, enabled: boolean): JobRun {
  return {
    id: jobName,
    jobName,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSucceededAt: null,
    lastError: null,
    enabled,
    running: false,
    cronExpression: '0 2 * * 5',
    timeZone: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }
}

describe('needsAlertChannelWarning', () => {
  it('warns when a podcast job is enabled and the server has no alert channel', () => {
    expect(needsAlertChannelWarning([job('generate_podcast', true), job('publish_podcast', false)], false)).toBe(true)
    expect(needsAlertChannelWarning([job('generate_podcast', false), job('publish_podcast', true)], false)).toBe(true)
  })

  it('stays quiet when an alert channel is set, or while the answer is unknown', () => {
    const jobs = [job('generate_podcast', true)]
    expect(needsAlertChannelWarning(jobs, true)).toBe(false)
    expect(needsAlertChannelWarning(jobs, undefined)).toBe(false)
  })

  it('stays quiet when only other jobs are enabled', () => {
    expect(needsAlertChannelWarning([job('crawl_feeds', true), job('generate_podcast', false)], false)).toBe(false)
  })
})
