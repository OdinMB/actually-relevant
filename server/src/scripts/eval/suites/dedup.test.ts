import { describe, it, expect } from 'vitest'
import { labelSet, scoreDedupArm, decideDedup, isDisputed, votesFrom, type DedupArmMetrics } from './dedup.js'

describe('votesFrom', () => {
  it('maps candidate numbers to votes and counts out-of-range numbers', () => {
    const v = votesFrom({ assessments: [
      { candidateNumber: 1, isDuplicate: true, reason: '' },
      { candidateNumber: 3, isDuplicate: false, reason: '' },
      { candidateNumber: 9, isDuplicate: true, reason: '' },
    ] }, 3)
    expect(v.votes).toEqual([true, null, false])
    expect(v.outOfRange).toBe(1)
  })
})

describe('labelSet', () => {
  it('labels unanimous pairs and leaves the rest disputed until judged', () => {
    const arms = [[true, false, false], [true, false, true], [true, false, null]]
    expect(isDisputed(arms)).toBe(true)
    expect(labelSet(arms)).toEqual(['dup', 'not', 'disputed'])
  })

  it('labels disputed pairs from agreeing judges and marks split judges as contested', () => {
    const arms = [[true, true], [false, false], [true, true]]
    expect(labelSet(arms, [[true, false], [true, true]])).toEqual(['dup', 'contested'])
  })
})

describe('scoreDedupArm', () => {
  it('computes FP rate and recall only over labelled, non-contested pairs', () => {
    const labels = [['dup', 'not', 'contested', 'not'], ['disputed', 'dup']] as const
    const votes = [[true, true, true, false], [true, false]]
    const m = scoreDedupArm(votes, labels.map(l => [...l]))
    // labelled: set0 = dup, not, not; set1 = dup. FP: set0[1]; TN: set0[3]. TP: set0[0]; FN: set1[1].
    expect(m.fpRate).toBeCloseTo(0.5)
    expect(m.recall).toBeCloseTo(0.5)
    expect(m.labelledPairs).toBe(4)
  })

  it('treats a missing verdict as not a duplicate, like production', () => {
    const m = scoreDedupArm([[null]], [['dup']])
    expect(m.recall).toBe(0)
  })
})

describe('decideDedup', () => {
  const nano: DedupArmMetrics = { fpRate: 0.05, recall: 0.9, labelledPairs: 100, missing: 0, outOfRange: 0, failures: 0, agreementWithBaseline: 1, clusterAgreement: 0.8 }

  it('picks the lowest effort whose FP rate is not worse and recall within 5 points', () => {
    const d = decideDedup({
      'gpt-5-nano@medium': nano,
      'gpt-6-luna@low': { ...nano, recall: 0.86 },
      'gpt-6-luna@medium': { ...nano, recall: 0.92 },
    }, 'gpt-5-nano@medium', ['gpt-6-luna@low', 'gpt-6-luna@medium'])
    expect(d.verdict).toMatchObject({ kind: 'winner', arm: 'gpt-6-luna@low' })
  })

  it('reports no winner when every candidate has more false positives', () => {
    const d = decideDedup({
      'gpt-5-nano@medium': nano,
      'gpt-6-luna@low': { ...nano, fpRate: 0.08 },
    }, 'gpt-5-nano@medium', ['gpt-6-luna@low'])
    expect(d.verdict.kind).toBe('none')
  })
})
