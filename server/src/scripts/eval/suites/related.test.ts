import { describe, it, expect } from 'vitest'
import { decideRelated, validPicks } from './related.js'

describe('validPicks', () => {
  it('drops unknown and repeated IDs and counts the unknown ones', () => {
    expect(validPicks({ selectedIds: ['a', 'x', 'a', 'b'] }, ['a', 'b', 'c'])).toEqual({ picks: ['a', 'b'], invalid: 1 })
  })
})

describe('decideRelated', () => {
  const nano = { exactCompliance: 0.9, overlapWithBaseline: 1, failures: 0 }

  it('picks the lowest passing effort', () => {
    const d = decideRelated({
      'gpt-5-nano@medium': nano,
      'gpt-6-luna@low': { exactCompliance: 1, overlapWithBaseline: 0.6, failures: 0 },
      'gpt-6-luna@medium': { exactCompliance: 1, overlapWithBaseline: 0.7, failures: 0 },
    }, 'gpt-5-nano@medium', ['gpt-6-luna@medium', 'gpt-6-luna@low'])
    expect(d.verdict).toMatchObject({ kind: 'winner', arm: 'gpt-6-luna@low' })
  })

  it('reports no winner when overlap with nano is below half', () => {
    const d = decideRelated({
      'gpt-5-nano@medium': nano,
      'gpt-6-luna@low': { exactCompliance: 1, overlapWithBaseline: 0.4, failures: 0 },
    }, 'gpt-5-nano@medium', ['gpt-6-luna@low'])
    expect(d.verdict.kind).toBe('none')
  })
})
