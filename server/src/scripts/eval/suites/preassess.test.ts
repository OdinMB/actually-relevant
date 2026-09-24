import { describe, it, expect } from 'vitest'
import { decidePreassess, type PreassessArmMetrics } from './preassess.js'

const good: PreassessArmMetrics = {
  returned: 100, issueAgreement: 0.9, emotionAgreement: 0.85, gateAgreement: 0.9, publishedRecall: 1,
  passRate: 0.4, storedPassRate: 0.4, omitted: 0, unknownIds: 0, invalidSlugs: 0, failures: 0, junk: [],
}

const BASE = 'gpt-5-mini@medium'
const MED = 'gpt-6-luna@medium'
const LOW = 'gpt-6-luna@low'

describe('decidePreassess', () => {
  it('picks the lowest passing effort', () => {
    const d = decidePreassess({ [BASE]: good, [MED]: good, [LOW]: good }, BASE, [MED, LOW])
    expect(d.verdict).toMatchObject({ kind: 'winner', arm: LOW })
  })

  it('falls back to the next effort when the lowest fails', () => {
    const d = decidePreassess({ [BASE]: good, [MED]: good, [LOW]: { ...good, issueAgreement: 0.7 } }, BASE, [MED, LOW])
    expect(d.verdict).toMatchObject({ kind: 'winner', arm: MED })
    expect(d.passing).toEqual([MED])
  })

  it('reports no automated winner with reasons', () => {
    const bad = { ...good, junk: ['issueSlug: 中'], omitted: 3 }
    const d = decidePreassess({ [BASE]: good, [MED]: bad, [LOW]: bad }, BASE, [MED, LOW])
    expect(d.verdict.kind).toBe('none')
    expect(d.verdict.kind === 'none' && d.verdict.reasons.join('\n')).toMatch(/junk/)
    expect(d.verdict.kind === 'none' && d.verdict.reasons.join('\n')).toMatch(/omitted/)
  })

  it('relaxes the agreement bar only when the baseline rerun misses it', () => {
    const candidate = { ...good, issueAgreement: 0.78 }
    const strict = decidePreassess({ [BASE]: good, [MED]: candidate }, BASE, [MED])
    expect(strict.verdict.kind).toBe('none')
    const noisyBaseline = { ...good, issueAgreement: 0.8 }
    const relaxed = decidePreassess({ [BASE]: noisyBaseline, [MED]: candidate }, BASE, [MED])
    expect(relaxed.verdict).toMatchObject({ kind: 'winner', arm: MED })
  })

  it('fails a candidate whose pass rate drifts more than 20% from stored', () => {
    const d = decidePreassess({ [BASE]: good, [MED]: { ...good, passRate: 0.55 } }, BASE, [MED])
    expect(d.verdict.kind).toBe('none')
  })
})
