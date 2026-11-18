import { describe, it, expect } from 'vitest'
import { config } from '../config.js'
import { callCostUsd, hasPrice, summarizeRunCost } from './researchCost.js'
import type { StepCall, StepName } from './researchPipeline.js'

const luna = config.research.modelPrices['gpt-6-luna']!

const call = (step: StepName, costUsd: number, model = 'gpt-6-luna'): StepCall => ({
  step,
  outcome: 'ok',
  usage: { input: 1000, cached: 200, output: 300, reasoning: 100 },
  costUsd,
  model,
})

describe('callCostUsd', () => {
  it('prices a call to a model with the cache controls as billed: cache writes at the write price, the rest of the uncached input at the input rate', () => {
    const usd = callCostUsd('gpt-6-luna', { input: 1_000_000, cached: 400_000, cacheWrite: 100_000, output: 200_000, reasoning: 50_000 })
    expect(usd).toBeCloseTo(0.5 * luna.input + 0.1 * luna.cacheWrite + 0.4 * luna.cached + 0.2 * luna.output, 10)
  })

  it('reads a usage stored before cache writes were recorded as writing nothing', () => {
    const usd = callCostUsd('gpt-6-luna', { input: 1_000_000, cached: 0, output: 0, reasoning: 0 })
    expect(usd).toBeCloseTo(luna.input, 10)
  })

  it('keeps the upper bound for a model without the controls: its uncached input at the cache-write factor', () => {
    const prices = config.llm.modelPrices
    prices['gpt-5-mini'] = { input: 0.25, cached: 0.025, cacheWrite: 0.25, output: 2 }
    try {
      const usd = callCostUsd('gpt-5-mini', { input: 1_000_000, cached: 400_000, output: 0, reasoning: 0 })
      expect(usd).toBeCloseTo(0.6 * 0.25 * config.research.cacheWriteFactor + 0.4 * 0.025, 10)
    } finally {
      delete prices['gpt-5-mini']
    }
  })

  it('refuses to price a model without a price', () => {
    expect(() => callCostUsd('gpt-unknown', { input: 1, cached: 0, output: 1, reasoning: 0 })).toThrow(/gpt-unknown/)
  })
})

describe('hasPrice', () => {
  it('reports whether a model has a price', () => {
    expect(hasPrice('gpt-6-luna')).toBe(true)
    expect(hasPrice('gpt-5-mini')).toBe(false)
  })
})

describe('summarizeRunCost', () => {
  it('sums calls, tokens and USD per step in step order, with the models each used', () => {
    const s = summarizeRunCost(
      { calls: [call('write', 0.004, 'gpt-6.1-sol'), call('queries', 0.001), call('extract', 0.002), call('extract', 0.003)], credits: 0 },
      0.008,
    )
    expect(s.steps.map(l => l.step)).toEqual(['queries', 'extract', 'write'])
    expect(s.steps[1]).toEqual({
      step: 'extract',
      calls: 2,
      usage: { input: 2000, cached: 400, cacheWrite: 0, output: 600, reasoning: 200 },
      usd: 0.005,
      models: ['gpt-6-luna'],
    })
    expect(s.steps[2]?.models).toEqual(['gpt-6.1-sol'])
    expect(s.model.calls).toBe(4)
    expect(s.model.usd).toBeCloseTo(0.01, 10)
    expect(s.model.models).toEqual(['gpt-6.1-sol', 'gpt-6-luna'])
  })

  it('prices Tavily credits at the given rate and adds them to the total', () => {
    const s = summarizeRunCost({ calls: [call('queries', 0.001)], credits: 4 }, 0.008)
    expect(s.tavily).toEqual({ credits: 4, usd: 0.032 })
    expect(s.totalUsd).toBeCloseTo(0.033, 10)
  })

  it('sums an empty run to nothing', () => {
    const s = summarizeRunCost({ calls: [], credits: 0 }, 0.008)
    expect(s).toEqual({
      steps: [],
      model: { calls: 0, usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, usd: 0, models: [] },
      tavily: { credits: 0, usd: 0 },
      totalUsd: 0,
    })
  })
})
