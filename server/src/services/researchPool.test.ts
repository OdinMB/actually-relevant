import { describe, expect, it } from 'vitest'
import { nextFactRef, nextSourceRef, poolFactKey, sourceKey } from './researchPool.js'

describe('the pool refs', () => {
  it('number a new page after the highest page ref, S0 being the original', () => {
    expect(nextSourceRef([], false)).toBe('S0')
    expect(nextSourceRef(['S0', 'S3', 'E2'], false)).toBe('S4')
  })

  it('number our earlier stories apart from the pages, from E1', () => {
    expect(nextSourceRef(['S0', 'S1'], true)).toBe('E1')
    expect(nextSourceRef(['S0', 'E1', 'E2'], true)).toBe('E3')
  })

  it("number a source's new fact after its highest, never another source's", () => {
    expect(nextFactRef('S2', [])).toBe('S2F1')
    expect(nextFactRef('S2', ['S2F1', 'S2F4', 'S12F9', 'S1F7'])).toBe('S2F5')
  })
})

describe('poolFactKey', () => {
  const page = { url: 'https://www.example.com/a?utm_source=x', earlierStoryId: null }

  it('keys a fact on its page, sentence and statement, whatever their spacing and case', () => {
    const a = poolFactKey({ supportingSentence: 'The toll rose to 212.', statement: 'The toll is 212.' }, page)
    const b = poolFactKey(
      { supportingSentence: '  the toll  rose to 212. ', statement: 'THE TOLL IS 212.' },
      { url: 'https://example.com/a', earlierStoryId: null },
    )
    expect(a).toBe(b)
  })

  it('keys an earlier story by its id, not an address it lacks', () => {
    expect(sourceKey({ url: '', earlierStoryId: 'st-1' })).toBe('story:st-1')
    expect(poolFactKey({ supportingSentence: 's', statement: 't' }, { url: '', earlierStoryId: 'st-1' })).not.toBe(
      poolFactKey({ supportingSentence: 's', statement: 't' }, { url: '', earlierStoryId: 'st-2' }),
    )
  })
})
