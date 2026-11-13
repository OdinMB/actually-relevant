import { describe, it, expect } from 'vitest'
import { checkCopying, quotedSpans, sourceLines, wordTokens, type WordingSource } from './researchCopying.js'
import { draftItems } from './researchChecks.js'
import type { Draft } from '../schemas/research.js'

type Parts = Pick<Draft, 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb'>
type Cited = [string, string[]]
const cited = (items: Cited[]) => items.map(([text, factIds]) => ({ text, factIds }))
const draft = (story: Cited[], whyThisMatters: Cited[] = [], caveats: Cited[] = [], over: Partial<Parts> = {}): Parts => ({
  title: 'Rooftop panels spread',
  story: cited(story),
  whyThisMatters: cited(whyThisMatters),
  caveats: cited(caveats),
  summary: 'Households add panels.',
  marketingBlurb: 'Panels spread fast.',
  ...over,
})

describe('wordTokens', () => {
  it('splits letters from digits, so a figure reads the same with or without its space', () => {
    expect(wordTokens('22GW')).toEqual(['22', 'gw'])
    expect(wordTokens('22 GW')).toEqual(['22', 'gw'])
  })

  it('joins digit groups however they are written', () => {
    expect(wordTokens('1,200')).toEqual(['1200'])
    expect(wordTokens('1.200')).toEqual(['1200'])
    expect(wordTokens('1 200')).toEqual(['1200'])
    expect(wordTokens('1 200')).toEqual(['1200'])
  })

  it('keeps a word with an apostrophe whole and splits at hyphens', () => {
    expect(wordTokens("Pakistan's")).toEqual(['pakistans'])
    expect(wordTokens('Pakistan’s')).toEqual(['pakistans'])
    expect(wordTokens('long-term')).toEqual(['long', 'term'])
    expect(wordTokens('long–term')).toEqual(['long', 'term'])
  })

  it('makes % and currency symbols tokens of their own, and drops case, soft hyphens and punctuation', () => {
    expect(wordTokens('5% for €30')).toEqual(['5', '%', 'for', '€', '30'])
    expect(wordTokens('Solar­energie, “really”!')).toEqual(['solarenergie', 'really'])
  })
})

describe('quotedSpans', () => {
  it('finds spans between the quote marks of one family, in any language', () => {
    expect(quotedSpans('Er sagte „wir säen mehr“ und ging.')).toEqual(['wir säen mehr'])
    expect(quotedSpans('Il a dit «nous semons plus» hier.')).toEqual(['nous semons plus'])
    expect(quotedSpans('Sie schrieb »mehr als je zuvor« dazu.')).toEqual(['mehr als je zuvor'])
    expect(quotedSpans('He said “we sow more” and left.')).toEqual(['we sow more'])
    expect(quotedSpans('He said "we sow more" and left.')).toEqual(['we sow more'])
    expect(quotedSpans("He called it 'a record year' twice.")).toEqual(['a record year'])
  })

  it('never opens or closes a span at an apostrophe inside a word', () => {
    expect(quotedSpans("Pakistan's farmers and the ministry's experts agree.")).toEqual([])
    expect(quotedSpans('Pakistan’s farmers and the ministry’s experts agree.')).toEqual([])
  })
})

const SENTENCE = 'Farmers in the northern provinces planted drought-tolerant wheat on more land this spring than in any year before.'
const source = (id: string, over: Partial<WordingSource> = {}): WordingSource => ({
  id,
  title: 'Weizen-Rekord',
  facts: [{ id: `${id}F1`, statement: 'The ministry reports a record wheat area.', supportingSentence: SENTENCE }],
  voices: [],
  ...over,
})
const copyingOf = (text: string, sources: WordingSource[], over: Partial<Parts> = {}) =>
  checkCopying(draftItems(draft([[text, ['S1F1']]], [], [], over)), sources, 12)

describe('checkCopying', () => {
  it("flags a run of 12 words shared with one source's wording, naming the source and quoting the run", () => {
    const { problems } = copyingOf('Reports say farmers in the northern provinces planted drought-tolerant wheat on more land, officials added.', [
      source('S1'),
    ])
    expect(problems).toEqual([
      expect.objectContaining({
        label: 'Story paragraph 1',
        kind: 'copying',
        by: 'code',
        sourceId: 'S1',
        against: 'wording',
        problem: expect.stringContaining('"farmers in the northern provinces planted drought tolerant wheat on more land"'),
      }),
    ])
  })

  it('passes 11 shared words', () => {
    expect(copyingOf('Reports say farmers in the northern provinces planted drought-tolerant wheat on more fields.', [source('S1')]).problems).toEqual([])
  })

  it('ignores case, punctuation and quote marks', () => {
    const { problems } = copyingOf('FARMERS, in the Northern provinces — planted “drought-tolerant” wheat on more land.', [source('S1')])
    expect(problems.map(p => p.sourceId)).toEqual(['S1'])
  })

  it('never flags our own earlier stories', () => {
    const ours = { ...source('E1'), facts: [{ id: 'E1F1', statement: SENTENCE, supportingSentence: SENTENCE }] }
    const { problems, longestRuns } = copyingOf('Farmers in the northern provinces planted drought-tolerant wheat on more land.', [ours])
    expect(problems).toEqual([])
    expect(longestRuns).toEqual([])
  })

  it('compares each string on its own, so a run across two strings or two sources does not flag', () => {
    const text = 'Farmers in the northern provinces planted drought-tolerant wheat on more land.'
    const twoStrings = source('S1', {
      facts: [
        { id: 'S1F1', statement: 'x', supportingSentence: 'Farmers in the northern provinces planted' },
        { id: 'S1F2', statement: 'y', supportingSentence: 'drought-tolerant wheat on more land this spring.' },
      ],
    })
    expect(copyingOf(text, [twoStrings]).problems).toEqual([])
    const first = source('S1', { facts: [{ id: 'S1F1', statement: 'x', supportingSentence: 'Farmers in the northern provinces planted' }] })
    const second = source('S2', { facts: [{ id: 'S2F1', statement: 'y', supportingSentence: 'drought-tolerant wheat on more land this spring.' }] })
    expect(copyingOf(text, [first, second]).problems).toEqual([])
  })

  it("flags a run shared with a fact's statement, and records each kind's longest run apart, below the threshold too", () => {
    const german = source('S1', {
      facts: [
        {
          id: 'S1F1',
          statement: 'Farmers in the northern provinces sowed more wheat this spring than in any year before, the ministry says.',
          supportingSentence: 'Die Bauern in den nördlichen Provinzen haben in diesem Frühjahr mehr Weizen gesät als je zuvor.',
        },
      ],
    })
    const { problems, longestRuns } = copyingOf('Farmers in the northern provinces sowed more wheat this spring than in any year before.', [german])
    expect(problems).toEqual([expect.objectContaining({ label: 'Story paragraph 1', sourceId: 'S1', against: 'statement' })])
    expect(longestRuns.filter(r => r.label === 'Story paragraph 1')).toEqual([
      { label: 'Story paragraph 1', sourceId: 'S1', against: 'wording', words: 1 },
      { label: 'Story paragraph 1', sourceId: 'S1', against: 'statement', words: 15 },
    ])
  })

  it('flags a quoted span of 4 words in any item, and passes one of 3', () => {
    const quoted = (text: string) => copyingOf(text, []).problems
    expect(quoted('Officials said „wir säen mehr Weizen“ on Monday.')).toEqual([
      expect.objectContaining({ label: 'Story paragraph 1', kind: 'copying', by: 'code', problem: expect.stringContaining('wir säen mehr Weizen') }),
    ])
    expect(quoted('Officials said «nous semons plus maintenant» on Monday.')).toHaveLength(1)
    expect(quoted('Officials said “we sow more now” on Monday.')).toHaveLength(1)
    expect(quoted('Officials said “we sow more” on Monday.')).toEqual([])
    expect(quoted("Pakistan's farmers and the ministry's experts agree on it.")).toEqual([])
  })

  it('checks the title, summary and blurb too, under those labels', () => {
    const copied = 'Farmers in the northern provinces planted drought-tolerant wheat on more land'
    const { problems } = copyingOf('Wheat area grows.', [source('S1')], { title: copied, summary: copied, marketingBlurb: copied })
    expect(problems.map(p => p.label)).toEqual(['Title', 'Summary', 'Blurb'])
  })

  it("never reads the key quote, the one place for a source's own words, even with a quoted passage in it", () => {
    const keyQuote = { part: 'quote' as const, label: 'Key quote', text: `${SENTENCE} 'More than we ever sowed before,' he added.`, cited: false, factIds: [] }
    const { problems, longestRuns } = checkCopying([...draftItems(draft([['Wheat area grows.', ['S1F1']]])), keyQuote], [source('S1')], 12)
    expect(problems).toEqual([])
    expect(longestRuns.map(r => r.label)).not.toContain('Key quote')
  })
})

describe('sourceLines', () => {
  it("gives each outside source's title, supporting sentences and quotes under their ids, then its statements; never our own stories", () => {
    const lines = sourceLines([
      source('S2', {
        voices: [
          { name: 'A farmer', role: 'grower', quote: '' },
          { name: 'A minister', role: 'minister', quote: 'Wir säen mehr.' },
        ],
      }),
      { ...source('E1'), facts: [{ id: 'E1F1', statement: 'Ours.', supportingSentence: 'Ours.' }] },
    ])
    expect(lines.map(l => [l.id, l.role])).toEqual([
      ['S2T', 'title'],
      ['S2F1', 'sentence'],
      ['S2Q2', 'quote'],
      ['S2F1', 'statement'],
    ])
  })

  it('names who spoke each quote, with their role when the source gives one', () => {
    const lines = sourceLines([
      source('S2', {
        voices: [
          { name: 'Ayesha Khan', role: 'energy minister', quote: 'Coal has no future.' },
          { name: 'Greenpeace', role: '', quote: 'Too late.' },
        ],
      }),
    ])
    expect(lines.filter(l => l.role === 'quote').map(l => [l.id, l.speaker])).toEqual([
      ['S2Q1', 'Ayesha Khan, energy minister'],
      ['S2Q2', 'Greenpeace'],
    ])
  })
})
