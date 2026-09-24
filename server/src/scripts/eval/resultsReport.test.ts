import { describe, it, expect } from 'vitest'
import { recommendTierSettings, monthlyCost, baselineWins, candidateWins, VOLUMES } from './resultsReport.js'
import type { ArmStats, CallSiteId, CallSiteResult, Decision, MetricRow } from './types.js'

function stats(arm: string, meanCostUsd: number): ArmStats {
  return {
    arm, calls: 1, outcomes: { ok: 1, parse_failure: 0, empty: 0, truncated: 0, error: 0, skipped: 0 },
    latencyP50: 1, latencyP95: 1, meanUsage: { input: 0, cached: 0, output: 0, reasoning: 0 }, meanCostUsd, totalCostUsd: meanCostUsd,
  }
}

function site(id: CallSiteId, passing: string[], extra: Partial<CallSiteResult> = {}): CallSiteResult {
  const decision: Decision = passing.length > 0
    ? { verdict: { kind: 'winner', arm: passing[0], evidence: [] }, passing }
    : { verdict: { kind: 'none', reasons: ['failed'] }, passing: [] }
  return { id, title: id, baseline: 'b', candidates: [], stats: [], metrics: [], decision, notes: [], ...extra }
}

describe('recommendTierSettings', () => {
  it('picks the small-tier effort that passes dedup, related and pre-assess', () => {
    const recs = recommendTierSettings([
      site('dedup', ['gpt-6-luna@medium']),
      site('related', ['gpt-6-luna@low', 'gpt-6-luna@medium']),
      site('preassess', ['gpt-6-luna@low', 'gpt-6-luna@medium']),
      site('assess', ['gpt-6-luna@medium', 'gpt-6-luna@high']),
      site('social-pick', ['gpt-6-luna@medium']),
    ])
    expect(recs.find(r => r.tier === 'small')).toMatchObject({ model: 'gpt-6-luna', effort: 'medium' })
    expect(recs.find(r => r.tier === 'medium')).toMatchObject({ model: 'gpt-6-luna', effort: 'medium' })
  })

  it('uses the lowest effort every medium-tier call site passes at', () => {
    const recs = recommendTierSettings([
      site('preassess', ['gpt-6-luna@low', 'gpt-6-luna@medium']),
      site('assess', ['gpt-6-luna@high']),
      site('social-pick', ['gpt-6-luna@medium']),
    ])
    const medium = recs.find(r => r.tier === 'medium')
    expect(medium).toMatchObject({ model: 'gpt-6-luna', effort: 'high' })
    expect(medium?.notes.join()).toMatch(/not tested at high/)
  })

  it('makes no small-tier recommendation when a call site has no passing arm', () => {
    const recs = recommendTierSettings([site('dedup', []), site('related', ['gpt-6-luna@low']), site('preassess', ['gpt-6-luna@low'])])
    expect(recs.find(r => r.tier === 'small')).toMatchObject({ model: null, effort: null })
  })

  it('recommends Sol for the large tier only when all four call sites pass', () => {
    const large = ['selection', 'newsletter-select', 'newsletter-intro', 'podcast'] as const
    const pass = recommendTierSettings(large.map(id => site(id, ['gpt-6-sol@medium'])))
    expect(pass.find(r => r.tier === 'large')).toMatchObject({ model: 'gpt-6-sol', effort: 'medium' })
    const fail = recommendTierSettings([...large.slice(0, 3).map(id => site(id, ['gpt-6-sol@medium'])), site('podcast', [])])
    expect(fail.find(r => r.tier === 'large')).toMatchObject({ model: 'gpt-5.2' })
  })
})

describe('monthlyCost', () => {
  it('is mean $/call times the low and high monthly volume', () => {
    const s = site('assess', [], { stats: [stats('gpt-6-luna@medium', 0.003)] })
    expect(monthlyCost(s, 'gpt-6-luna@medium')).toEqual({ low: 0.003 * VOLUMES.assess.low, high: 0.003 * VOLUMES.assess.high })
  })

  it('is null for an arm that did not run', () => {
    expect(monthlyCost(site('assess', []), 'gpt-6-luna@medium')).toBeNull()
  })
})

describe('baselineWins', () => {
  it('lists metrics where the baseline beats the candidate in the better direction', () => {
    const rows: MetricRow[] = [
      { name: 'exact', values: { b: '100%', c: '90%' }, raw: { b: 1, c: 0.9 }, better: 'higher' },
      { name: 'declines', values: { b: '0', c: '0' }, raw: { b: 0, c: 0 }, better: 'lower' },
      { name: 'info', values: { b: '1', c: '2' }, raw: { b: 1, c: 2 } },
    ]
    expect(baselineWins(site('selection', [], { baseline: 'b', candidates: ['c'], metrics: rows }))).toEqual(['selection: exact (b 100% vs c 90%)'])
  })

  it('also counts lower latency and lower cost per call as wins', () => {
    const fast = { ...stats('b', 0.01), latencyP50: 900, latencyP95: 2000 }
    const slow = { ...stats('c', 0.02), latencyP50: 1500, latencyP95: 1800 }
    const s = site('podcast', [], { baseline: 'b', candidates: ['c'], stats: [fast, slow] })
    expect(baselineWins(s)).toEqual([
      'podcast: median latency (b 900 ms vs c 1500 ms)',
      'podcast: cost per call (b $0.0100 vs c $0.0200)',
    ])
    expect(candidateWins(s)).toEqual(['podcast: 95th-percentile latency (c 1800 ms vs b 2000 ms)'])
  })
})
