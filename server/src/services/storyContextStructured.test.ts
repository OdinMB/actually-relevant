import { describe, expect, it } from 'vitest'
import type { StructuredFact } from '../schemas/factFields.js'
import { structured } from './storyContextPipeline.js'

/** The model's answer for one fact: it never leaves the nullable numbers null, so the defaults are its junk. */
const answer = (over: Partial<StructuredFact>): StructuredFact =>
  ({
    value: 0,
    valueHigh: 0,
    unit: '',
    approx: 'exact',
    provisional: false,
    counted: '',
    place: '',
    asOf: '',
    credited: '',
    creditedKind: 'none',
    validity: 'fast',
    ...over,
  }) as StructuredFact

describe('structured', () => {
  it('reads a number with neither a unit nor a thing counted as no figure', () => {
    expect(structured(answer({ value: 0, valueHigh: 0, credited: 'Jean Kaseya' }))).toMatchObject({ value: null, valueHigh: null })
    expect(structured(answer({ value: 14, valueHigh: -1 }))).toMatchObject({ value: null, valueHigh: null })
  })

  it('keeps a figure that names its unit or what it counts, zero included', () => {
    expect(structured(answer({ value: 0, unit: 'tankers', counted: 'tankers crossing the strait' }))).toMatchObject({ value: 0, valueHigh: null })
    expect(structured(answer({ value: 81, valueHigh: 0, unit: '%' }))).toMatchObject({ value: 81, valueHigh: null })
  })

  it('reads a filler the model wrote into a text field as empty, in any case, trimmed, with or without a closing period', () => {
    const fillers = [
      'none',
      'Unknown',
      ' N/A ',
      'null',
      'Not specified.',
      'unspecified',
      'NOT STATED',
      'not given',
      'Not applicable',
      'not available',
      '-',
      '–',
      '—',
    ]
    for (const filler of fillers) {
      const out = structured(answer({ value: 12, unit: 'people', counted: filler, place: filler, credited: filler }))
      expect(out, filler).toMatchObject({ counted: '', place: '', credited: '' })
      expect(structured(answer({ value: 12, unit: filler, counted: 'people evacuated' })).unit, filler).toBe('')
    }
  })

  it('reads a number whose unit and thing counted are fillers as no figure', () => {
    expect(structured(answer({ value: 3, valueHigh: 5, unit: 'none', counted: 'N/A' }))).toMatchObject({ value: null, valueHigh: null, unit: '', counted: '' })
  })

  it('credits no kind of body when the credit is a filler', () => {
    expect(structured(answer({ credited: 'Unknown', creditedKind: 'official' }))).toMatchObject({ credited: '', creditedKind: null })
  })

  it('keeps a field that only contains a filler word', () => {
    const out = structured(
      answer({
        value: 4,
        unit: 'provinces',
        counted: 'None of the provinces reporting',
        place: 'Unknown Soldier memorial',
        credited: 'n/a press office',
        creditedKind: 'other',
      }),
    )
    expect(out).toMatchObject({
      value: 4,
      counted: 'None of the provinces reporting',
      place: 'Unknown Soldier memorial',
      credited: 'n/a press office',
      creditedKind: 'other',
    })
  })

  it("keeps a range's upper end only above its lower one", () => {
    const people = { unit: 'people', counted: 'people displaced' }
    expect(structured(answer({ ...people, value: 800_000, valueHigh: 0 })).valueHigh).toBeNull()
    expect(structured(answer({ ...people, value: 1029, valueHigh: -1 })).valueHigh).toBeNull()
    expect(structured(answer({ ...people, value: 8000, valueHigh: 8000 })).valueHigh).toBeNull()
    expect(structured(answer({ ...people, value: 400, valueHigh: 500 })).valueHigh).toBe(500)
  })
})
