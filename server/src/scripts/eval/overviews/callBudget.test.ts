import { describe, it, expect } from 'vitest'
import { arm, estimateCallUsd } from '../models.js'
import type { PlannedCall } from '../types.js'
import { estimateCalls, refusal, type CallEstimate } from './callBudget.js'

const call = (prompt: string): PlannedCall => ({ arm: arm('gpt-6-luna', 'low'), schemaName: 'name', prompt, baseOutputTokens: 1500 })

const ledger = (cached: string[] = [], spent = 0) => ({ isCached: (c: PlannedCall) => cached.includes(c.prompt), spentUsd: () => spent })

describe('estimateCalls', () => {
  it('prices only the calls the cache cannot answer', () => {
    const calls = [call('a'), call('b'), call('c')]
    expect(estimateCalls(ledger(['a']), calls)).toEqual({ calls: 3, uncached: 2, usd: estimateCallUsd(call('b')) + estimateCallUsd(call('c')) })
  })
})

describe('refusal', () => {
  const estimate = (uncached: number, usd: number): CallEstimate => ({ calls: 5, uncached, usd })

  it('lets a pass the cache answers in full run, with the budget spent and no API key', () => {
    expect(refusal(estimate(0, 0), ledger([], 3), { budgetUsd: 3, canCall: false })).toBeNull()
  })

  it('refuses uncached calls without the API key', () => {
    expect(refusal(estimate(2, 0.01), ledger(), { budgetUsd: 3, canCall: false })).toContain('OPENAI_API_KEY')
  })

  it('refuses uncached calls whose estimate exceeds what is left of the budget, and lets them run within it', () => {
    expect(refusal(estimate(2, 1.5), ledger([], 2), { budgetUsd: 3, canCall: true })).toContain('exceeds')
    expect(refusal(estimate(2, 0.5), ledger([], 2), { budgetUsd: 3, canCall: true })).toBeNull()
  })
})
