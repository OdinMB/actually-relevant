import { describe, it, expect } from 'vitest'
import { ASSESS_FORMAT_CHECKS, type AssessFormatCheck } from './checks.js'
import type { AssessItem, DedupSet, PreassessItem } from './fixtures.js'
import {
  accepted, assessCriteria, dedupCounts, dedupCriteria, dedupMistakes, preassessCriteria, sampleFor, TOLERANCE, type Criterion,
} from './recalibration.js'
import type { AssessArmMetrics } from './suites/assess.js'
import type { PairLabel } from './suites/dedup.js'
import type { PreassessArmMetrics } from './suites/preassess.js'

const preassessItem = (i: number): PreassessItem => ({
  id: `p${i}`, title: '', content: '', language: 'en', han: false, status: i % 3 === 0 ? 'published' : 'rejected',
  stored: { issueSlug: 'x', rating: i % 10, emotion: 'calm' },
})
const assessItem = (i: number): AssessItem => ({
  id: `a${i}`, title: '', content: '', publisher: '', url: '', guidelines: { factors: '', antifactors: '', ratings: '' },
  language: i % 4 === 0 ? 'de' : 'en', han: false, stored: { rating: i % 8 },
})
const dedupSet = (i: number): DedupSet => ({
  sourceId: `s${i}`, kind: i % 2 ? 'hard-negative' : 'random', source: { title: '', summary: '' }, candidates: [],
})
const fx = {
  preassess: Array.from({ length: 30 }, (_, i) => preassessItem(i)),
  assess: Array.from({ length: 20 }, (_, i) => assessItem(i)),
  dedup: Array.from({ length: 12 }, (_, i) => dedupSet(i)),
}

describe('sampleFor', () => {
  it('uses the whole sample for "all"', () => {
    expect(sampleFor(fx, 'all')).toEqual(fx)
  })

  it('splits every check into disjoint halves that together cover the sample', () => {
    const cal = sampleFor(fx, 'calibration')
    const hold = sampleFor(fx, 'holdout')
    for (const part of ['preassess', 'assess', 'dedup'] as const) {
      const a: object[] = cal[part]
      const b: object[] = hold[part]
      expect(a.filter(x => b.includes(x))).toEqual([])
      expect(a.length + b.length).toBe(fx[part].length)
      expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1)
    }
  })

  it('balances published stories between the pre-assessment halves', () => {
    const published = (items: PreassessItem[]) => items.filter(s => s.status === 'published').length
    expect(Math.abs(published(sampleFor(fx, 'calibration').preassess) - published(sampleFor(fx, 'holdout').preassess))).toBeLessThanOrEqual(1)
  })
})

const preassess = (over: Partial<PreassessArmMetrics> = {}): PreassessArmMetrics => ({
  returned: 150, issueAgreement: 0.75, emotionAgreement: 0.72, gateAgreement: 0.86, publishedRecall: 0.8, passRate: 0.31,
  storedPassRate: 0.33, omitted: 0, unknownIds: 0, invalidSlugs: 0, failures: 0, junk: [], meanShift: -0.1,
  passRateOneLower: 0.5, publishedRecallOneLower: 0.95, ...over,
})
const failing = (criteria: Criterion[]) => criteria.filter(c => c.required && !c.pass).map(c => c.name)

describe('preassessCriteria', () => {
  it('accepts an arm inside every tolerance', () => {
    const criteria = preassessCriteria(preassess())
    expect(failing(criteria)).toEqual([])
    expect(accepted(criteria)).toBe(true)
  })

  it('fails an offset beyond ±0.25 in either direction', () => {
    expect(accepted(preassessCriteria(preassess({ meanShift: -TOLERANCE.meanShift - 0.01 })))).toBe(false)
    expect(accepted(preassessCriteria(preassess({ meanShift: 0.3 })))).toBe(false)
  })

  it('fails a gate share more than 5 points from stored, a thin published pass, or worse agreement than phase 1', () => {
    expect(failing(preassessCriteria(preassess({ passRate: 0.27 })))).toHaveLength(1)
    expect(failing(preassessCriteria(preassess({ publishedRecall: 0.74 })))).toHaveLength(1)
    expect(failing(preassessCriteria(preassess({ issueAgreement: 0.73, emotionAgreement: 0.70 })))).toHaveLength(2)
  })

  it('reports the emotion aim without requiring it', () => {
    const criteria = preassessCriteria(preassess({ emotionAgreement: 0.71 }))
    expect(accepted(criteria)).toBe(true)
    expect(criteria.some(c => !c.required && !c.pass)).toBe(true)
  })

  it('never accepts an arm with nothing measured', () => {
    expect(accepted(preassessCriteria(preassess({ meanShift: null, passRate: null, issueAgreement: null })))).toBe(false)
  })
})

const format = (over: Partial<Record<AssessFormatCheck, number>> = {}) =>
  ({ ...Object.fromEntries(ASSESS_FORMAT_CHECKS.map(k => [k, 1])), ...over }) as Record<AssessFormatCheck, number | null>
const assess = (over: Partial<AssessArmMetrics> = {}): AssessArmMetrics => ({
  ok: 25, format: format(), vsBaseline: { mad: null, shift: null, splitAgreement: null, n: 0 },
  vsStored: { mad: 0.7, shift: 0.1, splitAgreement: 0.8, n: 25 }, unsupportedPerOutput: 0.1, unsupported: [], junk: [], failures: 0,
  atLeastSplit: 0.44, storedAtLeastSplit: 0.46, metaCommentary: [], ...over,
})

describe('assessCriteria', () => {
  it('accepts an arm with calibrated ratings and format at least as good as gpt-5-mini', () => {
    expect(failing(assessCriteria(assess({ format: format({ relevanceSummaryWords: 0.8 }) })))).toEqual([])
  })

  it('fails a blurb-length rate below gpt-5-mini', () => {
    expect(failing(assessCriteria(assess({ format: format({ blurbLength: 0.96 }) })))).toEqual(['Format: blurbLength'])
  })

  it('fails an offset or a share rated 5+ outside tolerance', () => {
    expect(failing(assessCriteria(assess({ vsStored: { mad: 1, shift: -0.6, splitAgreement: 0.7, n: 25 }, atLeastSplit: 0.2 })))).toHaveLength(2)
  })

  it('fails as soon as one output talks about its input in published text', () => {
    const one = [{ storyId: 'a1', fields: ['limitingFactors[0]: "The article"'] }]
    expect(failing(assessCriteria(assess({ metaCommentary: one })))).toEqual(['Outputs with meta-commentary about the input'])
  })
})

describe('dedup acceptance', () => {
  // Two sets: 3 labelled duplicates, 4 labelled distinct, 1 contested pair.
  const labels: PairLabel[][] = [['dup', 'dup', 'not', 'not'], ['dup', 'not', 'not', 'contested']]

  it('counts wrong merges over distinct pairs and catches over duplicates, ignoring contested pairs', () => {
    const counts = dedupCounts([[true, false, true, false], [true, false, false, true]], labels)
    expect(counts).toEqual({ wrongMerges: 1, distinct: 4, caught: 2, duplicates: 3 })
  })

  it('names the pairs behind each wrong merge and each missed duplicate', () => {
    const set = (id: string, titles: string[]): DedupSet => ({
      ...dedupSet(0), sourceId: id, source: { title: `source ${id}`, summary: '' },
      candidates: titles.map((t, i) => ({ id: `${id}-${i}`, title: t, summary: '', distance: 0, sameCluster: false })),
    })
    const sets = [set('a', ['a0', 'a1', 'a2', 'a3']), set('b', ['b0', 'b1', 'b2', 'b3'])]
    const mistakes = dedupMistakes(sets, [[true, false, true, false], [true, false, false, true]], labels)
    expect(mistakes.wrongMerges).toEqual([{ source: 'source a', candidate: 'a2' }])
    expect(mistakes.missed).toEqual([{ source: 'source a', candidate: 'a1' }])
  })

  it('requires no more wrong merges than nano and clearly more catches', () => {
    const nano = { wrongMerges: 2, distinct: 679, caught: 13, duplicates: 29 }
    expect(accepted(dedupCriteria({ wrongMerges: 2, distinct: 679, caught: 18, duplicates: 29 }, nano))).toBe(true)
    expect(accepted(dedupCriteria({ wrongMerges: 3, distinct: 679, caught: 29, duplicates: 29 }, nano))).toBe(false)
    // 17 of 29 (58.6%) is under nano's 44.8% plus the 15-point margin.
    expect(accepted(dedupCriteria({ wrongMerges: 0, distinct: 679, caught: 17, duplicates: 29 }, nano))).toBe(false)
  })

  it('caps the catch bar at every duplicate, so a subset where nano caught all can still pass', () => {
    const all = { wrongMerges: 0, distinct: 5, caught: 3, duplicates: 3 }
    expect(accepted(dedupCriteria(all, all))).toBe(true)
  })
})
