import { describe, it, expect } from 'vitest'
import { initialOf, sourceDate } from './sourceText'

describe('sourceDate', () => {
  it('names the day of an outside source and only the month of our earlier story, on the date as given', () => {
    expect(sourceDate({ date: '2026-11-12', origin: 'source' })).toBe('Nov 12, 2026')
    expect(sourceDate({ date: '2026-11-12T23:30:00Z', origin: 'original' })).toBe('Nov 12, 2026')
    expect(sourceDate({ date: '2026-03-01', origin: 'earlier' })).toBe('Mar 2026')
  })

  it('leaves out a missing or unreadable date', () => {
    expect(sourceDate({ date: null, origin: 'source' })).toBeNull()
    expect(sourceDate({ date: 'last Tuesday', origin: 'source' })).toBeNull()
  })
})

describe('initialOf', () => {
  it("takes the outlet's first letter, capitalized, and a question mark for a blank name", () => {
    expect(initialOf(' cleantechnica.com')).toBe('C')
    expect(initialOf('  ')).toBe('?')
  })
})
