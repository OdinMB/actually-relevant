import { describe, it, expect } from 'vitest'
import { contextFact, contextResult } from '../../../test/contextFixtures.js'
import { OVERVIEW_DEFAULT_ARMS, OVERVIEW_DEFAULT_SIZE, OVERVIEW_DEFAULT_STEPS, OVERVIEW_STEPS } from '../options.js'
import { summarizeBaseline } from './baseline.js'
import { contextFactFixtures } from './contextFacts.js'
import { resultDates, scoreContext, scoreFields } from './contextScore.js'
import { variantItems, type CheckItem, type Verdict } from './factCheck.js'
import { FACT_FIXTURES_VERSION, type FactFixture, type FactFixtures } from './factFixtures.js'
import { scoreArm } from './factCheckScore.js'
import type { KeyDraftReport } from './keyDraft.js'
import { overviewReportName, renderOverviewReport, type OverviewReportInput, type ReportNameInput } from './report.js'

const name = (o: Partial<ReportNameInput> = {}) =>
  overviewReportName({
    steps: [...OVERVIEW_DEFAULT_STEPS],
    arms: [...OVERVIEW_DEFAULT_ARMS],
    size: OVERVIEW_DEFAULT_SIZE,
    repeat: 1,
    facts: 'research',
    half: 'all',
    ...o,
  })

describe('overviewReportName', () => {
  it('names the default run the report of record', () => {
    expect(name()).toBe('overview-eval.md')
  })

  it('tags every departure from the default run, so a trial never overwrites the report of record', () => {
    expect(name({ steps: ['keys', 'baseline'] })).toBe('overview-eval-steps-keys-baseline.md')
    expect(name({ steps: ['fact-check'], repeat: 3 })).toBe('overview-eval-steps-fact-check-repeat-3.md')
    expect(name({ arms: [{ model: 'gpt-6-luna', effort: 'medium' }], size: 100, limit: 5 })).toBe('overview-eval-arms-gpt-6-luna@medium-size-100-limit-5.md')
    expect(name({ steps: [...OVERVIEW_STEPS] })).toBe(`overview-eval-steps-${OVERVIEW_STEPS.join('-')}.md`)
  })

  it('names the gate run apart from the tuning runs', () => {
    expect(name({ steps: ['context', 'fact-check'], facts: 'context', half: 'judge', repeat: 3 })).toBe(
      'overview-eval-steps-context-fact-check-facts-context-half-judge-repeat-3.md',
    )
  })
})

const fixtures: FactFixtures = {
  version: FACT_FIXTURES_VERSION,
  createdAt: '2026-11-17T08:00:00.000Z',
  anchor: '2026-11-16T02:20:00.000Z',
  size: 300,
  dbClass: 'local',
  readOnlyMode: 'session',
  facts: [],
  runsRead: 0,
  olderShape: 0,
  shortfalls: [],
}

const input = (extra: Partial<OverviewReportInput>): OverviewReportInput => ({
  generatedAt: '2026-11-17T09:00:00.000Z',
  steps: [...OVERVIEW_DEFAULT_STEPS],
  skipped: [],
  thisRunUsd: 0,
  folderUsd: 0,
  budgetUsd: 3,
  ...extra,
})

const headings = (md: string) => md.split('\n').filter(l => l.startsWith('## '))

describe('renderOverviewReport', () => {
  it('has a section for each step that ran, then the spend', () => {
    const md = renderOverviewReport(
      input({
        keys: [{ file: 'ebola.json', summary: null, errors: ['entries.0.date: must be a date written YYYY-MM-DD'] }],
        baseline: summarizeBaseline([]),
        skipped: [{ step: 'fact-check', reason: 'estimate $4.00 exceeds the remaining budget $3.00' }],
      }),
    )
    expect(headings(md)).toEqual(['## Answer keys', "## Research's cost baseline", '## Skipped', '## Spend'])
    expect(md).toContain('entries.0.date: must be a date written YYYY-MM-DD')
  })

  it("lists each key's drafts for the review: its rows, its end or the drafter's reason there is none, and what code left out", () => {
    const base = { outcome: 'ok' as const, titles: { a: 'Vaccines reach Bunia', d: 'Outbreak declared over' }, missing: ['z'], left: [] }
    const keyDraft: KeyDraftReport = {
      half: 'judge',
      keys: ['ebola', 'el-nino'],
      skipped: [{ file: 'lebanon.json', reason: 'already version 2 (its responses drafted or written): left as it is' }],
      estimate: { calls: 2, uncached: 2, usd: 0.5 },
      stopped: null,
      drafts: [
        {
          ...base,
          id: 'ebola',
          file: 'ebola.json',
          title: 'Ebola',
          responses: [{ date: '2026-05-01', what: 'WHO ring vaccination', slug: 'a', quote: 'ring vaccination began', reviewed: false }],
          closed: { slug: 'd', date: '2026-05-06', quote: 'declared over', reviewed: false },
          noEnd: null,
          left: ['response "Aid": quote not found in a: "aid flown in"'],
          written: true,
        },
        {
          ...base,
          id: 'el-nino',
          file: 'el-nino.json',
          title: 'El Niño',
          responses: [],
          closed: null,
          noEnd: 'Still forecast to peak.',
          missing: [],
          written: false,
        },
      ],
      written: ['/keys/ebola.json'],
    }
    const md = renderOverviewReport(input({ steps: ['key-draft'], keyDraft }))
    expect(headings(md)).toEqual(["## Answer-key drafts: responses and ends for the owner's review", '## Spend'])
    expect(md).toContain('**Drafts:** 1 of 2 version 1 keys of half judge written: 1 responses and 1 ends')
    expect(md).toContain('- Left alone: lebanon.json: already version 2')
    expect(md).toContain('**End (a draft):** 2026-05-06, reported by "Outbreak declared over" (d): "declared over".')
    expect(md).toContain('| 2026-05-01 | Vaccines reach Bunia | WHO ring vaccination | "ring vaccination began" |')
    expect(md).toContain('- response "Aid": quote not found in a: "aid flown in"')
    expect(md).toContain('Not published in this database, so not shown to the drafter: z.')
    expect(md).toContain('**End:** none of our stories reports it, as the drafter reads them: Still forecast to peak.')
    expect(renderOverviewReport(input({ keyDraft: { ...keyDraft, stopped: 'OPENAI_API_KEY is missing', drafts: [], written: [] } }))).toContain(
      '**Drafts:** none; the calls did not run: OPENAI_API_KEY is missing',
    )
  })

  it('shows each arm against the bars', () => {
    const md = renderOverviewReport(
      input({
        steps: ['fact-check'],
        factCheck: {
          sample: { source: 'research', fixtures },
          labeled: 0,
          labels: { accepted: [], unsupported: [], unlabeled: [] },
          variants: [],
          scores: [scoreArm({ arm: 'gpt-6-luna@low', runs: [[]] })],
        },
      }),
    )
    expect(headings(md)).toEqual(['## Fact check under planted errors', '## Spend'])
    expect(md).toContain('### gpt-6-luna@low')
    expect(md).toContain('| wrong-scale | unsupported | 0 |')
    expect(md).not.toContain('wrong-place')
  })

  it("shows module-1 facts' sample with the field-level kinds", () => {
    const result = contextResult({ facts: [contextFact('S1F1', { origin: 'search' }), contextFact('S2F1', { verdict: 'rejected' })] })
    const facts = contextFactFixtures([{ slug: 'story-a', result }], 300)
    const md = renderOverviewReport(
      input({
        steps: ['context', 'fact-check'],
        factCheck: {
          sample: { source: 'context', facts, half: 'judge' },
          labeled: 1,
          labels: { accepted: facts.facts, unsupported: [], unlabeled: [] },
          variants: [],
          scores: [scoreArm({ arm: 'gpt-6-luna@low', runs: [[]] })],
        },
      }),
    )
    expect(md).toContain("**Sample (module-1 facts, `--facts context`):** 1 facts (of 300 asked for) that production's check supported")
    expect(md).toContain('from 1 stories (half judge)')
    expect(md).toContain('- Shortfall: 1 of 300 facts')
    expect(md).toContain('| wrong-place | unsupported | 0 |')
    expect(md).toContain('as rendered against their evidence')
    expect(md).not.toContain('Fact fixtures sampled')
  })

  it('places the story-context sections between the answer keys and the fact check', () => {
    const md = renderOverviewReport(
      input({
        keys: [],
        gapKeys: [],
        context: {
          half: 'all',
          repeat: 1,
          keys: 0,
          left: [],
          stories: 0,
          deskUsd: null,
          skipped: [],
          judge: null,
          score: scoreContext([]),
          fields: scoreFields([]),
          dates: resultDates([]),
        },
        baseline: summarizeBaseline([]),
      }),
    )
    expect(headings(md)).toEqual(['## Answer keys', '## Gap keys', '## Story context against the bars', "## Research's cost baseline", '## Spend'])
  })

  it('says why no arm ran when the budget stopped them after the labels', () => {
    const md = renderOverviewReport(
      input({
        steps: ['fact-check'],
        factCheck: {
          sample: { source: 'research', fixtures },
          labeled: 0,
          labels: { accepted: [], unsupported: [], unlabeled: [] },
          variants: [],
          scores: [],
          stoppedArms: 'estimate $4.00 for 30 uncached calls exceeds the remaining budget $3.00',
        },
      }),
    )
    expect(md).toContain('No arm ran: estimate $4.00')
  })

  it("lists a key's counts and errors, an arm's misses across runs, the statements their evidence does not support with the judge's reason, and the baseline's costs", () => {
    const fact: FactFixture = {
      key: 'r1:S0F1',
      runId: 'r1',
      storyId: 's1',
      sourceId: 'S0',
      outlet: 'Outlet | One',
      url: 'https://example.org/1',
      language: 'fr',
      date: null,
      statement: 'Congo reported 4,887 deaths.',
      measures: 'deaths',
      sentence: 'Le Congo a signalé 4 887 décès.',
    }
    const [faithful, , wrong] = variantItems([fact])
    const verdict = (item: CheckItem, supported: boolean | null): Verdict => ({ item, supported, problem: supported === false ? 'not stated' : '' })
    const md = renderOverviewReport(
      input({
        keys: [
          {
            file: 'ebola.json',
            summary: {
              id: 'ebola',
              title: 'Ebola',
              must: 3,
              optional: 1,
              nearMisses: 2,
              figures: 1,
              values: 4,
              responses: 2,
              closed: null,
              withResearchRun: 2,
              toReview: 2,
            },
            errors: ['entry a: quote not found: "x"'],
          },
        ],
        factCheck: {
          sample: {
            source: 'research',
            fixtures: { ...fixtures, facts: [fact], runsRead: 1, shortfalls: ['1 of 300 facts: the database holds no more qualifying facts'] },
          },
          labeled: 1,
          labels: { accepted: [fact], unsupported: [verdict(faithful!, false)], unlabeled: [] },
          variants: [faithful!, wrong!],
          limit: 1,
          scores: [
            scoreArm({
              arm: 'gpt-6-luna@low',
              runs: [
                [verdict(faithful!, true), verdict(wrong!, true)],
                [verdict(faithful!, false), verdict(wrong!, false)],
              ],
            }),
          ],
        },
        baseline: summarizeBaseline([
          {
            trigger: 'pipeline',
            status: 'completed',
            verdict: 'keep',
            costUsd: 0.05,
            tavilyCredits: 4,
            hasResult: true,
            creditUsd: 0.008,
            startedAt: new Date('2026-11-14T02:20:00Z'),
          },
        ]),
      }),
    )
    expect(md).toContain('| Ebola | ebola.json | 3 / 1 | 2 | 1 | 4 | 2 | open | 2 | 2 | 1 |')
    expect(md).toContain('2 drafted responses and ends are not reviewed yet')
    expect(md).toContain('- entry a: quote not found: "x"')
    expect(md).toContain('Languages: fr 1.')
    expect(md).toContain('- Shortfall: 1 of 300 facts')
    expect(md).toContain('(the first 1 of the sample, --limit: a smoke run, not evidence)')
    expect(md).toContain('#### Misses (1 of 1)')
    expect(md).toContain('; in 1 of 2 runs')
    expect(md).toContain('#### False rejections (1 of 1)')
    expect(md).toContain('**Flips:** the verdict differs between runs for 2 of 2 items')
    expect(md).toContain('Outlet / One')
    expect(md).toContain('### Statements their evidence does not support (sentence, what it measures, source date): 1 of 1')
    expect(md).toContain('; measures "deaths" (Outlet / One): not stated')
    expect(md).toContain('| Cost (`cost_usd`) | 1 | $0.0500 |')
    expect(md).toContain('Fact fixtures sampled 2026-11-17T08:00:00.000Z from the local database copy')
  })
})
