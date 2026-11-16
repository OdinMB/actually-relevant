import { describe, it, expect } from 'vitest'
import type { JobRunUsage } from '@shared/types'
import { formatDuration, formatUsd, lastRunDurationMs, usageDetails } from './jobRun'

const usage = (overrides: Partial<JobRunUsage> = {}): JobRunUsage => ({
  calls: 0,
  flexCalls: 0,
  flexFallbacks: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  standardCostUsd: 0,
  unpricedCalls: 0,
  otherUsd: 0,
  ...overrides,
})

describe('job run display', () => {
  it('measures the last finished run, and nothing while one runs or before the first', () => {
    expect(lastRunDurationMs({ lastStartedAt: '2026-11-16T23:00:00Z', lastCompletedAt: '2026-11-17T01:30:00Z' })).toBe(9_000_000)
    expect(lastRunDurationMs({ lastStartedAt: '2026-11-17T23:00:00Z', lastCompletedAt: '2026-11-17T01:30:00Z' })).toBeNull()
    expect(lastRunDurationMs({ lastStartedAt: null, lastCompletedAt: null })).toBeNull()
  })

  it('words durations and amounts', () => {
    expect(formatDuration(44_400)).toBe('44s')
    expect(formatDuration(12 * 60_000)).toBe('12 min')
    expect(formatDuration(125 * 60_000)).toBe('2 h 5 min')
    expect(formatDuration(120 * 60_000)).toBe('2 h')
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(0.372)).toBe('$0.37')
  })

  it('explains a cost: calls, flex use and fallbacks, the standard price, searches and unpriced calls', () => {
    expect(usageDetails(usage({ calls: 1 }))).toBe('1 AI call')
    expect(usageDetails(usage({ calls: 40, flexCalls: 38, flexFallbacks: 2, costUsd: 0.6, standardCostUsd: 1.1, otherUsd: 0.1, unpricedCalls: 1 }))).toBe(
      '40 AI calls, 38 at flex price, 2 sent at standard price because flex was busy, $1.10 at standard price, $0.10 of it for web searches, 1 without a known price, not counted',
    )
  })
})
