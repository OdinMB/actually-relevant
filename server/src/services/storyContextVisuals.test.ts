import { describe, it, expect } from 'vitest'
import {
  asOfColumns,
  asOfFromColumns,
  formatFigure,
  isCurrent,
  normalizeAsOf,
  spelledFigure,
  tileDisplay,
  validChart,
  type VisualFact,
} from './storyContextVisuals.js'
import type { StoredChart } from '../schemas/storyContext.js'

const WINDOWS = { fastDays: 14, slowDays: 365 }
const DAY = '2026-11-14'

const fact = (over: Partial<VisualFact> & { ref: string }): VisualFact => ({
  value: 100,
  valueHigh: null,
  unit: 'people',
  approx: 'exact',
  provisional: false,
  asOf: '2026-11-10',
  sourceDate: '2026-11-12',
  validity: 'fast',
  creditedKind: null,
  sourceKind: 'news-report',
  shown: true,
  ...over,
})

describe('isCurrent', () => {
  it('keeps a fixed fact current whatever its date', () => {
    expect(isCurrent({ validity: 'fixed', asOf: '2015', sourceDate: null }, DAY, WINDOWS)).toBe(true)
    expect(isCurrent({ validity: 'fixed', asOf: null, sourceDate: null }, DAY, WINDOWS)).toBe(true)
  })

  it('keeps a fast fact current for 14 days from its as-of date, judged on the story day', () => {
    expect(isCurrent({ validity: 'fast', asOf: '2026-10-31', sourceDate: null }, DAY, WINDOWS)).toBe(true)
    expect(isCurrent({ validity: 'fast', asOf: '2026-10-30', sourceDate: null }, DAY, WINDOWS)).toBe(false)
  })

  it('keeps a slow fact current for a year, counting a coarse as-of from its first day', () => {
    expect(isCurrent({ validity: 'slow', asOf: '2026', sourceDate: null }, DAY, WINDOWS)).toBe(true)
    expect(isCurrent({ validity: 'slow', asOf: '2025-11', sourceDate: null }, DAY, WINDOWS)).toBe(false)
    expect(isCurrent({ validity: 'slow', asOf: '2025-11-15', sourceDate: null }, DAY, WINDOWS)).toBe(true)
  })

  it("falls back to the source's day without an as-of date, and is not current without either", () => {
    expect(isCurrent({ validity: 'fast', asOf: null, sourceDate: '2026-11-12' }, DAY, WINDOWS)).toBe(true)
    expect(isCurrent({ validity: 'fast', asOf: null, sourceDate: '2026-10-01' }, DAY, WINDOWS)).toBe(false)
    expect(isCurrent({ validity: 'slow', asOf: null, sourceDate: null }, DAY, WINDOWS)).toBe(false)
  })
})

describe('as-of dates', () => {
  it('accepts a day, a month or a year and nothing else', () => {
    expect(['2026-11-14', '2026-11', '2026', '', 'Nov 2026', '2026-13', '2026-02-30', ' 2015 '].map(normalizeAsOf)).toEqual([
      '2026-11-14',
      '2026-11',
      '2026',
      null,
      null,
      null,
      null,
      '2015',
    ])
  })

  it('round-trips through the date and precision columns', () => {
    for (const asOf of ['2026-11-14', '2026-11', '2026', null]) {
      const { date, precision } = asOfColumns(asOf)
      expect(asOfFromColumns(date, precision)).toBe(asOf)
    }
  })
})

describe('formatFigure', () => {
  it('writes millions and billions short, thousands in full', () => {
    expect(formatFigure(fact({ ref: 'a', value: 12_500_000 }))).toEqual({ text: '12.5m', estimate: false })
    expect(formatFigure(fact({ ref: 'a', value: 2_880_000 }))?.text).toBe('2.88m')
    expect(formatFigure(fact({ ref: 'a', value: 1_200_000_000, unit: 'USD' }))?.text).toBe('$1.2bn')
    expect(formatFigure(fact({ ref: 'a', value: 400_000 }))?.text).toBe('400,000')
    expect(formatFigure(fact({ ref: 'a', value: 63, unit: '%' }))?.text).toBe('63%')
  })

  it('marks at least with +, about and under in words, a range with a dash, and estimates', () => {
    expect(formatFigure(fact({ ref: 'a', value: 400_000, approx: 'at_least' }))?.text).toBe('400,000+')
    expect(formatFigure(fact({ ref: 'a', value: 2_900_000, approx: 'about' }))?.text).toBe('about 2.9m')
    expect(formatFigure(fact({ ref: 'a', value: 5000, approx: 'under' }))?.text).toBe('under 5,000')
    expect(formatFigure(fact({ ref: 'a', value: 5000, valueHigh: 5400 }))?.text).toBe('5,000–5,400')
    expect(formatFigure(fact({ ref: 'a', value: 2_880_000, provisional: true }))).toEqual({ text: '2.88m', estimate: true })
    expect(formatFigure(fact({ ref: 'a', value: null }))).toBeNull()
  })

  it('spells the figure out for the checks, unit included', () => {
    expect(spelledFigure(fact({ ref: 'a', value: 2_880_000, unit: 'hectares', approx: 'about' }))).toBe('about 2.88 million hectares')
    expect(spelledFigure(fact({ ref: 'a', value: 5000, valueHigh: 5400, approx: 'exact' }))).toBe('5,000 to 5,400 people')
    expect(spelledFigure(fact({ ref: 'a', value: 63, unit: '%', approx: 'at_least' }))).toBe('at least 63%')
    expect(spelledFigure(fact({ ref: 'a', value: null }))).toBeNull()
  })

  it('spells a figure whose stored unit is only a filler without it', () => {
    expect(spelledFigure(fact({ ref: 'a', value: 12, unit: 'none' }))).toBe('12')
    expect(spelledFigure(fact({ ref: 'a', value: 12, unit: 'N/A' }))).toBe('12')
  })
})

describe('tileDisplay', () => {
  it('shows an agreeing value once, from the most authoritative source', () => {
    const shown = tileDisplay(
      [
        fact({ ref: 'S1F1', value: 5000, sourceKind: 'news-report' }),
        fact({ ref: 'S2F1', value: 5000, creditedKind: 'official' }),
        fact({ ref: 'S3F1', value: 5000, sourceKind: 'official-body', asOf: '2026-11-01' }),
      ],
      DAY,
      WINDOWS,
    )
    expect(shown).toEqual([{ ref: 'S2F1', text: '5,000', estimate: false }])
  })

  it('shows different values of the same or a later day side by side, each naming its source', () => {
    const shown = tileDisplay(
      [
        fact({ ref: 'S1F1', value: 5000, creditedKind: 'official', asOf: '2026-11-10' }),
        fact({ ref: 'S2F1', value: 5400, asOf: '2026-11-10' }),
        fact({ ref: 'S3F1', value: 5600, asOf: '2026-11-12' }),
      ],
      DAY,
      WINDOWS,
    )
    expect(shown.map(v => [v.ref, v.text])).toEqual([
      ['S1F1', '5,000'],
      ['S2F1', '5,400'],
      ['S3F1', '5,600'],
    ])
  })

  it('leaves out older values, expired facts, hidden ones and facts without a figure', () => {
    const shown = tileDisplay(
      [
        fact({ ref: 'S1F1', value: 5000, creditedKind: 'official', asOf: '2026-11-10' }),
        fact({ ref: 'S2F1', value: 4200, asOf: '2026-11-05' }),
        fact({ ref: 'S3F1', value: 3000, asOf: '2026-10-01' }),
        fact({ ref: 'S4F1', value: 6000, shown: false }),
        fact({ ref: 'S5F1', value: null }),
      ],
      DAY,
      WINDOWS,
    )
    expect(shown.map(v => v.ref)).toEqual(['S1F1'])
    expect(tileDisplay([fact({ ref: 'S3F1', asOf: '2026-10-01' })], DAY, WINDOWS)).toEqual([])
  })
})

describe('validChart', () => {
  const facts = (list: VisualFact[]) => new Map(list.map(f => [f.ref, f]))
  const bars = (refs: string[]): StoredChart => ({
    kind: 'bars',
    measure: 'area burned',
    unit: 'hectares',
    points: refs.map(r => ({ label: r, factId: r })),
    apart: null,
  })
  const line = (refs: string[]): StoredChart => ({ ...bars(refs), kind: 'line' })

  it('draws bars from two points of one unit, and none from one point, two units or a negative', () => {
    const f = facts([
      fact({ ref: 'A', value: 2_600_000, unit: 'hectares', validity: 'fixed', asOf: '2015' }),
      fact({ ref: 'B', value: 2_880_000, unit: 'Hectares', provisional: true, asOf: '2026-10-30' }),
      fact({ ref: 'C', value: 12, unit: '%' }),
      fact({ ref: 'D', value: -3, unit: 'hectares' }),
    ])
    const chart = validChart(bars(['A', 'B']), f, DAY)
    expect(chart).toMatchObject({ kind: 'bars', unit: 'hectares', apart: null })
    expect(chart!.points.map(p => [p.ref, p.text, p.estimate, p.recent])).toEqual([
      ['A', '2.6m', false, false],
      ['B', '2.88m', true, true],
    ])
    expect(validChart(bars(['A']), f, DAY)).toBeNull()
    expect(validChart(bars(['A', 'C']), f, DAY)).toBeNull()
    expect(validChart(bars(['A', 'D']), f, DAY)).toBeNull()
  })

  it('removes a point citing a fact not shown before counting', () => {
    const f = facts([fact({ ref: 'A', value: 1 }), fact({ ref: 'B', value: 2, shown: false })])
    expect(validChart(bars(['A', 'B']), f, DAY)).toBeNull()
    expect(validChart(bars(['A', 'missing']), f, DAY)).toBeNull()
  })

  it('draws a line from three points at different dates, in date order', () => {
    const f = facts([
      fact({ ref: 'A', value: 3, asOf: '2024' }),
      fact({ ref: 'B', value: 1, asOf: '2020' }),
      fact({ ref: 'C', value: 2, asOf: '2022-06' }),
      fact({ ref: 'D', value: 4, asOf: '2022-06' }),
    ])
    expect(validChart(line(['A', 'B', 'C']), f, DAY)!.points.map(p => p.ref)).toEqual(['B', 'C', 'A'])
    expect(validChart(line(['A', 'B']), f, DAY)).toBeNull()
    expect(validChart(line(['A', 'C', 'D']), f, DAY)).toBeNull()
  })

  it('keeps an apart group of its own unit beside bars, and drops one that has none', () => {
    const f = facts([
      fact({ ref: 'A', value: 1, unit: 'hectares' }),
      fact({ ref: 'B', value: 2, unit: 'hectares' }),
      fact({ ref: 'C', value: 40, unit: 'people' }),
    ])
    const withApart = { ...bars(['A', 'B']), apart: { measure: 'people evacuated', unit: 'people', points: [{ label: '2026', factId: 'C' }] } }
    expect(validChart(withApart, f, DAY)!.apart).toMatchObject({ measure: 'people evacuated', unit: 'people', points: [{ ref: 'C' }] })
    expect(validChart({ ...withApart, apart: { ...withApart.apart, points: [{ label: 'x', factId: 'missing' }] } }, f, DAY)!.apart).toBeNull()
  })
})
