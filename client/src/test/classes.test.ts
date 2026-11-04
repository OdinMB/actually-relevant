import { describe, it, expect } from 'vitest'
import { fieldBorderProblems, fieldFocusProblems } from './classes'
import { contrastRatio } from './contrast'

function el(className: string) {
  const div = document.createElement('div')
  div.className = className
  return div
}

describe('fieldFocusProblems', () => {
  it('accepts a brand-500 ring and border with the browser outline dropped', () => {
    expect(fieldFocusProblems(el('outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500'))).toEqual([])
    expect(fieldFocusProblems(el('outline-none focus:ring-2 focus:ring-brand-700'))).toEqual([])
  })

  it('names each focus color lighter than brand-500, or outside the brand palette', () => {
    expect(fieldFocusProblems(el('outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200'))).toEqual([
      'focus:border-brand-400 is not brand-500 or darker',
      'focus:ring-brand-200 is not brand-500 or darker',
    ])
    expect(fieldFocusProblems(el('outline-none focus:ring-2 focus:ring-yellow-500'))).toEqual(['focus:ring-yellow-500 is not brand-500 or darker'])
  })

  it('names a missing ring, ring color or outline reset', () => {
    expect(fieldFocusProblems(el('focus:border-brand-500'))).toEqual(['no outline-none', 'no focus:ring-2', 'no focus:ring color'])
    expect(fieldFocusProblems(el('outline-none focus:ring-2 focus:ring-offset-2'))).toEqual(['no focus:ring color'])
  })

  it('names a translucent ring or border, which lets the white through', () => {
    expect(fieldFocusProblems(el('outline-none focus:border-brand-500/40 focus:ring-2 focus:ring-brand-500/50'))).toEqual([
      'focus:border-brand-500/40 is translucent',
      'focus:ring-brand-500/50 is translucent',
    ])
  })
})

describe('fieldBorderProblems', () => {
  it('accepts a neutral-500 or darker border', () => {
    expect(fieldBorderProblems(el('border border-neutral-500 rounded-lg'))).toEqual([])
    expect(fieldBorderProblems(el('border border-neutral-700 focus:border-brand-500'))).toEqual([])
  })

  it('names a lighter or translucent border, and a missing one', () => {
    expect(fieldBorderProblems(el('border border-neutral-300'))).toEqual(['border-neutral-300 is not an opaque neutral-500 or darker'])
    expect(fieldBorderProblems(el('border border-neutral-500/50'))).toEqual(['border-neutral-500/50 is not an opaque neutral-500 or darker'])
    expect(fieldBorderProblems(el('rounded-lg border-l-4'))).toEqual(['no border', 'no border color'])
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    // The darkest grey that passes 4.5:1 on white, either way round
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(4.54, 2)
  })

  it('refuses anything but #rrggbb', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow('not a #rrggbb color: #fff')
  })
})
