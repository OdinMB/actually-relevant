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

  it("keeps a range's upper end only above its lower one", () => {
    const people = { unit: 'people', counted: 'people displaced' }
    expect(structured(answer({ ...people, value: 800_000, valueHigh: 0 })).valueHigh).toBeNull()
    expect(structured(answer({ ...people, value: 1029, valueHigh: -1 })).valueHigh).toBeNull()
    expect(structured(answer({ ...people, value: 8000, valueHigh: 8000 })).valueHigh).toBeNull()
    expect(structured(answer({ ...people, value: 400, valueHigh: 500 })).valueHigh).toBe(500)
  })
})
