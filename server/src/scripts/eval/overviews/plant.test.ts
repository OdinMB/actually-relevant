import { describe, it, expect } from 'vitest'
import {
  cumulativeSwap,
  droppedQualifier,
  expectedSupported,
  FIELD_KINDS,
  plantableNumbers,
  plantFieldVariants,
  plantVariants,
  reworded,
  VARIANT_KINDS,
  wrongAsOf,
  wrongCredit,
  wrongFigure,
  wrongNumber,
  wrongPlace,
  wrongScale,
  wrongYear,
  type PlantableFields,
} from './plant.js'

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
    expect(reworded('Congo reported 14887 deaths.')?.text).toBe('Congo reported about 15000 deaths.')
    expect(reworded('The clinic spent $4887 on fuel.')?.text).toBe('The clinic spent about $4900 on fuel.')
  })

  it('leaves a number already rounded, already qualified, or a year', () => {
    expect(reworded('Congo reported 4,900 deaths.')).toBeNull()
    expect(reworded('Congo reported more than 4,887 deaths.')).toBeNull()
    expect(reworded('In 2024, 15 people died.')).toBeNull()
  })

  it('leaves a bare four-digit number, as often a year, a period or a name as a count', () => {
    expect(reworded('Congo reported 4887 deaths.')).toBeNull()
    expect(reworded('Warming is measured against the 1850-1900 average.')).toBeNull()
    expect(reworded('It is the hottest year since 1880.')).toBeNull()
    expect(reworded('Resolution 1701 ended the war.')).toBeNull()
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

  it('leaves a qualifier before a year, which is no limit on a number', () => {
    expect(droppedQualifier('Exports were up 5% over 2024.')).toBeNull()
    expect(droppedQualifier('Exports were up 5% over 2024, at about 300 tonnes.')?.text).toBe('Exports were up 5% over 2024, at 300 tonnes.')
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

// ---------------------------------------------------------------------------
// Field-level kinds, for module-1 facts (`--facts context`)
// ---------------------------------------------------------------------------

const fields = (extra: Partial<PlantableFields> = {}): PlantableFields => ({
  place: 'Indonesia',
  asOf: '2026-11-14',
  credited: "Indonesia's disaster agency",
  counted: 'total area burned',
  ...extra,
})
const RENDERED =
  "Fires burned 2.88 million hectares this year. [Record: figure: about 2.88 million hectares; counts: total area burned; place: Indonesia; as of: November 14, 2026; credited to: Indonesia's disaster agency]"
const EVIDENCE = 'Fires have burned 2.88 million hectares this year, the agency said on Friday.'

describe('wrongPlace', () => {
  it("names another place among the story's facts", () => {
    expect(wrongPlace(fields(), { places: ['', 'indonesia', 'Malaysia'], credits: [] }, RENDERED, EVIDENCE)).toEqual({
      fields: { place: 'Malaysia' },
      change: 'Indonesia → Malaysia',
    })
  })

  it('finds the place as the first field of a record, and at its end', () => {
    const peers = { places: ['Malaysia'], credits: [] }
    expect(wrongPlace(fields(), peers, 'Fires burned. [Record: place: Indonesia; as of: 2026]', EVIDENCE)?.fields).toEqual({ place: 'Malaysia' })
    expect(wrongPlace(fields(), peers, 'Fires burned. [Record: as of: 2026; place: Indonesia]', EVIDENCE)?.fields).toEqual({ place: 'Malaysia' })
  })

  it("leaves a fact whose record shows no place, or another, even where its statement or what it counts names the fact's", () => {
    const peers = { places: ['Malaysia'], credits: [] }
    expect(wrongPlace(fields({ place: '' }), peers, RENDERED, EVIDENCE)).toBeNull()
    expect(
      wrongPlace(fields(), peers, 'Fires burned in Indonesia. [Record: figure: 2.88 million hectares; counts: area burned in Indonesia]', EVIDENCE),
    ).toBeNull()
    expect(wrongPlace(fields(), peers, "Fires burned. [Record: place: Indonesia's Riau province]", EVIDENCE)).toBeNull()
  })

  it('leaves a place inside the other, and a place the evidence names', () => {
    expect(wrongPlace(fields(), { places: ['Riau, Indonesia', 'Southeast Asia'], credits: [] }, RENDERED, 'Smoke drifted over Southeast Asia.')).toBeNull()
  })
})

describe('wrongCredit', () => {
  it("credits another body named among the story's facts", () => {
    expect(wrongCredit(fields(), { places: [], credits: ['Greenpeace'] }, RENDERED, EVIDENCE)?.fields).toEqual({ credited: 'Greenpeace' })
  })

  it('leaves a fact credited to nobody, and a body the evidence names', () => {
    expect(wrongCredit(fields({ credited: '' }), { places: [], credits: ['Greenpeace'] }, RENDERED, EVIDENCE)).toBeNull()
    expect(wrongCredit(fields(), { places: [], credits: ['the agency'] }, RENDERED, EVIDENCE)).toBeNull()
    expect(wrongCredit(fields(), { places: [], credits: [] }, RENDERED, EVIDENCE)).toBeNull()
  })

  it('leaves a fact whose record credits no one, even where its statement credits the body in its own words', () => {
    const rendered = "Fires burned 2.88 million hectares, according to Indonesia's disaster agency. [Record: figure: 2.88 million hectares]"
    expect(wrongCredit(fields(), { places: [], credits: ['Greenpeace'] }, rendered, EVIDENCE)).toBeNull()
  })
})

describe('wrongAsOf', () => {
  it('moves the month back one, keeping the precision', () => {
    expect(wrongAsOf(fields(), EVIDENCE)).toEqual({ fields: { asOf: '2026-10-14' }, change: '2026-11-14 → 2026-10-14' })
    expect(wrongAsOf(fields({ asOf: '2026-01' }), EVIDENCE)?.fields).toEqual({ asOf: '2025-12' })
    expect(wrongAsOf(fields({ asOf: '2026-03-31' }), EVIDENCE)?.fields).toEqual({ asOf: '2026-02-28' })
  })

  it('moves the year back one for year precision', () => {
    expect(wrongAsOf(fields({ asOf: '2026' }), EVIDENCE)?.fields).toEqual({ asOf: '2025' })
  })

  it('leaves a fact with no as-of date, and a period the evidence also names', () => {
    expect(wrongAsOf(fields({ asOf: null }), EVIDENCE)).toBeNull()
    expect(wrongAsOf(fields(), 'Burned from October to mid-November.')).toBeNull()
    expect(wrongAsOf(fields({ asOf: '2026' }), 'Up from 2.1 million in 2025.')).toBeNull()
  })
})

describe('cumulativeSwap', () => {
  it('swaps a running total for a new count and back', () => {
    expect(cumulativeSwap(fields(), RENDERED, EVIDENCE)).toEqual({ fields: { counted: 'new area burned' }, change: 'total → new' })
    expect(cumulativeSwap(fields({ counted: 'Weekly cases' }), 'Weekly cases: 40', 'Cases rose by 40.')?.fields).toEqual({ counted: 'Cumulative cases' })
    expect(cumulativeSwap(fields({ counted: 'cumulative deaths' }), 'Cumulative deaths: 9', 'Nine died.')?.fields).toEqual({ counted: 'weekly deaths' })
  })

  it('leaves a count with none of the words, a place name, a count not shown, and a word the evidence uses', () => {
    expect(cumulativeSwap(fields({ counted: 'area burned' }), RENDERED, EVIDENCE)).toBeNull()
    expect(cumulativeSwap(fields({ counted: 'cases in New York' }), 'Cases in New York: 40', 'Forty cases.')).toBeNull()
    expect(cumulativeSwap(fields(), 'Fires burned 2.88 million hectares (in Indonesia)', EVIDENCE)).toBeNull()
    expect(cumulativeSwap(fields(), RENDERED, 'The new fires added to the total.')).toBeNull()
  })
})

describe('wrongFigure', () => {
  const figure = (value: number, valueHigh: number | null = null) => ({ value, valueHigh })

  it('multiplies a figure by 1.5 at the precision it had', () => {
    expect(wrongFigure(figure(2_880_000), EVIDENCE)).toEqual({ value: 4_320_000, valueHigh: null })
    expect(wrongFigure(figure(4887), EVIDENCE)).toEqual({ value: 7331, valueHigh: null })
    expect(wrongFigure(figure(2.25), EVIDENCE)).toEqual({ value: 3.38, valueHigh: null })
    expect(wrongFigure(figure(-12), EVIDENCE)).toEqual({ value: -18, valueHigh: null })
  })

  it('doubles a figure where 1.5 at its precision leaves it unchanged', () => {
    // 0.01 × 1.5 is 0.015 just below its decimal in floating point, which rounds back to 0.01 at two decimals
    expect(Number((0.01 * 1.5).toFixed(2))).toBe(0.01)
    expect(wrongFigure(figure(0.01), EVIDENCE)).toEqual({ value: 0.02, valueHigh: null })
  })

  it("changes a range's two ends alike", () => {
    expect(wrongFigure(figure(5000, 5400), EVIDENCE)).toEqual({ value: 7500, valueHigh: 8100 })
    expect(wrongFigure(figure(0, 10), EVIDENCE)).toEqual({ value: 0, valueHigh: 15 })
  })

  it('gives none for a figure neither factor changes', () => {
    expect(wrongFigure(figure(0), EVIDENCE)).toBeNull()
    expect(wrongFigure(figure(0, 0), EVIDENCE)).toBeNull()
  })

  it("gives none where the source's words state the planted value or either planted end", () => {
    expect(wrongFigure(figure(2_880_000), 'Fires burned 2.88 million hectares, up from 4.32 million last year.')).toBeNull()
    expect(wrongFigure(figure(5000, 5400), 'Between 5,000 and 5,400 people fled; 8,100 had fled by May.')).toBeNull()
  })
})

describe('plantFieldVariants', () => {
  it('gives each field-level kind that applies, in order', () => {
    const variants = plantFieldVariants(fields(), { places: ['Malaysia'], credits: ['Greenpeace'] }, RENDERED, EVIDENCE)
    expect(variants.map(v => v.kind)).toEqual([...FIELD_KINDS])
    expect(FIELD_KINDS.every(k => !expectedSupported(k))).toBe(true)
  })
})
