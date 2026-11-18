import { describe, it, expect, afterEach } from 'vitest'
import { config } from '../config.js'
import { passStaleBefore } from '../services/researchPassQueue.js'
import { staleBefore } from '../services/storyContextStale.js'
import { _setProcessStartedAt, cutOffBefore } from './runCutOff.js'

const NOW = new Date('2026-11-17T01:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const LIMIT = 120

describe('cutOffBefore', () => {
  const scheduling = config.scheduler.enabled
  afterEach(() => {
    config.scheduler.enabled = scheduling
    _setProcessStartedAt(null)
  })

  it('counts a run as cut off once it is older than the stale limit', () => {
    _setProcessStartedAt(minutesAgo(LIMIT + 60))
    expect(cutOffBefore(NOW, LIMIT)).toEqual(minutesAgo(LIMIT))
  })

  it('counts every run from before this process started as cut off: the process that ran it is gone', () => {
    config.scheduler.enabled = true
    _setProcessStartedAt(minutesAgo(10))
    expect(cutOffBefore(NOW, LIMIT)).toEqual(minutesAgo(10))
  })

  it('waits out the stale limit in a second process, which cannot tell the scheduling process’s live runs from dead ones', () => {
    config.scheduler.enabled = false
    _setProcessStartedAt(minutesAgo(10))
    expect(cutOffBefore(NOW, LIMIT)).toEqual(minutesAgo(LIMIT))
  })

  it("applies each kind of run's own limit: a context run's, and a research pass's, sized for research's and context's calls with a second attempt", () => {
    config.scheduler.enabled = false
    expect(staleBefore(NOW)).toEqual(minutesAgo(config.storyContext.staleRunMinutes))
    expect(passStaleBefore(NOW)).toEqual(minutesAgo(config.research.pass.staleRunMinutes))
    expect(config.research.pass.staleRunMinutes).toBeGreaterThanOrEqual(2 * (config.research.staleRunMinutes + config.storyContext.staleRunMinutes))
  })
})
