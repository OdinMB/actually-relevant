import { describe, it, expect } from 'vitest'
import type { CitationProblem } from '../../../services/researchChecks.js'
import type { LongestRun } from '../../../services/researchCopying.js'
import type { CheckPass } from '../../../services/researchPipeline.js'
import type { StoryResearch } from './pipeline.js'
import { causeOf, ownWords, ownWordsLines } from './ownWords.js'

const problem = (label: string, over: Partial<CitationProblem>): CitationProblem => ({ label, text: '', problem: 'p', kind: 'copying', by: 'code', ...over })
const codeWording = (label: string) => problem(label, { against: 'wording', sourceId: 'S1' })
const codeStatement = (label: string) => problem(label, { against: 'statement', sourceId: 'S1' })
const judgeCopy = (label: string) => problem(label, { by: 'judge', copiedSentence: 'S1F2', sourceId: 'S1' })
const judgeFact = (label: string) => problem(label, { kind: 'fact', by: 'judge' })
const run = (label: string, against: LongestRun['against'], words: number, sourceId = 'S1'): LongestRun => ({ label, sourceId, against, words })
const pass = (problems: CitationProblem[], over: Partial<CheckPass> = {}): CheckPass => ({ problems, longestRuns: [], unjudged: [], numberHints: [], ...over })

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

const failedCheck = (reason: string) => ({ kind: 'fallback' as const, reason, category: 'draft_failed_check' as const })

describe('causeOf', () => {
  it('names each cause the shadow week counts, a run shared with a fact statement apart from one shared with a source wording', () => {
    expect(
      [
        problem('a', { kind: 'fact', by: 'code' }),
        judgeFact('a'),
        codeWording('a'),
        codeStatement('a'),
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
      checks: [pass([codeWording('Story paragraph 2'), judgeCopy('Story paragraph 2'), judgeFact('Caveat 1')]), pass([judgeCopy('Story paragraph 2')])],
      problems: [judgeCopy('Story paragraph 2')],
    }),
    // Fell back on a summary that still copied
    result({
      rewritten: true,
      checks: [pass([codeWording('Summary')]), pass([codeWording('Summary'), judgeFact('Caveat 2')])],
      problems: [codeWording('Summary'), judgeFact('Caveat 2')],
      failedOn: 'Summary',
      verdict: failedCheck('an item that cannot be dropped failed the check after repair (Summary)'),
    }),
    // A clean first draft
    result({ checks: [pass([])] }),
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

  it('keeps flags of runs shared with a fact statement apart from those shared with a source wording', () => {
    const w = ownWords([result({ checks: [pass([codeStatement('Story paragraph 1'), codeStatement('Summary'), codeWording('Title')])] })]).byCause
    expect(w['copying: code, statement'].firstDraftFlags).toBe(2)
    expect(w['copying: code, wording'].firstDraftFlags).toBe(1)
  })

  it('counts a fallback on a part the draft had nothing in apart, since no problem names it', () => {
    const empty = result({ checks: [pass([])], failedOn: 'Caveats', verdict: failedCheck('the draft has no caveat') })
    const w = ownWords([...results, empty])
    expect(w.emptyPartFallbacks).toBe(1)
    expect(Object.values(w.byCause).reduce((n, c) => n + c.fallbacks, 0)).toBe(1)
  })

  it('counts the items the fact check left without a verdict, over every pass, and the runs they are in', () => {
    const w = ownWords([
      result({ rewritten: true, checks: [pass([], { unjudged: ['Blurb'] }), pass([], { unjudged: ['Summary', 'Blurb'] })] }),
      result({ checks: [pass([], { unjudged: ['Title'] })] }),
      result({ checks: [pass([])] }),
    ])
    expect(w.unjudged).toEqual({ items: 4, runs: 2 })
  })

  it("counts the items given number hints over every pass, and the fact check's verdict on them: failed for support, or none", () => {
    const hint = (label: string) => ({ label, numbers: ['40'] })
    const w = ownWords([
      result({
        rewritten: true,
        checks: [
          // Caveat 2's only problem is copying, so its number passed the fact check
          pass([judgeFact('Caveat 1'), codeWording('Caveat 2')], {
            numberHints: [hint('Story paragraph 1'), hint('Caveat 1'), hint('Caveat 2'), hint('Caveat 3')],
            unjudged: ['Caveat 3'],
          }),
          pass([judgeFact('Caveat 1')], { numberHints: [hint('Caveat 1')] }),
        ],
      }),
      result({ checks: [pass([judgeFact('Caveat 1')])] }),
    ])
    expect(w.numberHints).toEqual({ items: 5, failed: 2, unjudged: 1 })
  })

  it("takes each first-draft item's longest run per kind over the sources, and counts those at 8 and 12 words", () => {
    const lengths = ownWords([
      result({
        checks: [
          pass([], {
            longestRuns: [
              run('Title', 'wording', 3),
              run('Title', 'wording', 9, 'S2'),
              run('Title', 'statement', 2),
              run('Story paragraph 1', 'wording', 12),
              run('Story paragraph 1', 'statement', 4),
            ],
          }),
          pass([], { longestRuns: [run('Title', 'wording', 30)] }),
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

  it('renders a table row per cause, the counts outside it and the run lengths', () => {
    const md = ownWordsLines(results).join('\n')
    expect(md).toContain('| copying: code, wording | 2 | 2 | 0 | 1 |')
    expect(md).toContain('| copying: code, statement | 0 | 0 | 0 | 0 |')
    expect(md).toContain('| statement | 0 |')
  })
})
