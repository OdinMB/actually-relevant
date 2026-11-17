import { describe, it, expect } from 'vitest'
import { tileLabel } from './storyContextLabels.js'

const card = (over: Partial<Parameters<typeof tileLabel>[1]> = {}): Parameters<typeof tileLabel>[1] => ({
  heading: 'Who the lunches reach',
  asOf: '2026-11',
  tiles: 1,
  ...over,
})

describe('tileLabel', () => {
  it('drops a label that only repeats the heading of a one-tile card, and the as-of year the footer gives', () => {
    expect(tileLabel('organizations whose resources were accessed, 2026', card({ heading: 'Organizations whose resources were accessed', asOf: '2026' }))).toBe(
      '',
    )
  })

  it('reads the heading without case, punctuation, a plural s or function words', () => {
    expect(tileLabel('the pupil covered', card({ heading: 'Pupils covered: every public school' }))).toBe('')
  })

  it('keeps a label that adds to the heading', () => {
    expect(tileLabel('pupils covered', card())).toBe('pupils covered')
  })

  it("drops a trailing year that is the card's as-of year, after a comma, in, as of or in parentheses", () => {
    expect(['pupils covered, 2026', 'pupils covered in 2026', 'pupils covered as of 2026', 'pupils covered (2026)'].map(l => tileLabel(l, card()))).toEqual([
      'pupils covered',
      'pupils covered',
      'pupils covered',
      'pupils covered',
    ])
  })

  it('keeps a year that is not the as-of year, a year it cannot tell from the label, and every year on a card without an as-of', () => {
    expect(tileLabel('area burned, 2015', card())).toBe('area burned, 2015')
    expect(tileLabel('deaths since 2026', card())).toBe('deaths since 2026')
    expect(tileLabel('pupils covered, 2026', card({ asOf: null }))).toBe('pupils covered, 2026')
  })

  it('keeps the labels of a card with several tiles, which tell its tiles apart, less the as-of year', () => {
    expect(tileLabel('who the lunches reach, 2026', card({ tiles: 2 }))).toBe('who the lunches reach')
  })
})
