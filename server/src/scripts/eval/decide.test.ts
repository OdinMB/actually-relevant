import { describe, it, expect } from 'vitest'
import { effectiveBar, pickLowestPassing } from './decide.js'

describe('effectiveBar', () => {
  it('keeps the absolute bar when the baseline rerun meets it', () => {
    expect(effectiveBar(0.85, 0.9)).toBe(0.85)
  })

  it('relaxes to the noise floor minus 5 points when the baseline rerun misses it', () => {
    expect(effectiveBar(0.85, 0.8)).toBeCloseTo(0.75)
  })
})

describe('pickLowestPassing', () => {
  it('picks the lowest-effort passing arm', () => {
    const d = pickLowestPassing([
      { arm: 'gpt-6-luna@medium', failures: [] },
      { arm: 'gpt-6-luna@low', failures: [] },
    ])
    expect(d.verdict).toEqual({ kind: 'winner', arm: 'gpt-6-luna@low', evidence: expect.any(Array) })
    expect(d.passing).toEqual(['gpt-6-luna@low', 'gpt-6-luna@medium'])
  })

  it('reports no winner with the failing checks', () => {
    const d = pickLowestPassing([{ arm: 'gpt-6-luna@low', failures: ['issue agreement 70% < 85%'] }])
    expect(d.verdict.kind).toBe('none')
    expect(d.verdict.kind === 'none' && d.verdict.reasons.join()).toContain('issue agreement')
  })
})
