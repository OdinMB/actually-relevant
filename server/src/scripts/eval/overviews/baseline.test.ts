import { describe, it, expect } from 'vitest'
import { median, summarizeBaseline, type BaselineRun } from './baseline.js'

const run = (extra: Partial<BaselineRun>): BaselineRun => ({
  trigger: 'pipeline',
  status: 'completed',
  verdict: 'keep',
  costUsd: 0.05,
  tavilyCredits: 4,
  hasResult: true,
  creditUsd: 0.008,
  startedAt: new Date('2026-11-14T02:20:00Z'),
  ...extra,
})

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('summarizeBaseline', () => {
  const runs = [
    run({ trigger: 'editor', costUsd: 0.05, tavilyCredits: 4, startedAt: new Date('2026-11-15T10:00:00Z') }),
    run({ verdict: 'fallback', costUsd: 0.02, tavilyCredits: 2 }),
    run({ costUsd: 0.1, tavilyCredits: 0, creditUsd: null }),
    run({ status: 'failed', verdict: null, costUsd: 0, tavilyCredits: 0, hasResult: false, creditUsd: null }),
    run({ status: 'running', verdict: null, costUsd: 0.25, tavilyCredits: 0, hasResult: false, creditUsd: null }),
  ]
  const b = summarizeBaseline(runs)

  it('counts every run in the window by trigger and by verdict, newest run as the anchor', () => {
    expect(b).toMatchObject({ anchor: '2026-11-15T10:00:00.000Z', runs: 5, measured: 3, unmeasured: 2 })
    expect(b.byTrigger).toEqual([
      ['pipeline', 4],
      ['editor', 1],
    ])
    expect(b.byVerdict).toEqual([
      ['keep', 2],
      ['fallback', 1],
      ['(failed, no verdict)', 1],
      ['(running, no verdict)', 1],
    ])
  })

  it("takes the cost of the runs with a stored result only: a reservation or a skipped run is not a run's cost", () => {
    expect(b.cost.n).toBe(3)
    expect(b.cost.mean).toBeCloseTo(0.17 / 3, 10)
    expect(b.cost.median).toBe(0.05)
    expect(b.cost.p90).toBe(0.1)
    expect(b.credits.mean).toBe(2)
    expect(b.credits.usdMean).toBeCloseTo(0.016, 10)
  })

  it('subtracts the credits from the cost where the run records their price, else keeps the cost as stored', () => {
    expect(b.model.n).toBe(3)
    expect(b.model.mean).toBeCloseTo((0.05 - 0.032 + (0.02 - 0.016) + 0.1) / 3, 10)
    expect(b.modelAsStored).toBe(1)
  })

  it('reads a price stored as text, and gives empty statistics for an empty window', () => {
    expect(summarizeBaseline([run({ creditUsd: '0.008' })]).model.mean).toBeCloseTo(0.018, 10)
    expect(summarizeBaseline([])).toMatchObject({ anchor: null, runs: 0, cost: { n: 0, mean: null, median: null, p90: null } })
  })
})
