import { describe, expect, it } from 'vitest'
import { quoteFound } from './quoteMatch.js'

describe('quoteFound', () => {
  const texts = ['Ebola cases rise in North Kivu', 'The WHO says the outbreak in eastern DR Congo’s Ituri province has spread.']

  it('finds a quote in any of the texts after evening out quote marks, dashes, spacing and case', () => {
    expect(quoteFound('north kivu', texts)).toBe(true)
    expect(quoteFound("eastern DR  Congo's Ituri", texts)).toBe(true)
    expect(quoteFound('  Ebola cases rise ', texts)).toBe(true)
  })

  it('finds no quote the texts do not hold, and no empty or wordless one', () => {
    expect(quoteFound('South Kivu', texts)).toBe(false)
    expect(quoteFound('', texts)).toBe(false)
    expect(quoteFound(' - ', texts)).toBe(false)
    expect(quoteFound('Ebola', [])).toBe(false)
  })
})
