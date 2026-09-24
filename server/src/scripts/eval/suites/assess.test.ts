import { describe, it, expect } from 'vitest'
import { decideAssess, scoreAssess, type AssessArmMetrics } from './assess.js'
import { ASSESS_FORMAT_CHECKS, type AssessFormatCheck } from '../checks.js'
import type { AssessItem } from '../fixtures.js'
import type { CallRecord } from '../types.js'
import type { AssessResult } from '../../../schemas/llm.js'

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
  atLeastSplit: 0.4,
  storedAtLeastSplit: 0.4,
}

describe('scoreAssess calibration', () => {
  const story = (id: string, rating: number): AssessItem => ({
    id, title: id, content: '', publisher: 'P', url: 'u', guidelines: { factors: '', antifactors: '', ratings: '' }, language: 'en', han: false, stored: { rating },
  })
  const rec = (rating: number): CallRecord<AssessResult> => ({
    key: 'k', arm: 'm@medium', schema: 'assess', outcome: 'ok', content: '{}', finishReason: 'stop',
    usage: { input: 0, cached: 0, output: 0, reasoning: 0 }, costUsd: 0, latencyMs: 0, at: '',
    parsed: {
      titleLabel: 'Label', relevanceTitle: 'Title', summary: 's', quote: 'q', quoteAttribution: 'a', factors: [], limitingFactors: [],
      relevanceCalculation: [], conservativeRating: rating, relevanceSummary: 'r', marketingBlurb: 'b', publicationDate: '2026-01-01 00:00:00',
    } as unknown as AssessResult,
  })

  it('reports the share of stories this arm and the stored values rate at or above the split', () => {
    const stories = [story('a', 6), story('b', 5), story('c', 3)]
    const records = [rec(5), rec(4), rec(3)]
    const m = scoreAssess(stories, records, records)
    expect(m.atLeastSplit).toBeCloseTo(1 / 3)
    expect(m.storedAtLeastSplit).toBeCloseTo(2 / 3)
    expect(m.vsStored.shift).toBeCloseTo(-2 / 3)
  })
})

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
