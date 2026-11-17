import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ default: {} }))

const { paceUsd, warningsDue } = await import('./spending.js')
const { config } = await import('../config.js')

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

const paceFromDay = config.spending.paceFromDay
afterEach(() => {
  config.spending.paceFromDay = paceFromDay
})

describe('paceUsd', () => {
  it("stretches the month's spend so far over the whole month, today counted as a day so far", () => {
    expect(paceUsd(16, at('2026-11-16'))).toBeCloseTo(30)
    expect(paceUsd(2, at('2026-11-01'))).toBeCloseTo(60)
    expect(paceUsd(45, at('2026-11-30'))).toBeCloseTo(45)
    expect(paceUsd(7, at('2027-02-14'))).toBeCloseTo(14)
    expect(paceUsd(0, at('2026-11-16'))).toBe(0)
  })

  it('reads the day on the UTC clock', () => {
    // Still the 31st of October in UTC, though the 1st of November east of it
    expect(paceUsd(31, new Date('2026-10-31T23:30:00Z'))).toBeCloseTo(31)
    expect(paceUsd(1, new Date('2026-11-01T00:30:00Z'))).toBeCloseTo(30)
  })
})

describe('warningsDue', () => {
  it('names a scope whose spend has passed its level, whatever the day', () => {
    expect(warningsDue([{ scope: 'research_stories', spentUsd: 26, levelUsd: 25 }], at('2026-11-03'))).toEqual([
      { scope: 'research_stories', kind: 'passed', spentUsd: 26, paceUsd: expect.closeTo(260, 6), levelUsd: 25 },
    ])
  })

  it('names a scope heading past its level at this pace from the first pace day on, and not before', () => {
    config.spending.paceFromDay = 8
    const research = [{ scope: 'research_stories', spentUsd: 7, levelUsd: 25 }]
    expect(warningsDue(research, at('2026-11-07'))).toEqual([])
    expect(warningsDue(research, at('2026-11-08'))).toEqual([
      { scope: 'research_stories', kind: 'on_pace', spentUsd: 7, paceUsd: expect.closeTo(26.25, 6), levelUsd: 25 },
    ])
  })

  it('names nothing for a scope without a level, at its level on the last day, or under it at this pace', () => {
    expect(
      warningsDue(
        [
          { scope: 'assess_stories', spentUsd: 500, levelUsd: null },
          { scope: 'select_stories', spentUsd: 5, levelUsd: 5 },
          { scope: 'generate_podcast', spentUsd: 9, levelUsd: 10 },
        ],
        at('2026-11-30'),
      ),
    ).toEqual([])
    expect(warningsDue([{ scope: 'generate_podcast', spentUsd: 1, levelUsd: 10 }], at('2026-11-15'))).toEqual([])
  })

  it('names the total and a job at once, each for itself', () => {
    const due = warningsDue(
      [
        { scope: 'research_stories', spentUsd: 14.2, levelUsd: 25 },
        { scope: 'all', spentUsd: 61, levelUsd: 60 },
      ],
      at('2026-11-16'),
    )
    expect(due.map(d => [d.scope, d.kind])).toEqual([
      ['research_stories', 'on_pace'],
      ['all', 'passed'],
    ])
  })
})
