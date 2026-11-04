import { describe, it, expect } from 'vitest'
import { fieldFocusProblems } from './classes'

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
})
