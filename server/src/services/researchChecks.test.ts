import { describe, it, expect } from 'vitest'
import {
  checkCitations,
  checkCopying,
  decideGate,
  draftItems,
  dropFailing,
  evidenceFor,
  judgedProblems,
  publishedFact,
  quotedSpans,
  sourceLines,
  supportFound,
  withoutInlineIds,
  wordTokens,
  type CitationProblem,
  type PoolFact,
  type WordingSource,
} from './researchChecks.js'
import type { Draft, FactCheck } from '../schemas/research.js'

const fact = (id: string, statement: string, supportingSentence = statement, measures = ''): PoolFact => ({ id, statement, supportingSentence, measures })
const POOL = new Map(
  [
    fact(
      'S0F1',
      'Pakistan added 22 GW of rooftop solar in two years.',
      'Pakistan has added 22GW of rooftop solar in just two years.',
      'rooftop solar capacity, 2024-2025',
    ),
    fact('S1F1', 'Analysts count about 32 GW of all solar over 2024-25.'),
    fact('E1F1', 'Pakistan imported large volumes of Chinese panels in 2024.'),
  ].map(f => [f.id, f]),
)

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

describe('checkCitations', () => {
  it('passes paragraphs whose numbers appear in their cited facts, a number of each cited source among them', () => {
    const d = draft(
      [['Pakistan added 22 GW of rooftop solar in two years. Counting all solar, analysts put it at about 32 GW.', ['S0F1', 'S1F1']]],
      [['Cheap panels let households cut their bills.', []]],
    )
    expect(checkCitations(d, POOL)).toEqual([])
  })

  it('flags a fact id that is not in the pool, as a fact problem the code found', () => {
    const problems = checkCitations(draft([['Pakistan added rooftop solar quickly.', ['S0F1', 'S4F2']]]), POOL)
    expect(problems).toEqual([expect.objectContaining({ label: 'Story paragraph 1', kind: 'fact', by: 'code', problem: expect.stringContaining('S4F2') })])
  })

  it('flags a number none of the cited facts states', () => {
    const problems = checkCitations(draft([['Pakistan added 38 GW of rooftop solar in two years.', ['S0F1']]]), POOL)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('"38"')
  })

  it('needs a citation behind every story paragraph, but lets a bullet that only judges go uncited', () => {
    const d = draft([['The shift happened without a national plan.', []]], [['This matters far beyond one country.', []]], [['Grid upgrades lag behind.', []]])
    const problems = checkCitations(d, POOL)
    expect(problems.map(p => p.label)).toEqual(['Story paragraph 1'])
    expect(problems[0]?.problem).toMatch(/cites no fact/)
  })

  it('flags an uncited bullet that states a number, and never checks the title, summary or blurb for citations', () => {
    const problems = checkCitations(
      draft([['Pakistan added 22 GW of rooftop solar in two years.', ['S0F1']]], [['Some 40 million people now use solar power.', []]], [], {
        title: '40 million people use solar',
        summary: '40 million people use solar.',
        marketingBlurb: '40 million people use solar.',
      }),
      POOL,
    )
    expect(problems.map(p => p.label)).toEqual(['Why This Matters 1'])
  })
})

describe('evidenceFor', () => {
  it('gives the cited facts first, then the other facts of their sources, since readers see a citation per source', () => {
    const pool = new Map([fact('S0F1', 'a'), fact('S0F2', 'b'), fact('S1F1', 'c'), fact('E1F1', 'd'), fact('E1F2', 'e')].map(f => [f.id, f]))
    expect(evidenceFor(['S0F2', 'E1F1', 'S9F1'], pool).map(f => f.id)).toEqual(['S0F2', 'E1F1', 'S0F1', 'E1F2'])
  })

  it('lets the number check find a figure in another fact of a cited source', () => {
    const pool = new Map([...POOL, ['S0F2', fact('S0F2', 'The boom cut grid demand.')]])
    expect(checkCitations(draft([['Pakistan added 22 GW of rooftop solar in two years.', ['S0F2']]]), pool)).toEqual([])
  })
})

describe('draftItems', () => {
  it('labels every written field the checks read, in the order the judge sees them', () => {
    const d = draft(
      [
        ['a', ['S0F1']],
        ['b', ['S1F1']],
      ],
      [['c', []]],
      [['d', ['S0F1']]],
    )
    expect(draftItems(d).map(i => [i.label, i.cited])).toEqual([
      ['Title', false],
      ['Story paragraph 1', true],
      ['Story paragraph 2', true],
      ['Why This Matters 1', true],
      ['Caveat 1', true],
      ['Summary', false],
      ['Blurb', false],
    ])
  })
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
const copyingOf = (text: string, sources: WordingSource[], over: Partial<Parts> = {}) => checkCopying(draft([[text, ['S1F1']]], [], [], over), sources, 12)

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
})

describe('judgedProblems', () => {
  const d = draft([['Wheat area grows.', ['S1F1']]], [['It matters.', []]])
  const items = draftItems(d).map(item => ({ item, evidence: item.cited && item.factIds.length > 0 ? [fact('S1F1', 'Wheat area grows.')] : [] }))
  const lines = sourceLines([source('S1', { voices: [{ quote: 'Wir säen mehr.' }] })])
  const verdict = (number: number, over: Partial<FactCheck['items'][number]> = {}) => ({
    number,
    supported: true,
    problem: '',
    key: false,
    copiedSentence: '',
    followsSource: '',
    ...over,
  })

  it('maps each verdict back to its item by number, a support failure only where the item has evidence', () => {
    const answer: FactCheck = {
      items: [
        verdict(1, { supported: false, problem: 'no title claim' }),
        verdict(2, { supported: false, problem: 'the area is not stated', key: true }),
        verdict(3, { supported: false, problem: 'a judging bullet' }),
      ],
    }
    expect(judgedProblems(answer, items, lines)).toEqual([
      { label: 'Story paragraph 1', text: 'Wheat area grows.', problem: 'fails the fact check: the area is not stated', kind: 'fact', by: 'judge', key: true },
    ])
  })

  it('turns a close rendering and a followed source into copying problems, never key, and ignores ids the prompt did not give', () => {
    const answer: FactCheck = {
      items: [
        verdict(1, { copiedSentence: 'S1T' }),
        verdict(2, { copiedSentence: 'S1Q1', followsSource: 'S1' }),
        verdict(3, { copiedSentence: 'S7F2', followsSource: 'none' }),
        verdict(9, { copiedSentence: 'S1F1' }),
      ],
    }
    expect(judgedProblems(answer, items, lines)).toEqual([
      { label: 'Title', text: 'Rooftop panels spread', problem: 'renders S1T closely', kind: 'copying', by: 'judge', sourceId: 'S1', copiedSentence: 'S1T' },
      {
        label: 'Story paragraph 1',
        text: 'Wheat area grows.',
        problem: 'renders S1Q1 closely',
        kind: 'copying',
        by: 'judge',
        sourceId: 'S1',
        copiedSentence: 'S1Q1',
      },
      { label: 'Story paragraph 1', text: 'Wheat area grows.', problem: "follows S1's order and wording", kind: 'copying', by: 'judge', sourceId: 'S1' },
    ])
  })
})

describe('sourceLines', () => {
  it("gives each outside source's title, supporting sentences and quotes under their ids, then its statements; never our own stories", () => {
    const lines = sourceLines([
      source('S2', { voices: [{ quote: '' }, { quote: 'Wir säen mehr.' }] }),
      { ...source('E1'), facts: [{ id: 'E1F1', statement: 'Ours.', supportingSentence: 'Ours.' }] },
    ])
    expect(lines.map(l => [l.id, l.role])).toEqual([
      ['S2T', 'title'],
      ['S2F1', 'sentence'],
      ['S2Q2', 'quote'],
      ['S2F1', 'statement'],
    ])
  })
})

describe('dropFailing', () => {
  const d = (): Parts =>
    draft(
      [
        ['lead', ['S0F1']],
        ['second', ['S0F1']],
        ['third', ['S0F1']],
      ],
      [
        ['why 1', []],
        ['why 2', []],
      ],
      [['caveat', []]],
    )
  const problem = (label: string, over: Partial<CitationProblem> = {}): CitationProblem => ({
    label,
    text: '',
    problem: 'fails the fact check',
    kind: 'fact',
    by: 'judge',
    ...over,
  })

  it('drops the failing later paragraphs and bullets, counting an item with several problems once', () => {
    const out = dropFailing(d(), [problem('Story paragraph 2'), problem('Story paragraph 2', { kind: 'copying', by: 'code' }), problem('Why This Matters 2')])
    expect(out).toEqual({
      draft: {
        ...d(),
        story: cited([
          ['lead', ['S0F1']],
          ['third', ['S0F1']],
        ]),
        whyThisMatters: cited([['why 1', []]]),
      },
    })
  })

  it('fails on an unsupported key claim, naming its item', () => {
    expect(dropFailing(d(), [problem('Story paragraph 2', { key: true })])).toEqual({
      failed: 'a key claim failed the check after one rewrite (Story paragraph 2)',
      failedOn: 'Story paragraph 2',
    })
  })

  it.each(['Story paragraph 1', 'Title', 'Summary', 'Blurb'])('fails when %s still fails, since it cannot be dropped', label => {
    expect(dropFailing(d(), [problem('Story paragraph 3'), problem(label, { kind: 'copying' })])).toEqual({
      failed: `an item that cannot be dropped failed the check after one rewrite (${label})`,
      failedOn: label,
    })
  })

  it('fails when a part is left empty, naming its first failing item', () => {
    expect(dropFailing(d(), [problem('Caveat 1')])).toEqual({ failed: 'no caveat passed the check after one rewrite', failedOn: 'Caveat 1' })
    expect(dropFailing(d(), [problem('Why This Matters 2'), problem('Why This Matters 1')])).toEqual({
      failed: 'no Why This Matters bullet passed the check after one rewrite',
      failedOn: 'Why This Matters 1',
    })
  })
})

describe('withoutInlineIds', () => {
  it('removes bracketed and parenthesised fact ids from every text, and keeps the factIds lists', () => {
    const d = draft([['Pakistan added 22 GW. [S0F1] It grew [S1F7, E1F2] fast (S2F3).', ['S0F1']]], [['Why [S0F1; S1F1]', []]])
    expect(withoutInlineIds(d)).toEqual(draft([['Pakistan added 22 GW. It grew fast.', ['S0F1']]], [['Why', []]]))
  })

  it('leaves other brackets alone', () => {
    expect(withoutInlineIds('A rise (about 5%) [sic]')).toBe('A rise (about 5%) [sic]')
  })
})

describe('publishedFact', () => {
  it('gives a source date as fact F0 with weekday, month and day, so a dated paragraph passes the number check', () => {
    const [f] = publishedFact('S1', 'qz.com', '2026-11-11T09:00:00Z')
    expect(f).toEqual({ id: 'S1F0', statement: 'qz.com published this on Wednesday, November 11, 2026.', supportingSentence: '', measures: '' })
    const pool = new Map([...POOL, ['S1F0', f!]])
    expect(checkCitations(draft([['On Wednesday, November 11, analysts counted about 32 GW of all solar.', ['S1F1']]]), pool)).toEqual([])
  })

  it('gives nothing for a missing or unreadable date', () => {
    expect(publishedFact('S1', 'x', null)).toEqual([])
    expect(publishedFact('S1', 'x', 'unknown')).toEqual([])
  })
})

describe('supportFound', () => {
  const page = 'The minister said:\n“We have added  22GW of rooftop solar in just two years,” at COP31.'

  it('finds a supporting sentence despite whitespace, quote and case differences', () => {
    expect(supportFound('"We have added 22GW of rooftop solar in just two years," at COP31.', page)).toBe(true)
    expect(supportFound('we have added 22gw of rooftop solar', page)).toBe(true)
  })

  it('does not find a sentence the text does not contain', () => {
    expect(supportFound('We have added 32GW of solar.', page)).toBe(false)
    expect(supportFound('   ', page)).toBe(false)
  })
})

describe('decideGate', () => {
  const ok = { rating: 6, oldNews: { isOld: false, firstHappened: 'unknown' }, contradicted: { isContradicted: false, factIds: [] } }

  it('keeps a draft that passes every gate', () => {
    expect(decideGate({ draft: ok }, 5)).toEqual({ kind: 'keep' })
  })

  it('names what research found first, old news then a contradiction, and only then a rating below the bar', () => {
    const all = { rating: 4, oldNews: { isOld: true, firstHappened: '2025-03-01' }, contradicted: { isContradicted: true, factIds: ['S2F1'] } }
    expect(decideGate({ draft: all }, 5)).toEqual({ kind: 'stale', firstHappened: '2025-03-01' })
    expect(decideGate({ draft: { ...all, oldNews: ok.oldNews } }, 5)).toEqual({ kind: 'contradicted', factIds: ['S2F1'] })
    expect(decideGate({ draft: { ...ok, rating: 4 } }, 5)).toEqual({ kind: 'research-rating', rating: 4 })
    expect(decideGate({ draft: { ...ok, rating: 5 } }, 5)).toEqual({ kind: 'keep' })
  })

  it('falls back with the reason and its category when research failed', () => {
    expect(decideGate({ failed: 'no usable source', category: 'no_other_coverage' }, 5)).toEqual({
      kind: 'fallback',
      reason: 'no usable source',
      category: 'no_other_coverage',
    })
  })
})
