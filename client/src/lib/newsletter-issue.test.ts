import { describe, it, expect } from 'vitest'
import { parseQuote, sectionSlug } from './newsletter-issue'

describe('sectionSlug', () => {
  const categories = [
    { name: 'Planet & Climate', slug: 'planet-climate', children: [{ name: 'Energy', slug: 'energy' }] },
    { name: 'Our Future', slug: 'existential-threats' },
  ]

  it("takes the slug of the category with the section's name, top level or child", () => {
    expect(sectionSlug('Our Future', categories)).toBe('existential-threats')
    expect(sectionSlug(' Energy ', categories)).toBe('energy')
  })

  it('slugifies the name when no category has it, or none are loaded', () => {
    expect(sectionSlug('Science & Technology', categories)).toBe('science-technology')
    expect(sectionSlug('Planet & Climate')).toBe('planet-climate')
    expect(sectionSlug('(Nuclear) War')).toBe('nuclear-war')
  })
})

describe('parseQuote', () => {
  it('splits the quote from its attribution and drops the quote marks', () => {
    expect(parseQuote('\n"Most deaths were preventable."\n— A coordinator\n')).toEqual({ quote: 'Most deaths were preventable.', attribution: 'A coordinator' })
    expect(parseQuote('“Curly.”\n— Someone')).toEqual({ quote: 'Curly.', attribution: 'Someone' })
  })

  it('keeps a quote that runs over several lines whole', () => {
    expect(parseQuote('"First line\nsecond line."\n— Someone')).toEqual({ quote: 'First line\nsecond line.', attribution: 'Someone' })
  })

  it('is null for a quote without an attribution line', () => {
    expect(parseQuote('"Just words."')).toBeNull()
    expect(parseQuote('Words — with a dash inside')).toBeNull()
  })
})
