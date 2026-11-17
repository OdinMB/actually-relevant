import { describe, expect, it } from 'vitest'
import { asOfLine, chartCaption } from './contextText'

describe('asOfLine', () => {
  it('gives the date as precisely as the facts give it', () => {
    expect(asOfLine('2026-11-03')).toBe('As of Nov 3, 2026')
    expect(asOfLine('2026-10')).toBe('As of October 2026')
    expect(asOfLine('2026')).toBe('As of 2026')
  })

  it('gives none without a date, or for one it cannot read', () => {
    expect(asOfLine(null)).toBeNull()
    expect(asOfLine('soon')).toBeNull()
  })
})

describe('chartCaption', () => {
  it('names a word unit the measure does not already name, and leaves symbols to the values', () => {
    expect(chartCaption({ caption: 'area burned in Indonesia', unit: 'hectares' })).toBe('Area burned in Indonesia, hectares')
    expect(chartCaption({ caption: 'pupils getting free lunches', unit: 'pupils' })).toBe('Pupils getting free lunches')
    expect(chartCaption({ caption: 'average attendance', unit: '%' })).toBe('Average attendance')
  })
})
