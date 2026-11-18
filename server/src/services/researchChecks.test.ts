import { describe, it, expect } from 'vitest'
import {
  checkCitations,
  checkedItems,
  decideGate,
  draftItems,
  dropFailing,
  evidenceFor,
  judgedProblems,
  publishedDay,
  publishedFact,
  supportFound,
  unjudgedLabels,
  withoutInlineIds,
  type CitationProblem,
  type PoolFact,
} from './researchChecks.js'
import { sourceLines, type WordingSource } from './researchCopying.js'
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

  it('never fails an item on a number its cited facts do not state digit for digit: the fact check judges it', () => {
    // A reworded period and a converted unit, both of which the old number check failed
    const d = draft([
      ['Pakistan added 22 GW of rooftop solar in 2024 and 2025.', ['S1F1']],
      ['Analysts count about 32,000 MW of all solar.', ['S1F1']],
    ])
    expect(checkCitations(d, POOL)).toEqual([])
  })

  it('needs a citation behind every story paragraph, but lets a bullet that only judges go uncited', () => {
    const d = draft([['The shift happened without a national plan.', []]], [['This matters far beyond one country.', []]], [['Grid upgrades lag behind.', []]])
    const problems = checkCitations(d, POOL)
    expect(problems.map(p => p.label)).toEqual(['Story paragraph 1'])
    expect(problems[0]?.problem).toMatch(/cites no fact/)
  })

  it('fails no bullet for a number it states without a citation, and never checks the title, summary or blurb for citations', () => {
    const problems = checkCitations(
      draft([['Pakistan added 22 GW of rooftop solar in two years.', ['S0F1']]], [['Some 40 million people now use solar power.', []]], [], {
        title: '40 million people use solar',
        summary: '40 million people use solar.',
        marketingBlurb: '40 million people use solar.',
      }),
      POOL,
    )
    expect(problems).toEqual([])
  })
})

describe('checkedItems', () => {
  const hintsOf = (d: Parts, pool: ReadonlyMap<string, PoolFact> = POOL) => checkedItems(d, pool).map(c => [c.item.label, c.numberHints])

  it('hints each cited item with the numbers its evidence does not state digit for digit, reworded and converted ones included', () => {
    const pool = new Map([...POOL, ['S2F1', fact('S2F1', 'Installations doubled in two years.')]])
    const d = draft(
      [
        ['Installations doubled in 2024 and 2025.', ['S2F1']],
        ['Pakistan added 22,000 MW of rooftop solar in two years.', ['S0F1']],
        ['Pakistan added 22 GW of rooftop solar in two years.', ['S0F1']],
      ],
      [['Some 40 million people now use solar power.', []]],
    )
    expect(hintsOf(d, pool)).toEqual([
      ['Title', []],
      ['Story paragraph 1', ['2024', '2025']],
      ['Story paragraph 2', ['22,000']],
      ['Story paragraph 3', []],
      // A bullet that cites nothing has no evidence, so every number it states is a hint
      ['Why This Matters 1', ['40 million']],
      ['Summary', []],
      ['Blurb', []],
    ])
  })

  it('judges the title, summary and blurb against every fact of the pool, hinting the numbers no fact states; a cited item against its evidence, a judging bullet against none', () => {
    const items = checkedItems(
      draft([['Pakistan added rooftop solar quickly.', ['S0F1']]], [['Some 40 million people now use solar power.', []]], [], {
        // 22 GW is S0F1's, 32 GW S1F1's: neither is cited, and both are in the pool
        title: 'Pakistan adds 22 GW of rooftop solar',
        summary: 'Analysts count about 32 GW of all solar, and 99 GW is planned.',
        marketingBlurb: 'Panels spread fast.',
      }),
      POOL,
    )
    const pool = ['S0F1', 'S1F1', 'E1F1']
    expect(items.map(c => [c.item.label, c.evidence.map(f => f.id), c.againstPool ?? false, c.numberHints])).toEqual([
      ['Title', pool, true, []],
      ['Story paragraph 1', ['S0F1'], false, []],
      ['Why This Matters 1', [], false, ['40 million']],
      ['Summary', pool, true, ['99']],
      ['Blurb', pool, true, []],
    ])
  })
})

describe('evidenceFor', () => {
  it('gives the cited facts first, then the other facts of their sources, since readers see a citation per source', () => {
    const pool = new Map([fact('S0F1', 'a'), fact('S0F2', 'b'), fact('S1F1', 'c'), fact('E1F1', 'd'), fact('E1F2', 'e')].map(f => [f.id, f]))
    expect(evidenceFor(['S0F2', 'E1F1', 'S9F1'], pool).map(f => f.id)).toEqual(['S0F2', 'E1F1', 'S0F1', 'E1F2'])
  })

  it('lets a figure in another fact of a cited source raise no number hint', () => {
    const pool = new Map([...POOL, ['S0F2', fact('S0F2', 'The boom cut grid demand.')]])
    expect(checkedItems(draft([['Pakistan added 22 GW of rooftop solar in two years.', ['S0F2']]]), pool)[1]?.numberHints).toEqual([])
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

const SENTENCE = 'Farmers in the northern provinces planted drought-tolerant wheat on more land this spring than in any year before.'
const source = (id: string, over: Partial<WordingSource> = {}): WordingSource => ({
  id,
  title: 'Weizen-Rekord',
  facts: [{ id: `${id}F1`, statement: 'The ministry reports a record wheat area.', supportingSentence: SENTENCE }],
  voices: [],
  ...over,
})

describe('judgedProblems', () => {
  const d = draft([['Wheat area grows.', ['S1F1']]], [['It matters.', []]])
  const items = draftItems(d).map(item => ({
    item,
    evidence: item.cited && item.factIds.length > 0 ? [fact('S1F1', 'Wheat area grows.')] : [],
    numberHints: [] as string[],
  }))
  const lines = sourceLines([source('S1', { voices: [{ name: 'A farmer', role: '', quote: 'Wir säen mehr.' }] })])
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

  it('counts a support failure on an item that cites nothing once it has number hints, since the fact check then judges its numbers', () => {
    const hinted = items.map(c => (c.item.label === 'Why This Matters 1' ? { ...c, numberHints: ['40 million'] } : c))
    const answer: FactCheck = {
      items: [verdict(1, { supported: false, problem: 'no title claim' }), verdict(3, { supported: false, problem: 'no fact gives 40 million' })],
    }
    expect(judgedProblems(answer, hinted, lines)).toEqual([
      { label: 'Why This Matters 1', text: 'It matters.', problem: 'fails the fact check: no fact gives 40 million', kind: 'fact', by: 'judge', key: false },
    ])
  })

  it('counts a support failure on the title, summary or blurb, judged against every fact of the pool, keeping its key judgment', () => {
    const pooled = checkedItems(d, POOL)
    const answer: FactCheck = {
      items: [
        verdict(1, { supported: false, problem: 'the facts say the first since 1990, not the first', key: true }),
        verdict(3, { supported: false, problem: 'a judging bullet' }),
        verdict(4, { supported: false, problem: 'the facts give no date' }),
      ],
    }
    expect(judgedProblems(answer, pooled, lines)).toEqual([
      {
        label: 'Title',
        text: 'Rooftop panels spread',
        problem: 'fails the fact check: the facts say the first since 1990, not the first',
        kind: 'fact',
        by: 'judge',
        key: true,
      },
      { label: 'Summary', text: 'Households add panels.', problem: 'fails the fact check: the facts give no date', kind: 'fact', by: 'judge', key: false },
    ])
  })

  it('turns a close rendering and a followed source into copying problems, never key, and ignores ids the prompt did not give', () => {
    const twoSources = items.map(c => (c.item.label === 'Story paragraph 1' ? { ...c, item: { ...c.item, factIds: ['S1F1', 'S2F1'] } } : c))
    const answer: FactCheck = {
      items: [
        verdict(1, { copiedSentence: 'S1T' }),
        verdict(2, { copiedSentence: 'S1Q1', followsSource: 'S1' }),
        verdict(3, { copiedSentence: 'S7F2', followsSource: 'none' }),
        verdict(9, { copiedSentence: 'S1F1' }),
      ],
    }
    expect(judgedProblems(answer, twoSources, lines)).toEqual([
      {
        label: 'Title',
        text: 'Rooftop panels spread',
        problem: 'renders S1T ("Weizen-Rekord") closely',
        kind: 'copying',
        by: 'judge',
        sourceId: 'S1',
        copiedSentence: 'S1T',
      },
      {
        label: 'Story paragraph 1',
        text: 'Wheat area grows.',
        problem: 'renders S1Q1 ("Wir säen mehr.") closely',
        kind: 'copying',
        by: 'judge',
        sourceId: 'S1',
        copiedSentence: 'S1Q1',
      },
      { label: 'Story paragraph 1', text: 'Wheat area grows.', problem: "follows S1's order and wording", kind: 'copying', by: 'judge', sourceId: 'S1' },
    ])
  })

  it('ignores a followed source on an item whose citations all come from that one source, whose order it follows by nature', () => {
    const datedToo = items.map(c => (c.item.label === 'Story paragraph 1' ? { ...c, item: { ...c.item, factIds: ['S1F1', 'S1F0'] } } : c))
    const answer: FactCheck = { items: [verdict(2, { followsSource: 'S1' }), verdict(4, { followsSource: 'S1' })] }
    expect(judgedProblems(answer, items, lines)).toEqual([
      { label: 'Summary', text: 'Households add panels.', problem: "follows S1's order and wording", kind: 'copying', by: 'judge', sourceId: 'S1' },
    ])
    expect(judgedProblems(answer, datedToo, lines).map(p => p.label)).toEqual(['Summary'])
  })

  it("quotes the source's own sentence for a fact id, never the fact's statement under the same id", () => {
    const answer: FactCheck = { items: [verdict(2, { copiedSentence: 'S1F1.' })] }
    expect(judgedProblems(answer, items, lines).map(p => p.problem)).toEqual([`renders S1F1 ("${SENTENCE}") closely`])
  })

  describe('on the key quote', () => {
    const quoted = {
      item: { part: 'quote' as const, label: 'Key quote', text: 'We sow more.', cited: false, factIds: [] },
      evidence: [],
      numberHints: [],
      quote: { sourceId: 'S1', attribution: 'A farmer', found: false },
    }
    const withQuote = [...items, quoted]
    const quoteNumber = withQuote.length

    it('turns an unfaithful verdict into a fact problem, though it cites nothing, and never a key one', () => {
      const answer: FactCheck = { items: [verdict(quoteNumber, { supported: false, problem: 'S1 gives these words to the minister', key: true })] }
      expect(judgedProblems(answer, withQuote, lines)).toEqual([
        {
          label: 'Key quote',
          text: 'We sow more.',
          problem: 'fails the fact check: S1 gives these words to the minister',
          kind: 'fact',
          by: 'judge',
          key: false,
        },
      ])
    })

    it('never makes a copying problem of it: it is the one place for a source’s own words', () => {
      const answer: FactCheck = { items: [verdict(quoteNumber, { copiedSentence: 'S1Q1', followsSource: 'S1' })] }
      expect(judgedProblems(answer, withQuote, lines)).toEqual([])
    })
  })
})

describe('unjudgedLabels', () => {
  const items = draftItems(draft([['Wheat area grows.', ['S1F1']]], [['It matters.', []]])).map(item => ({ item }))
  const verdict = (number: number) => ({ number, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })

  it('names the items the answer gives no verdict for, by their place in the prompt', () => {
    expect(unjudgedLabels({ items: [verdict(1), verdict(3), verdict(5), verdict(9)] }, items)).toEqual(['Story paragraph 1', 'Summary'])
    expect(unjudgedLabels({ items: [] }, items)).toEqual(['Title', 'Story paragraph 1', 'Why This Matters 1', 'Summary', 'Blurb'])
  })

  it('names none when every item has a verdict, even twice', () => {
    expect(unjudgedLabels({ items: [1, 2, 3, 4, 5, 2].map(verdict) }, items)).toEqual([])
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

  it('fails on an unsupported key claim in an item the draft cannot do without, naming it', () => {
    expect(dropFailing(d(), [problem('Story paragraph 3'), problem('Story paragraph 1', { key: true })])).toEqual({
      failed: 'a key claim failed the check after repair (Story paragraph 1)',
      failedOn: 'Story paragraph 1',
    })
  })

  it('drops a later paragraph or a bullet the fact check judged key as any failing item: only the main development can be key', () => {
    expect(dropFailing(d(), [problem('Story paragraph 2', { key: true }), problem('Why This Matters 2', { key: true })])).toEqual({
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

  it.each(['Story paragraph 1', 'Title', 'Summary', 'Blurb'])('fails when %s still fails, since it cannot be dropped', label => {
    expect(dropFailing(d(), [problem('Story paragraph 3'), problem(label, { kind: 'copying' })])).toEqual({
      failed: `an item that cannot be dropped failed the check after repair (${label})`,
      failedOn: label,
    })
  })

  it('fails when a part is left empty, naming its first failing item', () => {
    expect(dropFailing(d(), [problem('Caveat 1')])).toEqual({ failed: 'no caveat passed the check after repair', failedOn: 'Caveat 1' })
    expect(dropFailing(d(), [problem('Why This Matters 2'), problem('Why This Matters 1')])).toEqual({
      failed: 'no Why This Matters bullet passed the check after repair',
      failedOn: 'Why This Matters 1',
    })
  })

  it.each([
    ['story', 'Story', 'story paragraph'],
    ['whyThisMatters', 'Why This Matters', 'Why This Matters bullet'],
    ['caveats', 'Caveats', 'caveat'],
  ] as const)('fails a draft with no %s at all under the part name, with problems elsewhere or none', (part, label, noun) => {
    const without = { ...d(), [part]: [] }
    const failed = { failed: `the draft has no ${noun}`, failedOn: label }
    expect(dropFailing(without, [])).toEqual(failed)
    expect(dropFailing(without, [problem('Story paragraph 3'), problem('Why This Matters 2')])).toEqual(failed)
  })

  it('keeps a draft without problems as it is', () => {
    expect(dropFailing(d(), [])).toEqual({ draft: d() })
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
  it('gives a source date as fact F0 with weekday, month and day, so a dated paragraph raises no number hint', () => {
    const [f] = publishedFact('S1', 'qz.com', '2026-11-11T09:00:00Z')
    expect(f).toEqual({ id: 'S1F0', statement: 'qz.com published this on Wednesday, November 11, 2026.', supportingSentence: '', measures: '' })
    const pool = new Map([...POOL, ['S1F0', f!]])
    expect(checkedItems(draft([['On Wednesday, November 11, analysts counted about 32 GW of all solar.', ['S1F1']]]), pool)[1]?.numberHints).toEqual([])
  })

  it('reads a date as search gives it, so a source found by search gets its date fact too', () => {
    expect(publishedFact('S2', 'dawn.com', 'Thu, 12 Nov 2026 08:00:00 GMT')).toEqual([
      { id: 'S2F0', statement: 'dawn.com published this on Thursday, November 12, 2026.', supportingSentence: '', measures: '' },
    ])
  })

  it('gives nothing for a missing or unreadable date', () => {
    expect(publishedFact('S1', 'x', null)).toEqual([])
    expect(publishedFact('S1', 'x', 'unknown')).toEqual([])
  })
})

describe('publishedDay', () => {
  it("gives an ISO date's own day, and the UTC day of a date as search gives it", () => {
    expect(publishedDay('2026-11-12T23:30:00+02:00')).toBe('2026-11-12')
    expect(publishedDay('2026-11-12')).toBe('2026-11-12')
    expect(publishedDay('Thu, 12 Nov 2026 23:30:00 GMT')).toBe('2026-11-12')
  })

  it('gives null for a missing or unreadable date', () => {
    expect(publishedDay(null)).toBeNull()
    expect(publishedDay('unknown')).toBeNull()
    expect(publishedDay('2026-13-45')).toBeNull()
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
