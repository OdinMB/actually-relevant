import { describe, it, expect } from 'vitest'
import { droppedQualifier, expectedSupported, plantableNumbers, plantVariants, reworded, VARIANT_KINDS, wrongNumber, wrongScale, wrongYear } from './plant.js'

describe('plantableNumbers', () => {
  it('never offers a number inside a word or an id', () => {
    const raws = (text: string) => plantableNumbers(text).map(t => t.raw)
    expect(raws('Fact S2F3 and the H5N1 strain')).toEqual([])
    expect(raws('5G masts and the 2nd round')).toEqual([])
    expect(raws('COVID-19 cases rose to 40')).toEqual(['40'])
  })

  it('never offers a number in a URL-like string', () => {
    expect(plantableNumbers('published at who.int/news/2025/ebola on Monday').map(t => t.raw)).toEqual([])
    expect(plantableNumbers('see example.com/report-2024 for 40 more').map(t => t.raw)).toEqual(['40'])
  })
})

describe('reworded', () => {
  it('turns a percentage of something into its fraction', () => {
    expect(reworded('The program reached 50% of households in 2025.')?.text).toBe('The program reached half of households in 2025.')
    expect(reworded('Prices fell by 25% last year.')?.text).toBe('Prices fell by a quarter last year.')
    expect(reworded('75 percent of the budget went to clinics.')?.text).toBe('Three quarters of the budget went to clinics.')
  })

  it('leaves a percentage the fraction would make ungrammatical', () => {
    expect(reworded('A 50% increase was recorded.')).toBeNull()
  })

  it('writes a whole million in the other form', () => {
    expect(reworded('The agency needs 2,000,000 doses.')?.text).toBe('The agency needs 2 million doses.')
    expect(reworded('Donors pledged $3 million on Monday.')?.text).toBe('Donors pledged $3,000,000 on Monday.')
    expect(reworded('Donors pledged $3.5 million on Monday.')).toBeNull()
  })

  it('rounds a number of at least 1,000 to two significant figures with "about"', () => {
    expect(reworded('Congo reported 4,887 deaths.')?.text).toBe('Congo reported about 4,900 deaths.')
    expect(reworded('Congo reported 4887 deaths.')?.text).toBe('Congo reported about 4900 deaths.')
  })

  it('leaves a number already rounded, already qualified, or a year', () => {
    expect(reworded('Congo reported 4,900 deaths.')).toBeNull()
    expect(reworded('Congo reported more than 4,887 deaths.')).toBeNull()
    expect(reworded('In 2024, 15 people died.')).toBeNull()
  })

  it('makes one change only', () => {
    expect(reworded('By 2026, 50% of 4,887 people were vaccinated.')?.text).toBe('By 2026, half of 4,887 people were vaccinated.')
  })

  it('rewords around an id without touching it', () => {
    expect(reworded('Fact S2F3 states 4,887 cases.')?.text).toBe('Fact S2F3 states about 4,900 cases.')
  })
})

describe('wrongNumber', () => {
  it('multiplies one significant number by 1.5, keeping its format', () => {
    expect(wrongNumber('Congo reported 4,887 deaths.')?.text).toBe('Congo reported 7,331 deaths.')
    expect(wrongNumber('About 40% of clinics closed.')?.text).toBe('About 60% of clinics closed.')
    expect(wrongNumber('The fund holds $4.2 million.')?.text).toBe('The fund holds $6.3 million.')
    expect(wrongNumber('Some 1,200,000 people fled.')?.text).toBe('Some 1,800,000 people fled.')
  })

  it('rounds the changed number to the precision it had', () => {
    expect(wrongNumber('Inflation was 0.1% in May.')?.text).toBe('Inflation was 0.2% in May.')
    expect(wrongNumber('Output fell 2.25% in May.')?.text).toBe('Output fell 3.38% in May.')
  })

  it('gives no variant for a number neither factor changes', () => {
    expect(wrongNumber('Inflation was 0% in May.')).toBeNull()
  })

  it('skips years and small bare counts', () => {
    expect(wrongNumber('In 2024, 12 schools closed.')?.text).toBe('In 2024, 18 schools closed.')
    expect(wrongNumber('Two people died in 2024.')).toBeNull()
    expect(wrongNumber('3 people died.')).toBeNull()
  })

  it('leaves ids and ambiguous separators alone', () => {
    expect(wrongNumber('COVID-19 cases rose to 40.')?.text).toBe('COVID-19 cases rose to 60.')
    expect(wrongNumber('Fact S2F3 is cited.')).toBeNull()
    expect(wrongNumber('Prices rose to 1.200 euros.')).toBeNull()
  })
})

describe('droppedQualifier', () => {
  it('removes a qualifier before a number', () => {
    expect(droppedQualifier('Nearly 2 million people need aid.')?.text).toBe('2 million people need aid.')
    expect(droppedQualifier('The fund reached more than 300 schools.')?.text).toBe('The fund reached 300 schools.')
    expect(droppedQualifier('Prices rose up to 30% in May.')?.text).toBe('Prices rose 30% in May.')
    expect(droppedQualifier('Some 1,200 families returned.')?.text).toBe('1,200 families returned.')
    expect(droppedQualifier('About two million people fled.')?.text).toBe('Two million people fled.')
  })

  it('leaves a qualifier word that does not stand before a number', () => {
    expect(droppedQualifier('Talks dragged over the summer, and 40 delegates left.')).toBeNull()
    expect(droppedQualifier('A handsome 40 delegates came.')).toBeNull()
    expect(droppedQualifier('Over 5G networks, 40 clinics report.')).toBeNull()
  })

  it('leaves a negated limit, which dropping would garble', () => {
    expect(droppedQualifier('No more than 5 people may gather.')).toBeNull()
  })
})

describe('wrongYear', () => {
  it('moves the first year back by one', () => {
    expect(wrongYear('Cases doubled in 2025.')?.text).toBe('Cases doubled in 2024.')
    expect(wrongYear('Funding rose between 2024 and 2025.')?.text).toBe('Funding rose between 2023 and 2025.')
  })

  it('reads only 1900 to 2099 as years, and never in a URL-like string', () => {
    expect(wrongYear('The archive holds 1899 letters and 2,025 maps.')).toBeNull()
    expect(wrongYear('Details at who.int/news/2025/ebola.')).toBeNull()
  })
})

describe('wrongScale', () => {
  it('swaps one scale word of a number', () => {
    expect(wrongScale('The fund needs $1.2 billion.')?.text).toBe('The fund needs $1.2 million.')
    expect(wrongScale('About 40 thousand people fled.')?.text).toBe('About 40 million people fled.')
    expect(wrongScale('Two million doses arrived and 3 billion more are due.')?.text).toBe('Two billion doses arrived and 3 billion more are due.')
  })

  it('leaves a scale word that belongs to no number', () => {
    expect(wrongScale('Millions of people fled.')).toBeNull()
  })
})

describe('plantVariants', () => {
  it('always keeps the statement as extracted, and adds each kind that applies', () => {
    const variants = plantVariants('Nearly 2 million people fled in 2025.')
    expect(variants[0]).toEqual({ kind: 'faithful', text: 'Nearly 2 million people fled in 2025.', change: '' })
    expect(variants.map(v => v.kind)).toEqual(['faithful', 'reworded', 'wrong-number', 'dropped-qualifier', 'wrong-year', 'wrong-scale'])
    expect(new Set(variants.map(v => v.text)).size).toBe(variants.length)
  })

  it('gives a fact no rule applies to only its faithful variant', () => {
    expect(plantVariants('Two people died.').map(v => v.kind)).toEqual(['faithful'])
  })

  it('expects the faithful kinds supported and every planted error unsupported', () => {
    expect(VARIANT_KINDS.filter(expectedSupported)).toEqual(['faithful', 'reworded'])
  })
})
