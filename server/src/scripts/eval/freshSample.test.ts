import { describe, it, expect } from 'vitest'
import { excludedIds, fixtureMismatch, isPhase1Sample, PHASE1_FIXTURES_CREATED_AT } from './freshSample.js'

describe('isPhase1Sample', () => {
  it('knows the 2026-09-24 sample by its creation time and nothing else', () => {
    expect(isPhase1Sample({ createdAt: PHASE1_FIXTURES_CREATED_AT })).toBe(true)
    expect(isPhase1Sample({ createdAt: '2026-11-01T10:00:00.000Z' })).toBe(false)
  })
})

describe('fixtureMismatch', () => {
  const wanted = { floor: '2026-02-01', assessSize: 50, exclude: [] as string[] }

  it('reuses fixtures sampled with the same floor, size and exclusions', () => {
    expect(fixtureMismatch({ floor: '2026-02-01' }, wanted)).toBeNull()
    expect(fixtureMismatch({ floor: '2026-02-01', assessSize: 150, exclude: ['a'] }, { ...wanted, assessSize: 150, exclude: ['a'] })).toBeNull()
  })

  it('treats fixtures from before the size option as the 50-story sample', () => {
    expect(fixtureMismatch({ floor: '2026-02-01' }, { ...wanted, assessSize: 150 })).toMatch(/50.*150/)
  })

  it('names what differs', () => {
    expect(fixtureMismatch({ floor: '2026-03-01' }, wanted)).toMatch(/floor/)
    expect(fixtureMismatch({ floor: '2026-02-01', exclude: ['a'] }, wanted)).toMatch(/exclu/)
    expect(fixtureMismatch({ floor: '2026-02-01' }, { ...wanted, exclude: ['a'] })).toMatch(/exclu/)
  })

  it('ignores the order of the excluded folders', () => {
    expect(fixtureMismatch({ floor: '2026-02-01', exclude: ['b', 'a'] }, { ...wanted, exclude: ['a', 'b'] })).toBeNull()
  })
})

describe('excludedIds', () => {
  it('takes every pre-assessment and full-assessment story of another sample, once', () => {
    const ids = excludedIds([
      { preassess: [{ id: 'p1' }, { id: 'x' }], assess: [{ id: 'a1' }, { id: 'x' }] },
      { preassess: [], assess: [{ id: 'a2' }] },
    ])
    expect([...ids].sort()).toEqual(['a1', 'a2', 'p1', 'x'])
  })
})
