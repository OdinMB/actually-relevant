import { describe, it, expect } from 'vitest'
import { decidePreassess, scorePreassess, type PreassessArmMetrics } from './preassess.js'
import type { PreassessItem } from '../fixtures.js'
import type { CallRecord } from '../types.js'
import type { PreAssessResult } from '../../../schemas/llm.js'

const good: PreassessArmMetrics = {
  returned: 100, issueAgreement: 0.9, emotionAgreement: 0.85, gateAgreement: 0.9, publishedRecall: 1,
  passRate: 0.4, storedPassRate: 0.4, omitted: 0, unknownIds: 0, invalidSlugs: 0, failures: 0, junk: [],
  meanShift: 0, passRateOneLower: 0.5, publishedRecallOneLower: 1,
}

describe('scorePreassess calibration', () => {
  const item = (id: string, rating: number, status: string): PreassessItem => ({
    id, title: id, content: '', language: 'en', han: false, status, stored: { issueSlug: 'x', rating, emotion: 'calm' },
  })
  const batch = [item('a', 6, 'published'), item('b', 5, 'published'), item('c', 2, 'analyzed')]
  const record = (ratings: number[]): CallRecord<PreAssessResult> => ({
    key: 'k', arm: 'm@medium', schema: 'preassess', outcome: 'ok', content: '{}', finishReason: 'stop',
    usage: { input: 0, cached: 0, output: 0, reasoning: 0 }, costUsd: 0, latencyMs: 0, at: '',
    parsed: { articles: batch.map((s, i) => ({ articleId: s.id, issueSlug: 'x', rating: ratings[i], emotionTag: 'calm' })) } as unknown as PreAssessResult,
  })

  it('reports the mean shift against stored ratings and the funnel one point below the gate', () => {
    const m = scorePreassess([batch], [record([5, 4, 1])], [{ slug: 'x', name: 'X', description: '' }])
    expect(m.meanShift).toBeCloseTo(-1)
    expect(m.publishedRecall).toBeCloseTo(0.5)
    expect(m.publishedRecallOneLower).toBe(1)
    expect(m.passRateOneLower).toBeCloseTo(2 / 3)
  })
})

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
