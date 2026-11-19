import { describe, it, expect } from 'vitest'
import type { PublicOverviewEntry } from '@shared/types'
import { offersFilter, timelineMonths } from './overviewTimeline'

const entry = (slug: string, date: string, role: PublicOverviewEntry['role'] = 'routine'): PublicOverviewEntry => ({
  slug,
  title: `Headline ${slug}`,
  titleLabel: null,
  datePublished: `${date}T08:00:00.000Z`,
  role,
  roleKind: role === 'turning_point' ? 'setback' : null,
  updates: [],
})

const slugs = (list: PublicOverviewEntry[]) => list.map(e => e.slug)

describe('timelineMonths', () => {
  it('groups the stories by month, newest month first, keeping their order inside a month', () => {
    const months = timelineMonths([entry('c', '2026-11-03'), entry('b', '2026-10-20'), entry('a', '2026-10-02')])
    expect(months.map(m => [m.key, m.label, slugs(m.all)])).toEqual([
      ['2026-11', 'November 2026', ['c']],
      ['2026-10', 'October 2026', ['b', 'a']],
    ])
  })

  it("groups by the UTC month, as the server's dates are", () => {
    expect(timelineMonths([entry('a', '2026-10-31')]).map(m => m.key)).toEqual(['2026-10'])
    expect(timelineMonths([{ ...entry('a', '2026-11-01'), datePublished: '2026-11-01T00:30:00.000Z' }]).map(m => m.key)).toEqual(['2026-11'])
  })

  it('shows a month\'s turning points and folds its routine stories under "+ N stories"', () => {
    const [month] = timelineMonths([entry('d', '2026-10-28'), entry('c', '2026-10-20', 'turning_point'), entry('b', '2026-10-10'), entry('a', '2026-10-02')])
    expect(slugs(month!.shown)).toEqual(['c'])
    expect(slugs(month!.folded)).toEqual(['d', 'b', 'a'])
    expect(slugs(month!.all)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('shows the newest story of a month without a turning point, folding the rest', () => {
    const [month] = timelineMonths([entry('c', '2026-10-28'), entry('b', '2026-10-20'), entry('a', '2026-10-02')])
    expect(slugs(month!.shown)).toEqual(['c'])
    expect(slugs(month!.folded)).toEqual(['b', 'a'])
  })

  it('folds nothing when the fold would hold a single story', () => {
    const [quiet] = timelineMonths([entry('b', '2026-10-20'), entry('a', '2026-10-02')])
    expect(slugs(quiet!.shown)).toEqual(['b', 'a'])
    expect(quiet!.folded).toEqual([])
    const [turning] = timelineMonths([entry('b', '2026-10-20', 'turning_point'), entry('a', '2026-10-02')])
    expect(slugs(turning!.shown)).toEqual(['b', 'a'])
    expect(turning!.folded).toEqual([])
  })

  it('keeps only the turning points, and only the months that have one, under "Turning points"', () => {
    const entries = [entry('c', '2026-11-03'), entry('b', '2026-10-20', 'turning_point'), entry('a', '2026-10-02')]
    expect(timelineMonths(entries, 'turning').map(m => [m.key, slugs(m.shown), m.folded.length, slugs(m.all)])).toEqual([['2026-10', ['b'], 0, ['b']]])
  })
})

describe('offersFilter', () => {
  it('offers "Turning points" only when the timeline has turning points and routine stories both', () => {
    expect(offersFilter([entry('b', '2026-10-20', 'turning_point'), entry('a', '2026-10-02')])).toBe(true)
    expect(offersFilter([entry('a', '2026-10-02')])).toBe(false)
    expect(offersFilter([entry('a', '2026-10-02', 'turning_point')])).toBe(false)
  })
})
