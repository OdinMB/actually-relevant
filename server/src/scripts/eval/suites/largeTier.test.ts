import { describe, it, expect } from 'vitest'
import { decideSelection, type SelectionArmMetrics } from './largeTier.js'

const base: SelectionArmMetrics = {
  exactCount: 1,
  invalidIds: 0,
  declined: 0,
  failures: 0,
  jaccardStored: 0.6,
  jaccardOther: 0.7,
  upliftingShare: 0.3,
}
const B = 'gpt-6-sol@medium'
const S = 'gpt-6.1-sol@medium'

describe('decideSelection', () => {
  it('requires 100% exact-count compliance when the baseline achieves it', () => {
    expect(decideSelection({ [B]: base, [S]: { ...base, exactCount: 0.95 } }, B, S).verdict.kind).toBe('none')
    expect(decideSelection({ [B]: base, [S]: base }, B, S).verdict).toMatchObject({ kind: 'winner', arm: S })
  })

  it("relaxes the bar to the baseline's own rate only when the baseline misses 100%", () => {
    const missing = { ...base, exactCount: 0.9 }
    expect(decideSelection({ [B]: missing, [S]: { ...base, exactCount: 0.9 } }, B, S).verdict.kind).toBe('winner')
    expect(decideSelection({ [B]: missing, [S]: { ...base, exactCount: 0.85 } }, B, S).verdict.kind).toBe('none')
  })

  it('does not pass the candidate when no groups were evaluated', () => {
    const empty = { ...base, exactCount: null }
    expect(decideSelection({ [B]: empty, [S]: empty }, B, S).verdict.kind).toBe('none')
  })

  it('fails the candidate when it declines more often than the baseline, naming the baseline model', () => {
    const d = decideSelection({ [B]: base, [S]: { ...base, declined: 2 } }, B, S)
    expect(d.verdict.kind === 'none' && d.verdict.reasons.join()).toMatch(/2 declined\/empty responses \(gpt-6-sol 0\)/)
  })
})
