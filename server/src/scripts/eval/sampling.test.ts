import { describe, it, expect } from 'vitest'
import { stratifiedPick, buildSelectionGroups } from './sampling.js'

interface Item { id: string; lang: string; han: boolean }

const pool: Item[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `en${i}`, lang: 'en', han: false })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `zh${i}`, lang: 'zh', han: true })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `de${i}`, lang: 'de', han: false })),
]

describe('stratifiedPick', () => {
  it('fills quotas first, then spreads across groups', () => {
    const { picked, shortfalls } = stratifiedPick(pool, {
      total: 9,
      quotas: [{ name: 'Han', test: t => t.han, min: 3 }],
      spreadBy: t => t.lang,
    })
    expect(picked).toHaveLength(9)
    expect(picked.filter(t => t.han)).toHaveLength(4) // 3 by quota + 1 via round-robin
    // round-robin over de, en, zh: de0 en0 zh3 | de1 en1 | de2
    expect(picked.filter(t => t.lang === 'de')).toHaveLength(3)
    expect(picked.filter(t => t.lang === 'en')).toHaveLength(2)
    expect(shortfalls).toEqual([])
  })

  it('reports shortfalls instead of padding', () => {
    const { picked, shortfalls } = stratifiedPick(pool, {
      total: 30,
      quotas: [{ name: 'Han', test: t => t.han, min: 6 }],
      spreadBy: t => t.lang,
    })
    expect(picked).toHaveLength(18)
    expect(shortfalls).toEqual(['18 of 30 items available', 'Han: 4 of 6'])
  })

  it('is deterministic', () => {
    const opts = { total: 7, quotas: [], spreadBy: (t: Item) => t.lang }
    expect(stratifiedPick(pool, opts).picked).toEqual(stratifiedPick(pool, opts).picked)
  })
})

describe('buildSelectionGroups', () => {
  const day = (d: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${d}-${i}`, dateCrawled: new Date(`${d}T0${i % 10}:00:00Z`) }))

  it('keeps only days with enough stories and splits them like production', () => {
    const groups = buildSelectionGroups([...day('2026-09-01', 25), ...day('2026-09-02', 5)], {
      minPerDay: 8, maxGroupSize: 20, ratio: 0.5, count: 20,
    })
    expect(groups.map(g => g.storyIds.length).sort()).toEqual([12, 13])
    expect(groups.every(g => g.day === '2026-09-01')).toBe(true)
    expect(groups.find(g => g.storyIds.length === 13)?.toSelect).toBe(7)
  })

  it('takes a deterministic subset when more groups exist than requested', () => {
    const stories = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].flatMap(d => day(d, 10))
    const opts = { minPerDay: 8, maxGroupSize: 20, ratio: 0.5, count: 2 }
    const first = buildSelectionGroups(stories, opts)
    expect(first).toHaveLength(2)
    expect(buildSelectionGroups([...stories].reverse(), opts).map(g => g.id)).toEqual(first.map(g => g.id))
  })
})
