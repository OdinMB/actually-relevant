import { describe, it, expect } from 'vitest'
import { checkCitations, decideGate, draftSentences, supportFound, type PoolFact } from './researchChecks.js'
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
