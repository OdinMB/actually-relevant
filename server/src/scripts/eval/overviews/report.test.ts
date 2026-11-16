import { describe, it, expect } from 'vitest'
import { OVERVIEW_DEFAULT_ARMS, OVERVIEW_DEFAULT_SIZE, OVERVIEW_STEPS, type OverviewOptions } from '../options.js'
import { summarizeBaseline } from './baseline.js'
import { variantItems, type CheckItem, type Verdict } from './factCheck.js'
import type { FactFixture, FactFixtures } from './factFixtures.js'
import { scoreArm } from './factCheckScore.js'
import { overviewReportName, renderOverviewReport, type OverviewReportInput } from './report.js'

const name = (o: Partial<Pick<OverviewOptions, 'steps' | 'arms' | 'size' | 'repeat' | 'limit'>> = {}) =>
  overviewReportName({ steps: [...OVERVIEW_STEPS], arms: [...OVERVIEW_DEFAULT_ARMS], size: OVERVIEW_DEFAULT_SIZE, repeat: 1, ...o })

describe('overviewReportName', () => {
  it('names the default run the report of record', () => {
    expect(name()).toBe('overview-eval.md')
  })

  it('tags every departure from the default run, so a trial never overwrites the report of record', () => {
    expect(name({ steps: ['keys', 'baseline'] })).toBe('overview-eval-steps-keys-baseline.md')
    expect(name({ steps: ['fact-check'], repeat: 3 })).toBe('overview-eval-steps-fact-check-repeat-3.md')
    expect(name({ arms: [{ model: 'gpt-6-luna', effort: 'medium' }], size: 100, limit: 5 })).toBe('overview-eval-arms-gpt-6-luna@medium-size-100-limit-5.md')
  })
})

const fixtures: FactFixtures = {
  version: 1,
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
  steps: [...OVERVIEW_STEPS],
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

  it('shows each arm against the bars', () => {
    const md = renderOverviewReport(
      input({
        steps: ['fact-check'],
        factCheck: {
          fixtures,
          labeled: 0,
          labels: { accepted: [], extractionErrors: [], unlabeled: [] },
          variants: [],
          scores: [scoreArm({ arm: 'gpt-6-luna@low', runs: [[]] })],
        },
      }),
    )
    expect(headings(md)).toEqual(['## Fact check under planted errors', '## Spend'])
    expect(md).toContain('### gpt-6-luna@low')
  })

  it("lists a key's counts and errors, an arm's misses across runs, the extraction errors, and the baseline's costs", () => {
    const fact: FactFixture = {
      key: 'r1:S0F1',
      runId: 'r1',
      storyId: 's1',
      sourceId: 'S0',
      outlet: 'Outlet | One',
      url: 'https://example.org/1',
      language: 'fr',
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
            summary: { id: 'ebola', title: 'Ebola', must: 3, optional: 1, nearMisses: 2, figures: 1, values: 4, closed: null, withResearchRun: 2 },
            errors: ['entry a: quote not found: "x"'],
          },
        ],
        factCheck: {
          fixtures: { ...fixtures, facts: [fact], runsRead: 1, shortfalls: ['1 of 300 facts: the database holds no more qualifying facts'] },
          labeled: 1,
          labels: { accepted: [fact], extractionErrors: [verdict(faithful!, false)], unlabeled: [] },
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
    expect(md).toContain('| Ebola | ebola.json | 3 / 1 | 2 | 1 | 4 | open | 2 | 1 |')
    expect(md).toContain('- entry a: quote not found: "x"')
    expect(md).toContain('Languages: fr 1.')
    expect(md).toContain('- Shortfall: 1 of 300 facts')
    expect(md).toContain('(the first 1 of the sample, --limit: a smoke run, not evidence)')
    expect(md).toContain('#### Misses (1 of 1)')
    expect(md).toContain('; in 1 of 2 runs')
    expect(md).toContain('#### False rejections (1 of 1)')
    expect(md).toContain('**Flips:** the verdict differs between runs for 2 of 2 items')
    expect(md).toContain('Outlet / One')
    expect(md).toContain('### Extraction errors the strong judge found (1 of 1)')
    expect(md).toContain('| Cost (`cost_usd`) | 1 | $0.0500 |')
    expect(md).toContain('Fact fixtures sampled 2026-11-17T08:00:00.000Z from the local database copy')
  })
})
