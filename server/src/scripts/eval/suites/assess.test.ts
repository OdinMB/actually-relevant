import { describe, it, expect } from 'vitest'
import { decideAssess, type AssessArmMetrics } from './assess.js'
import { ASSESS_FORMAT_CHECKS, type AssessFormatCheck } from '../checks.js'

const format = (v: number) => Object.fromEntries(ASSESS_FORMAT_CHECKS.map(k => [k, v])) as Record<AssessFormatCheck, number>

const base: AssessArmMetrics = {
  ok: 50,
  format: format(0.9),
  vsBaseline: { mad: 0, shift: 0, splitAgreement: 1, n: 50 },
  vsStored: { mad: 0.6, shift: 0, splitAgreement: 0.9, n: 50 },
  unsupportedPerOutput: 0.4,
  unsupported: [],
  junk: [],
  failures: 0,
}

const candidate: AssessArmMetrics = { ...base, vsBaseline: { mad: 0.7, shift: 0.1, splitAgreement: 0.88, n: 50 } }

const BASE = 'gpt-5-mini@medium'
const MED = 'gpt-6-luna@medium'
const HIGH = 'gpt-6-luna@high'

describe('decideAssess', () => {
  it('picks the lowest passing effort', () => {
    const d = decideAssess({ [BASE]: base, [MED]: candidate, [HIGH]: candidate }, BASE, [HIGH, MED])
    expect(d.verdict).toMatchObject({ kind: 'winner', arm: MED })
  })

  it('reports no winner with the failing checks', () => {
    const drifting = { ...candidate, vsBaseline: { mad: 1.4, shift: -0.8, splitAgreement: 0.7, n: 50 }, format: format(0.7) }
    const d = decideAssess({ [BASE]: base, [MED]: drifting }, BASE, [MED])
    expect(d.verdict.kind).toBe('none')
    const reasons = d.verdict.kind === 'none' ? d.verdict.reasons.join('\n') : ''
    expect(reasons).toMatch(/mean absolute rating difference/)
    expect(reasons).toMatch(/mean shift/)
    expect(reasons).toMatch(/factorCount/)
  })

  it('relaxes the split-agreement bar only when the baseline rerun misses it', () => {
    const c = { ...candidate, vsBaseline: { ...candidate.vsBaseline, splitAgreement: 0.76 } }
    expect(decideAssess({ [BASE]: base, [MED]: c }, BASE, [MED]).verdict.kind).toBe('none')
    const noisy = { ...base, vsStored: { ...base.vsStored, splitAgreement: 0.8 } }
    expect(decideAssess({ [BASE]: noisy, [MED]: c }, BASE, [MED]).verdict).toMatchObject({ kind: 'winner', arm: MED })
  })

  it('fails a candidate that invents numbers much more often than the baseline', () => {
    const d = decideAssess({ [BASE]: base, [MED]: { ...candidate, unsupportedPerOutput: 0.7 } }, BASE, [MED])
    expect(d.verdict.kind).toBe('none')
  })
})
