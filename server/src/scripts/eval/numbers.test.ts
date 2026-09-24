import { describe, it, expect } from 'vitest'
import { findUnsupportedNumbers } from './numbers.js'

describe('findUnsupportedNumbers', () => {
  it('treats 1,200 and 1200 as the same number', () => {
    expect(findUnsupportedNumbers('About 1,200 people', 'Some 1200 residents').unsupported).toEqual([])
  })

  it('normalises dollar amounts with scale words', () => {
    expect(findUnsupportedNumbers('Cutting $4.5 billion', 'a cut of 4,500 million dollars').unsupported).toEqual([])
    expect(findUnsupportedNumbers('Cutting $4.5 billion', 'a cut of $4.5bn').unsupported).toEqual([])
  })

  it('reports numbers absent from the source', () => {
    const result = findUnsupportedNumbers('Affects 20 million people by 2030', 'Affects 20 million people')
    expect(result.unsupported).toEqual(['2030'])
    expect(result.total).toBe(2)
  })

  it('ignores numbers present in the source, including percentages', () => {
    expect(findUnsupportedNumbers('Emissions fell 12%', 'emissions fell by 12 percent').unsupported).toEqual([])
  })

  it('reads space-separated thousands in the source (French and South African style)', () => {
    expect(findUnsupportedNumbers('about 147,000 people remain', 'il resterait environ 147 000 habitants').unsupported).toEqual([])
    expect(findUnsupportedNumbers('12,900 doses', 'The first batch contains 12 900 doses').unsupported).toEqual([])
    expect(findUnsupportedNumbers('12,900 doses', 'The first batch contains 12 900 doses').unsupported).toEqual([])
  })

  it('does not join separate numbers across a space', () => {
    expect(findUnsupportedNumbers('In 2023, 100 people', 'In 2023 100 people').unsupported).toEqual([])
    expect(findUnsupportedNumbers('2023100 things', 'In 2023 100 people').unsupported).toEqual(['2023100'])
  })

  it('reads spelled-out English numbers before a scale word in the source', () => {
    expect(findUnsupportedNumbers('nearly 2 million losses', 'approaching two million casualties').unsupported).toEqual([])
    expect(findUnsupportedNumbers('2 billion doses', 'more than two billion COVID-19 vaccines').unsupported).toEqual([])
    expect(findUnsupportedNumbers('3 million doses', 'more than two billion vaccines').unsupported).toEqual(['3 million'])
  })
})
