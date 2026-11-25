import { describe, it, expect } from 'vitest'
import { cutAtSentenceEnd, NEAR_CHARS, sentenceEnds } from './sentences.js'

/** Lower-case words without a stop, `5n - 1` characters long. */
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

describe('sentenceEnds', () => {
  it('gives the index just past each stop and its closing marks, before the space that follows', () => {
    const passage = 'The vote passed. “It is done.” The mayor left.'
    expect(sentenceEnds(passage)).toEqual([passage.indexOf(' “It'), passage.indexOf(' The mayor')])
  })
})

describe('cutAtSentenceEnd', () => {
  it('returns a text that fits whole', () => {
    const text = `${words(50)}. ${words(50)}`
    expect(cutAtSentenceEnd(text, text.length)).toBe(text)
  })

  it('cuts at the last sentence end inside the limit, never in the middle of a sentence and without the space after it', () => {
    const kept = `${words(180)}. The council voted.`
    expect(cutAtSentenceEnd(`${kept} It adjourned ${words(60)}`, 1000)).toBe(kept)
  })

  it('keeps a sentence that ends exactly at the limit, reading past the limit to see that a sentence follows', () => {
    const kept = `${words(180)}. The council voted.`
    const text = `${kept} Then it adjourned for the winter. ${words(60)}`
    expect(cutAtSentenceEnd(text, kept.length)).toBe(kept)
    expect(cutAtSentenceEnd(text, kept.length - 1)).toBe(`${words(180)}.`)
  })

  it('never ends at the stop of an initial, a title or a dotted abbreviation', () => {
    const text = `${words(180)}. The vote moved after Gen. Ellison wrote to the U.S. Senate about ${words(60)}`
    expect(cutAtSentenceEnd(text, text.indexOf('Senate') + 3)).toBe(`${words(180)}.`)
  })

  it('ends at a line break where no sentence ends near the limit, as in a list or a table, and drops the space before it', () => {
    const text = `${words(180)}\n${words(10)}  \r\n${words(100)}`
    expect(cutAtSentenceEnd(text, 1000)).toBe(`${words(180)}\n${words(10)}`)
  })

  it('ends at the last sentence end rather than at a later line break, which may follow a heading, a caption or a wrapped line', () => {
    const kept = `${words(180)}. The council voted.`
    const text = `${kept}\n\nRising discontent\n${words(100)}`
    expect(cutAtSentenceEnd(text, text.indexOf('discontent') + 20)).toBe(kept)
  })

  describe('in a text scraped with no space after its stops', () => {
    // 499 characters, then a stop joined to the next sentence
    const lead = `${words(100)}.`

    it('ends at a stop between a lower-case word and a capital or an opening quote', () => {
      const kept = `${lead}The council voted on Monday.`
      expect(cutAtSentenceEnd(`${kept}The mayor signed it ${words(150)}`, 600)).toBe(kept)
      const quoted = `${lead}“It is done,” the mayor said.`
      expect(cutAtSentenceEnd(`${quoted}“We will see,” ${words(150)}`, 600)).toBe(quoted)
    })

    it('never at the stop of a title or abbreviation, nor inside a dotted name', () => {
      expect(cutAtSentenceEnd(`${lead}The vote moved after Gen.Ellison wrote to the U.S.Senate about ${words(150)}`, 600)).toBe(lead)
    })

    it("takes a line break before a joined stop: a line's end is a surer boundary than a stop no space follows", () => {
      const kept = `${lead}The council voted on Monday.The mayor signed`
      expect(cutAtSentenceEnd(`${kept}\n${words(150)}`, 600)).toBe(kept)
    })

    it('ends at a spaced sentence end where the stretch holds one, though a joined stop comes later', () => {
      const kept = `${lead}The council voted.`
      expect(cutAtSentenceEnd(`${kept} It adjourned on Monday.The mayor ${words(150)}`, 600)).toBe(kept)
    })
  })

  it('cuts at the limit when no sentence end or line break lies near it', () => {
    const early = `${words(60)}. The ${words(300)}`
    const limit = early.indexOf('.') + 1 + NEAR_CHARS + 100
    expect(cutAtSentenceEnd(early, limit)).toBe(early.slice(0, limit))
    const none = words(300)
    expect(cutAtSentenceEnd(none, 1000)).toBe(none.slice(0, 1000))
  })

  it('ends at a CJK full stop, which takes no space after it', () => {
    const kept = `${'字'.repeat(900)}。该工厂雇用三千名工人。`
    expect(cutAtSentenceEnd(`${kept}${'字'.repeat(300)}`, 1000)).toBe(kept)
  })

  it('always gives a start of the text, never longer than the limit', () => {
    const texts = [
      `${words(180)}. The council voted. Then it adjourned. ${words(100)}`,
      `${words(150)}\r\n${words(40)}. “It is done.” ${words(100)}`,
      `${'字'.repeat(700)}。“我们准备好了。”他说。${'字'.repeat(500)}`,
      `${words(100)}.The council voted on Monday.The mayor signed it.Residents ${words(150)}`,
      words(250),
    ]
    for (const text of texts) {
      for (let limit = 300; limit <= 1300; limit += 37) {
        const cut = cutAtSentenceEnd(text, limit)
        expect(text.startsWith(cut)).toBe(true)
        expect(cut.length).toBeLessThanOrEqual(limit)
      }
    }
  })
})
