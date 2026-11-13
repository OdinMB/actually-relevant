import { describe, it, expect } from 'vitest'
import {
  checkCitations,
  checkedItems,
  decideGate,
  draftItems,
  dropFailing,
  evidenceFor,
  judgedProblems,
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

  it('gives each cited item its evidence, and the title, summary and blurb neither evidence nor hints', () => {
    const items = checkedItems(
      draft([['Pakistan added rooftop solar quickly.', ['S0F1']]], [], [], { title: '99 GW', summary: '99 GW.', marketingBlurb: '99 GW.' }),
      POOL,
    )
    expect(items.map(c => [c.item.label, c.evidence.map(f => f.id), c.numberHints])).toEqual([
      ['Title', [], []],
      ['Story paragraph 1', ['S0F1'], []],
      ['Summary', [], []],
      ['Blurb', [], []],
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

  it('counts a support failure on an item that cites nothing once it has number hints, since the fact check then judges its numbers', () => {
    const hinted = items.map(c => (c.item.label === 'Why This Matters 1' ? { ...c, numberHints: ['40 million'] } : c))
    const answer: FactCheck = {
      items: [verdict(1, { supported: false, problem: 'no title claim' }), verdict(3, { supported: false, problem: 'no fact gives 40 million' })],
    }
    expect(judgedProblems(answer, hinted, lines)).toEqual([
      { label: 'Why This Matters 1', text: 'It matters.', problem: 'fails the fact check: no fact gives 40 million', kind: 'fact', by: 'judge', key: false },
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

  it("quotes the source's own sentence for a fact id, never the fact's statement under the same id", () => {
    const answer: FactCheck = { items: [verdict(2, { copiedSentence: 'S1F1.' })] }
    expect(judgedProblems(answer, items, lines).map(p => p.problem)).toEqual([`renders S1F1 ("${SENTENCE}") closely`])
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
