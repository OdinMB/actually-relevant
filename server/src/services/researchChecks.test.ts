import { describe, it, expect } from 'vitest'
import { checkCitations, decideGate, draftSentences, dropFailing, evidenceFor, publishedFact, supportFound, type PoolFact } from './researchChecks.js'
import type { Draft } from '../schemas/research.js'

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

type Parts = Pick<Draft, 'story' | 'whyThisMatters' | 'caveats'>
const draft = (story: [string, string[]][], whyThisMatters: [string, string[]][] = [], caveats: [string, string[]][] = []): Parts => ({
  story: [{ sentences: story.map(([text, factIds]) => ({ text, factIds })) }],
  whyThisMatters: whyThisMatters.map(([text, factIds]) => ({ text, factIds })),
  caveats: caveats.map(([text, factIds]) => ({ text, factIds })),
})

describe('checkCitations', () => {
  it('passes sentences whose numbers appear in their cited facts', () => {
    const d = draft(
      [
        ['Pakistan added 22 GW of rooftop solar in two years.', ['S0F1']],
        ['Counting all solar, analysts put it at about 32 GW.', ['S1F1']],
      ],
      [['Cheap panels let households cut their bills.', []]],
    )
    expect(checkCitations(d, POOL)).toEqual([])
  })

  it('flags a fact id that is not in the pool', () => {
    const problems = checkCitations(draft([['Pakistan added rooftop solar quickly.', ['S0F1', 'S4F2']]]), POOL)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ label: 'Story paragraph 1, sentence 1', problem: expect.stringContaining('S4F2') })
  })

  it('flags a number none of the cited facts states', () => {
    const problems = checkCitations(draft([['Pakistan added 38 GW of rooftop solar in two years.', ['S0F1']]]), POOL)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('"38"')
  })

  it('needs a citation behind every story sentence, but lets a bullet that only judges go uncited', () => {
    const d = draft([['The shift happened without a national plan.', []]], [['This matters far beyond one country.', []]], [['Grid upgrades lag behind.', []]])
    const problems = checkCitations(d, POOL)
    expect(problems.map(p => p.label)).toEqual(['Story paragraph 1, sentence 1'])
    expect(problems[0]?.problem).toMatch(/cites no fact/)
  })

  it('flags an uncited bullet that states a number', () => {
    const problems = checkCitations(
      draft([['Pakistan added 22 GW of rooftop solar in two years.', ['S0F1']]], [['Some 40 million people now use solar power.', []]]),
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

describe('dropFailing', () => {
  const d = (): Parts => ({
    story: [
      { sentences: [{ text: 'lead', factIds: ['S0F1'] }] },
      {
        sentences: [
          { text: 'second', factIds: ['S0F1'] },
          { text: 'third', factIds: ['S0F1'] },
        ],
      },
      { sentences: [{ text: 'alone', factIds: ['S0F1'] }] },
    ],
    whyThisMatters: [
      { text: 'why 1', factIds: [] },
      { text: 'why 2', factIds: [] },
    ],
    caveats: [{ text: 'caveat', factIds: [] }],
  })
  const problem = (label: string) => ({ label, text: '', problem: 'fails the fact check' })

  it('drops the failing sentences and bullets, and a paragraph left empty', () => {
    const out = dropFailing(d(), [problem('Story paragraph 2, sentence 1'), problem('Story paragraph 3, sentence 1'), problem('Why This Matters 2')])
    expect(out).toEqual({
      draft: {
        story: [{ sentences: [{ text: 'lead', factIds: ['S0F1'] }] }, { sentences: [{ text: 'third', factIds: ['S0F1'] }] }],
        whyThisMatters: [{ text: 'why 1', factIds: [] }],
        caveats: [{ text: 'caveat', factIds: [] }],
      },
    })
  })

  it('counts a sentence with several problems once', () => {
    const out = dropFailing(d(), [
      problem('Why This Matters 2'),
      problem('Why This Matters 2'),
      problem('Story paragraph 2, sentence 2'),
      problem('Story paragraph 2, sentence 1'),
    ])
    expect('draft' in out).toBe(true)
  })

  it('drops any number of non-key failures, the opening sentence included', () => {
    const many = ['Story paragraph 1, sentence 1', 'Story paragraph 2, sentence 1', 'Story paragraph 2, sentence 2', 'Why This Matters 1'].map(problem)
    const out = dropFailing(d(), many)
    expect('draft' in out && out.draft.story).toEqual([{ sentences: [{ text: 'alone', factIds: ['S0F1'] }] }])
  })

  it('fails on an unsupported key claim, or when a part is left empty', () => {
    expect(dropFailing(d(), [{ ...problem('Story paragraph 2, sentence 1'), key: true }])).toEqual({
      failed: 'a key claim failed the check after one rewrite (Story paragraph 2, sentence 1)',
    })
    expect(dropFailing(d(), [problem('Caveat 1')])).toEqual({ failed: 'no caveat passed the check after one rewrite' })
    const allStory = ['Story paragraph 1, sentence 1', 'Story paragraph 2, sentence 1', 'Story paragraph 2, sentence 2', 'Story paragraph 3, sentence 1']
    expect(dropFailing(d(), allStory.map(problem))).toEqual({ failed: 'no story sentence passed the check after one rewrite' })
  })
})

describe('publishedFact', () => {
  it('gives a source date as fact F0 with weekday, month and day, so a dated sentence passes the number check', () => {
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

describe('draftSentences', () => {
  it('labels story sentences by paragraph and bullets by section', () => {
    const d: Parts = {
      story: [
        { sentences: [{ text: 'a', factIds: [] }] },
        {
          sentences: [
            { text: 'b', factIds: [] },
            { text: 'c', factIds: [] },
          ],
        },
      ],
      whyThisMatters: [{ text: 'd', factIds: [] }],
      caveats: [{ text: 'e', factIds: [] }],
    }
    expect(draftSentences(d).map(s => s.label)).toEqual([
      'Story paragraph 1, sentence 1',
      'Story paragraph 2, sentence 1',
      'Story paragraph 2, sentence 2',
      'Why This Matters 1',
      'Caveat 1',
    ])
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

  it('rejects on the rating first, then stale, then contradicted', () => {
    const all = { rating: 4, oldNews: { isOld: true, firstHappened: '2025-03-01' }, contradicted: { isContradicted: true, factIds: ['S2F1'] } }
    expect(decideGate({ draft: all }, 5)).toEqual({ kind: 'research-rating', rating: 4 })
    expect(decideGate({ draft: { ...all, rating: 5 } }, 5)).toEqual({ kind: 'stale', firstHappened: '2025-03-01' })
    expect(decideGate({ draft: { ...all, rating: 5, oldNews: ok.oldNews } }, 5)).toEqual({ kind: 'contradicted', factIds: ['S2F1'] })
  })

  it('falls back with the reason when research failed', () => {
    expect(decideGate({ failed: 'no usable source' }, 5)).toEqual({ kind: 'fallback', reason: 'no usable source' })
  })
})
