import { describe, it, expect } from 'vitest'
import { checkedQuote, quoteFound, quoteProblems, withoutFailedQuote } from './researchQuote.js'
import { sourceLines, type WordingSource } from './researchCopying.js'
import type { CitationProblem } from './researchChecks.js'

const SAID = 'We will close every coal plant in the province by 2030, the minister said on Monday.'

describe('quoteFound', () => {
  it('finds the quote as a run of words of one line, whatever its quote marks, punctuation and case', () => {
    expect(quoteFound('We will close every coal plant in the province by 2030', [SAID])).toBe(true)
    expect(quoteFound('“We will close every coal plant in the province by 2030.”', [SAID])).toBe(true)
    expect(quoteFound('we will close EVERY coal plant, in the province, by 2030', [SAID])).toBe(true)
  })

  it('lets a bracketed insertion stand for the words it replaces, or for none', () => {
    expect(quoteFound('[The government] will close every coal plant in the province by 2030', [SAID])).toBe(true)
    expect(quoteFound('We will close every coal plant [in Punjab] by 2030', ['We will close every coal plant by 2030.'])).toBe(true)
    expect(quoteFound('[T]hey will close every coal plant', ['They will close every coal plant, she said.'])).toBe(true)
  })

  it('lets an ellipsis stand for words left out, in every spelling', () => {
    expect(quoteFound('We will close every coal plant … by 2030', [SAID])).toBe(true)
    expect(quoteFound('We will close every coal plant ... by 2030', [SAID])).toBe(true)
    expect(quoteFound('We will close every coal plant [...] by 2030', [SAID])).toBe(true)
    expect(quoteFound('…every coal plant in the province', [SAID])).toBe(true)
  })

  it('needs the parts in their order, in one line', () => {
    expect(quoteFound('by 2030 … We will close every coal plant', [SAID])).toBe(false)
    expect(quoteFound('We will close every coal plant … by 2030', ['We will close every coal plant.', 'It happens by 2030.'])).toBe(false)
  })

  it('does not find an invented word, a translation, or a quote without words', () => {
    expect(quoteFound('We will close every gas plant in the province by 2030', [SAID])).toBe(false)
    expect(quoteFound('We will close every coal plant', ['Wir werden jedes Kohlekraftwerk schließen.'])).toBe(false)
    expect(quoteFound(' … ', [SAID])).toBe(false)
  })
})

const source = (id: string, over: Partial<WordingSource> = {}): WordingSource => ({
  id,
  title: 'We will close every coal plant',
  facts: [{ id: `${id}F1`, statement: 'We will close every coal plant, a statement says.', supportingSentence: SAID }],
  voices: [{ name: 'Ayesha Khan', role: 'energy minister', quote: 'Coal has no future here.' }],
  ...over,
})
const SOURCES = [source('S0'), source('S1', { facts: [], voices: [{ name: 'Ali Raza', role: 'analyst', quote: 'It will cost billions.' }] })]
const IDS = new Set(SOURCES.map(s => s.id))
const quote = (text: string, sourceId: string, quoteAttribution = 'Ayesha Khan, energy minister') => ({
  quote: text,
  quoteAttribution,
  quoteSourceId: sourceId,
})

describe('checkedQuote', () => {
  const lines = sourceLines(SOURCES)

  it('makes the key quote an item for the fact check, with the source it names and who it says spoke', () => {
    expect(checkedQuote(quote('Coal has no future here.', 'S0'), lines, IDS)).toEqual({
      item: { part: 'quote', label: 'Key quote', text: 'Coal has no future here.', cited: false, factIds: [] },
      evidence: [],
      numberHints: [],
      quote: { sourceId: 'S0', attribution: 'Ayesha Khan, energy minister', found: true },
    })
  })

  it("looks for its words in that source's quotes and supporting sentences only: not its title or statements, nor another source", () => {
    const found = (text: string, sourceId: string) => checkedQuote(quote(text, sourceId), lines, IDS)?.quote?.found
    expect(found('We will close every coal plant in the province', 'S0')).toBe(true)
    expect(found('It will cost billions', 'S1')).toBe(true)
    expect(found('It will cost billions', 'S0')).toBe(false)
    expect(found('We will close every coal plant, a statement says', 'S0')).toBe(false)
    // Only S1's title holds these words
    expect(found('We will close every coal plant', 'S1')).toBe(false)
  })

  it('gives no item for an empty quote, nor for one whose source is not among the sources', () => {
    expect(checkedQuote(quote('', ''), lines, IDS)).toBeNull()
    expect(checkedQuote(quote('Coal has no future here.', 'S9'), lines, IDS)).toBeNull()
    expect(checkedQuote(quote('Coal has no future here.', 'E1'), lines, IDS)).toBeNull()
  })
})

describe('quoteProblems', () => {
  it.each(['S9', 'E1', 'S0Q1', ''])('fails a key quote whose source id %j is not one of the sources, in code', id => {
    expect(quoteProblems(quote('Coal has no future here.', id), IDS)).toEqual([
      expect.objectContaining({
        label: 'Key quote',
        text: 'Coal has no future here.',
        kind: 'fact',
        by: 'code',
        problem: expect.stringContaining('not one of the sources'),
      }),
    ])
  })

  it('passes a quote that names a source, and has nothing to say about no quote', () => {
    expect(quoteProblems(quote('Coal has no future here.', 'S1'), IDS)).toEqual([])
    expect(quoteProblems(quote('', 'S9'), IDS)).toEqual([])
  })
})

describe('withoutFailedQuote', () => {
  const draft = { title: 'Coal plants close', ...quote('Coal has no future here.', 'S0') }
  const problem = (label: string): CitationProblem => ({ label, text: '', problem: 'fails the fact check', kind: 'fact', by: 'judge' })

  it('empties the quote, its attribution and its source when the last check still failed it', () => {
    expect(withoutFailedQuote(draft, [problem('Story paragraph 2'), problem('Key quote')])).toEqual({
      title: 'Coal plants close',
      quote: '',
      quoteAttribution: '',
      quoteSourceId: '',
    })
  })

  it('keeps it when the check failed other items only', () => {
    expect(withoutFailedQuote(draft, [problem('Story paragraph 2')])).toEqual(draft)
  })
})
