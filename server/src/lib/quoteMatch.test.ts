import { describe, expect, it } from 'vitest'
import { quoteFound, quoteNearlyFound } from './quoteMatch.js'

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

describe('quoteNearlyFound', () => {
  const texts = ['The Bundibugyo strain spreads in Ituri, Uganda and Austria.', 'Iran says 100,000 people fled; talks in Doha—a "last chance"—stall.']

  it('finds a quote with small misspellings in long words: up to one edit per 5 letters of the longer word', () => {
    expect(quoteNearlyFound('Bundibyo strain', texts)).toBe(true)
    expect(quoteNearlyFound('the bundibugio strain spreads', texts)).toBe(true)
  })

  it('never lets a short word, or a word holding a digit, differ', () => {
    expect(quoteNearlyFound('Iraq says', texts)).toBe(false)
    expect(quoteNearlyFound('Rwanda and Austria', texts)).toBe(false)
    expect(quoteNearlyFound('Uganda and Australia', texts)).toBe(false)
    expect(quoteNearlyFound('10,000 people fled', texts)).toBe(false)
  })

  it('wants the words in order and next to each other, punctuation and spacing aside', () => {
    expect(quoteNearlyFound('Ituri Uganda and Austria', texts)).toBe(true)
    expect(quoteNearlyFound('Uganda Ituri', texts)).toBe(false)
    expect(quoteNearlyFound('Bundibugyo spreads', texts)).toBe(false)
    expect(quoteNearlyFound('Doha a last chance stall', texts)).toBe(true)
  })

  it('evens out case and marks as quoteFound does, and finds no empty or letterless quote', () => {
    expect(quoteNearlyFound('BUNDIBUGYO  STRAIN', texts)).toBe(true)
    expect(quoteNearlyFound('', texts)).toBe(false)
    expect(quoteNearlyFound(' — ', texts)).toBe(false)
    expect(quoteNearlyFound('Bundibugyo', [])).toBe(false)
  })

  it('accepts every quote quoteFound accepts', () => {
    const shapes = ['Ituri,', 'Iran says 100,000', 'strain spre', 'undibugyo str', '"last chance"—stall.', 'Doha—a', 'chance"', 'ugyo']
    for (const q of shapes) expect(quoteFound(q, texts) && quoteNearlyFound(q, texts), q).toBe(true)
    for (const t of texts)
      for (let i = 0; i < t.length; i++)
        for (let j = i + 1; j <= t.length; j++) {
          const q = t.slice(i, j)
          if (quoteFound(q, [t])) expect(quoteNearlyFound(q, [t]), q).toBe(true)
        }
  })
})
