import { describe, it, expect } from 'vitest'
import type { CitationProblem, LongestRun } from '../../../services/researchChecks.js'
import type { StoryResearch } from './pipeline.js'
import { causeOf, ownWords, ownWordsLines } from './ownWords.js'

const problem = (label: string, over: Partial<CitationProblem>): CitationProblem => ({ label, text: '', problem: 'p', kind: 'copying', by: 'code', ...over })
const codeWording = (label: string) => problem(label, { against: 'wording', sourceId: 'S1' })
const judgeCopy = (label: string) => problem(label, { by: 'judge', copiedSentence: 'S1F2', sourceId: 'S1' })
const judgeFact = (label: string) => problem(label, { kind: 'fact', by: 'judge' })
const run = (label: string, against: LongestRun['against'], words: number, sourceId = 'S1'): LongestRun => ({ label, sourceId, against, words })

function result(over: Partial<StoryResearch>): StoryResearch {
  return {
    storyId: 's',
    calls: [],
    credits: 0,
    searches: [],
    candidates: 0,
    drops: {},
    sources: [],
    earlier: [],
    draft: null,
    rewritten: false,
    problems: [],
    checks: [],
    failedOn: null,
    support: { facts: 0, found: 0 },
    optOutChecked: false,
    verdict: { kind: 'keep' },
    ...over,
  }
}

describe('causeOf', () => {
  it('names each cause the shadow week counts', () => {
    expect(
      [
        problem('a', { kind: 'fact', by: 'code' }),
        judgeFact('a'),
        codeWording('a'),
        problem('a', { against: 'statement' }),
        problem('a', {}),
        judgeCopy('a'),
        problem('a', { by: 'judge', sourceId: 'S1' }),
      ].map(causeOf),
    ).toEqual([
      'fact: code',
      'fact: judge',
      'copying: code, wording',
      'copying: code, statement',
      'copying: code, quoted span',
      'copying: judge, close rendering',
      'copying: judge, follows a source',
    ])
  })
})

describe('ownWords', () => {
  const results = [
    // Rewritten for a copied paragraph and a fact; the paragraph still copied after it and was dropped
    result({
      rewritten: true,
      checks: [
        { problems: [codeWording('Story paragraph 2'), judgeCopy('Story paragraph 2'), judgeFact('Caveat 1')], longestRuns: [] },
        { problems: [judgeCopy('Story paragraph 2')], longestRuns: [] },
      ],
      problems: [judgeCopy('Story paragraph 2')],
    }),
    // Fell back on a summary that still copied
    result({
      rewritten: true,
      checks: [
        { problems: [codeWording('Summary')], longestRuns: [] },
        { problems: [codeWording('Summary'), judgeFact('Caveat 2')], longestRuns: [] },
      ],
      problems: [codeWording('Summary'), judgeFact('Caveat 2')],
      failedOn: 'Summary',
      verdict: { kind: 'fallback', reason: 'an item that cannot be dropped failed the check after one rewrite (Summary)', category: 'draft_failed_check' },
    }),
    // A clean first draft
    result({ checks: [{ problems: [], longestRuns: [] }] }),
  ]

  it('counts first-draft flags and the rewrites they caused by cause, a run with several causes under each', () => {
    const w = ownWords(results).byCause
    expect(w['copying: code, wording']).toMatchObject({ firstDraftFlags: 2, rewrites: 2 })
    expect(w['copying: judge, close rendering']).toMatchObject({ firstDraftFlags: 1, rewrites: 1 })
    expect(w['fact: judge']).toMatchObject({ firstDraftFlags: 1, rewrites: 1 })
    expect(w['fact: code']).toEqual({ firstDraftFlags: 0, rewrites: 0, dropped: 0, fallbacks: 0 })
  })

  it('counts the items dropped from kept drafts, and the fallbacks by the causes of the item they failed on', () => {
    const w = ownWords(results).byCause
    expect(w['copying: judge, close rendering']).toMatchObject({ dropped: 1, fallbacks: 0 })
    expect(w['copying: code, wording']).toMatchObject({ dropped: 0, fallbacks: 1 })
    // Caveat 2 failed too, but the run fell back on the summary
    expect(w['fact: judge']).toMatchObject({ dropped: 0, fallbacks: 0 })
  })

  it("takes each first-draft item's longest run per kind over the sources, and counts those at 8 and 12 words", () => {
    const lengths = ownWords([
      result({
        checks: [
          {
            problems: [],
            longestRuns: [
              run('Title', 'wording', 3),
              run('Title', 'wording', 9, 'S2'),
              run('Title', 'statement', 2),
              run('Story paragraph 1', 'wording', 12),
              run('Story paragraph 1', 'statement', 4),
            ],
          },
          { problems: [], longestRuns: [run('Title', 'wording', 30)] },
        ],
      }),
    ]).runLengths
    expect(lengths).toEqual({
      wording: { items: 2, max: 12, atLeast8: 2, atLeast12: 1 },
      statement: { items: 2, max: 4, atLeast8: 0, atLeast12: 0 },
    })
  })

  it('measures the fact-check input per call', () => {
    const usage = (input: number) => ({ input, cached: 0, output: 0, reasoning: 0 })
    const calls = [
      { step: 'fact-check' as const, outcome: 'ok' as const, usage: usage(3000), costUsd: 0, model: 'm' },
      { step: 'write' as const, outcome: 'ok' as const, usage: usage(9000), costUsd: 0, model: 'm' },
      { step: 'fact-check' as const, outcome: 'ok' as const, usage: usage(5000), costUsd: 0, model: 'm' },
    ]
    expect(ownWords([result({ calls })]).factCheckInput).toEqual({ calls: 2, mean: 4000, max: 5000 })
  })

  it('renders a table row per cause and the run lengths', () => {
    const md = ownWordsLines(results).join('\n')
    expect(md).toContain('| copying: code, wording | 2 | 2 | 0 | 1 |')
    expect(md).toContain('| statement | 0 |')
  })
})
