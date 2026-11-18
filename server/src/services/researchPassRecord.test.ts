import { describe, expect, it } from 'vitest'
import type { Draft } from '../schemas/research.js'
import type { CitationProblem } from './researchChecks.js'
import type { UpdateRecord } from './researchPassLater.js'
import { passItemTally, type PassRecord } from './researchPassRecord.js'
import { emptyResearch, type CheckPass } from './researchPipeline.js'
import { emptyContextRecord } from './storyContextPipeline.js'

const draft = (): Draft => ({
  titleLabel: 'Solar power',
  title: 'Pakistan adds 22 GW of rooftop solar',
  story: [{ text: 'Pakistan added 22 GW of rooftop solar in two years.', factIds: ['S0F1'] }],
  summary: 'Summary',
  whyThisMatters: [{ text: 'Cheap power reaches millions.', factIds: [] }],
  caveats: [{ text: 'The grid lags behind.', factIds: [] }],
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Pakistan added 22 GW of rooftop solar.',
  emotionTag: 'uplifting',
  relevanceCalculation: ['- **Energy:** 6'],
  rating: 6,
  oldNews: { isOld: false, firstHappened: 'unknown' },
  contradicted: { isContradicted: false, factIds: [] },
})

describe('passItemTally', () => {
  const problem = (label: string): CitationProblem => ({ label, text: 'text', problem: 'unsupported', kind: 'fact', by: 'judge' })
  const check = (rechecked: string[] | undefined, failing: string[] = []): CheckPass => ({
    problems: failing.map(problem),
    longestRuns: [],
    unjudged: [],
    numberHints: [],
    ...(rechecked ? { rechecked } : {}),
  })
  const record = (over: Partial<PassRecord>): PassRecord => ({
    research: emptyResearch('story-1', true),
    context: emptyContextRecord(true),
    cards: 'none',
    cardsError: null,
    skippedQueries: [],
    plan: { confirm: null, queries: null, use: {} },
    update: null,
    ...over,
  })
  const update = (over: Partial<UpdateRecord>): UpdateRecord => ({
    calls: [],
    judgments: [],
    demoted: [],
    superseded: [],
    checks: [],
    problems: [],
    failedOn: null,
    note: null,
    error: null,
    ...over,
  })

  it("counts each of the draft's cited sections once however many rounds checked it, a failing one once, beside the cards' tally", () => {
    const context = { ...emptyContextRecord(true), tally: { checked: 4, failed: 1 } }
    const research = {
      ...emptyResearch('story-1', true),
      draft: {
        ...draft(),
        caveats: [
          { text: 'The grid lags behind.', factIds: [] },
          { text: 'Prices may rise.', factIds: [] },
        ],
      },
      checks: [check(undefined, ['Caveat 2']), check(['Caveat 2'], ['Caveat 2']), check(['Caveat 2'], ['Caveat 2'])],
      problems: [problem('Caveat 2'), problem('Caveat 2')],
    }
    // Story paragraph 1, Why This Matters 1, Caveats 1 and 2
    expect(passItemTally(record({ research, context }))).toEqual({ checked: 4 + 4, failed: 1 + 1 })
  })

  it('counts nothing of an article no check ran on', () => {
    expect(passItemTally(record({ research: { ...emptyResearch('story-1', true), draft: draft() } }))).toEqual({ checked: 0, failed: 0 })
  })

  it("counts a later pass's rechecked sections once each, and a dropped one that failed", () => {
    const later = update({
      checks: [check(['Story paragraph 2', 'Caveat 1'], ['Caveat 1']), check(['Caveat 1'], ['Caveat 1'])],
      problems: [problem('Caveat 1')],
    })
    expect(passItemTally(record({ update: later }))).toEqual({ checked: 2, failed: 1 })
  })
})
