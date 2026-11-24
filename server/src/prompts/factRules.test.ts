import { describe, expect, it } from 'vitest'
import { publishedWithWeekday } from './factRules.js'

describe('publishedWithWeekday', () => {
  it("gives a source's day with its weekday, read in UTC, whatever form the date came in", () => {
    expect(publishedWithWeekday('2026-11-12')).toBe('2026-11-12 (Thursday)')
    expect(publishedWithWeekday('Sun, 15 Nov 2026 23:30:00 GMT')).toBe('2026-11-15 (Sunday)')
  })

  it('shows a date it cannot read as given, and no date as unknown', () => {
    expect(publishedWithWeekday(' sometime in spring ')).toBe('sometime in spring')
    expect(publishedWithWeekday(null)).toBe('unknown')
    expect(publishedWithWeekday('')).toBe('unknown')
  })
})
