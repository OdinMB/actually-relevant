import { describe, it, expect, afterEach } from 'vitest'
import { config } from '../config.js'
import { _setProcessStartedAt, staleBefore } from './storyContextStale.js'

const NOW = new Date('2026-11-17T01:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

describe('staleBefore', () => {
  const scheduling = config.scheduler.enabled
  afterEach(() => {
    config.scheduler.enabled = scheduling
    _setProcessStartedAt(new Date(0))
  })

  it('counts a run as cut off once it is older than the stale limit', () => {
    _setProcessStartedAt(minutesAgo(config.storyContext.staleRunMinutes + 60))
    expect(staleBefore(NOW)).toEqual(minutesAgo(config.storyContext.staleRunMinutes))
  })

  it('counts every run from before this process started as cut off: the process that ran it is gone', () => {
    config.scheduler.enabled = true
    _setProcessStartedAt(minutesAgo(10))
    expect(staleBefore(NOW)).toEqual(minutesAgo(10))
  })

  it('waits out the stale limit in a second process, which cannot tell the scheduling process’s live runs from dead ones', () => {
    config.scheduler.enabled = false
    _setProcessStartedAt(minutesAgo(10))
    expect(staleBefore(NOW)).toEqual(minutesAgo(config.storyContext.staleRunMinutes))
  })
})
