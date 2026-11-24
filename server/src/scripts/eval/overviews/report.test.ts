import { describe, it, expect } from 'vitest'
import { contextFact } from '../../../test/contextFixtures.js'
import { OVERVIEW_DEFAULT_ARMS, OVERVIEW_DEFAULT_SIZE, OVERVIEW_DEFAULT_STEPS, OVERVIEW_STEPS } from '../options.js'
import { summarizeBaseline } from './baseline.js'
import { contextFactFixtures } from './contextFacts.js'
import { resultDates, scoreContext, scoreFields } from './contextScore.js'
import { variantItems, type CheckItem, type Labels, type Verdict } from './factCheck.js'
import type { FactCheckReport } from './factCheckReport.js'
import type { DriftReading } from './factDrift.js'
import { FACT_FIXTURES_VERSION, type FactFixture, type FactFixtures } from './factFixtures.js'
import { MAX_LISTED, scoreArm, scoreFidelity, type Fidelity } from './factCheckScore.js'
import { figureFixtures, figureVariants, type Answered, type FigureCheckResult, type FigureFixture } from './figureCheck.js'
import { scoreFigureCheck } from './figureCheckScore.js'
import type { KeyDraftReport } from './keyDraft.js'
import { rows } from './linkReport.js'
import { DRIFT_KINDS } from './factDriftPrompt.js'
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
    expect(name({ steps: ['link', 'found', 'role'], half: 'judge', repeat: 3, cacheOnly: true })).toBe(
      'overview-eval-steps-link-found-role-half-judge-repeat-3-cache-only.md',
    )
  })

  it('tags a rescore, so it never overwrites the report of the run it scores again', () => {
    expect(name({ steps: ['link', 'found', 'role'], half: 'judge', repeat: 3, rescore: true })).toBe(
      'overview-eval-steps-link-found-role-half-judge-repeat-3-rescore.md',
    )
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

/** The label pass's verdict on a fact it rejected. */
const rejectedBy = (fact: FactFixture): Verdict => ({
  item: { id: `${fact.key}#faithful`, fact, kind: 'faithful', text: fact.statement, change: '' },
  supported: false,
  problem: 'not in the sentence',
})

describe('renderOverviewReport', () => {
  it('has a section for each step that ran, then the spend', () => {
    const md = renderOverviewReport(
      input({
        keys: [{ file: 'ebola.json', summary: null, errors: ['entries.0.date: must be a date written YYYY-MM-DD'], sharedMusts: [] }],
        baseline: summarizeBaseline([]),
        skipped: [{ step: 'fact-check', reason: 'estimate $4.00 exceeds the remaining budget $3.00' }],
      }),
    )
    expect(headings(md)).toEqual(['## Answer keys', "## Research's cost baseline", '## Skipped', '## Spend'])
    expect(md).toContain('entries.0.date: must be a date written YYYY-MM-DD')
  })

  it("lists each key's drafts for the review: its rows and what code left out", () => {
    const base = { outcome: 'ok' as const, titles: { a: 'Vaccines reach Bunia' }, missing: ['z'], left: [] }
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
          left: ['response "Aid": quote not found in a: "aid flown in"'],
          written: true,
        },
        {
          ...base,
          id: 'el-nino',
          file: 'el-nino.json',
          title: 'El Niño',
          responses: [],
          missing: [],
          written: false,
        },
      ],
      written: ['/keys/ebola.json'],
    }
    const md = renderOverviewReport(input({ steps: ['key-draft'], keyDraft }))
    expect(headings(md)).toEqual(["## Answer-key drafts: responses for the owner's review", '## Spend'])
    expect(md).toContain('**Drafts:** 1 of 2 version 1 keys of half judge written: 1 responses')
    expect(md).toContain('- Left alone: lebanon.json: already version 2')
    expect(md).toContain('| 2026-05-01 | Vaccines reach Bunia | WHO ring vaccination | "ring vaccination began" |')
    expect(md).toContain('- response "Aid": quote not found in a: "aid flown in"')
    expect(md).toContain('Not published in this database, so not shown to the drafter: z.')
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
    const facts = contextFactFixtures(
      [{ slug: 'story-a', title: 'Story A', facts: [contextFact('S1F1', { origin: 'search' }), contextFact('S2F1', { verdict: 'rejected' })] }],
      300,
    )
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

  describe('the facts as rendered against their sources', () => {
    /** Figure facts S1F1 to S5F1 and facts without a figure S6F1 to S8F1, each told apart by its sentence. */
    const facts = contextFactFixtures(
      [
        {
          slug: 'story-a',
          title: 'Story A',
          facts: [
            ...[1, 2, 3, 4, 5].map(n => contextFact(`S${n}F1`)),
            ...[6, 7, 8].map(n => contextFact(`S${n}F1`, { value: null, statement: `Statement of S${n}F1.` })),
          ],
        },
      ],
      300,
    )
    const [fig1, fig2, fig3, fig4, fig5, plain6, plain7, plain8] = facts.facts
    /** The label pass: S1F1 and S6F1 accepted, S5F1 without a verdict, the rest rejected. */
    const labels: Labels = {
      accepted: [fig1!, plain6!],
      unsupported: [fig2!, fig3!, fig4!, plain7!, plain8!].map(rejectedBy),
      unlabeled: [fig5!],
    }
    const read = (fx: FactFixture, category: DriftReading['category'], kind: DriftReading['kind'] = null, reason = ''): DriftReading => ({
      rejection: rejectedBy(fx),
      category,
      kind,
      reason,
    })
    /** The second pass: S2F1 and S8F1 lack only context, S3F1 and S7F1 are changed, S4F1 is left unanswered. */
    const readings = [
      read(fig2!, 'context', null, 'names Ebola'),
      read(fig3!, 'changed', 'period', 'drops since March 2'),
      read(plain7!, 'changed', 'scope', 'drops during El Niño years'),
      read(plain8!, 'context', null, 'names the Colorado River'),
    ]
    const report = (fidelity: Fidelity, extra: Partial<FactCheckReport> = {}) =>
      renderOverviewReport(
        input({
          steps: ['context', 'fact-check'],
          factCheck: { sample: { source: 'context', facts, half: 'judge' }, labeled: facts.facts.length, labels, variants: [], scores: [], fidelity, ...extra },
        }),
      )
    const lines = (md: string) => md.split('\n')
    /** The section's `####` lists, each with the lines up to the next one or the spend. */
    const lists = (md: string) => {
      const all = lines(md)
      const at = all.flatMap((l, i) => (l.startsWith('#### ') ? [i] : []))
      return at.map((from, k) => ({ heading: all[from]!, items: all.slice(from + 1, at[k + 1] ?? all.indexOf('## Spend')).filter(l => l.startsWith('- ')) }))
    }

    it("gives the faithful shares against the reference, each group's counts, and the label pass alone", () => {
      const fidelity = scoreFidelity(labels, readings)
      const md = report(fidelity)
      for (const row of rows(fidelity.bars)) expect(md).toContain(row)
      expect(rows(fidelity.bars).map(r => r.split(' | ')[2])).toEqual(['50.0%', '66.7%'])
      expect(md).toContain(
        '- With a figure: 2 of 4 judged facts faithful (1 the label pass accepted, 1 it rejected only for context the sentence lacks); 1 changed; 1 the second pass left unjudged; 1 without a verdict.',
      )
      expect(md).toContain(
        '- Without a figure: 2 of 3 judged facts faithful (1 the label pass accepted, 1 it rejected only for context the sentence lacks); 1 changed; 0 the second pass left unjudged; 0 without a verdict.',
      )
      expect(md).toContain('- The label pass alone: with a figure 1 of 4 accepted (25.0%); without a figure 1 of 3 (33.3%).')
    })

    it('tabulates the changed facts by kind, a row for every kind', () => {
      const fidelity = scoreFidelity(labels, readings)
      const md = report(fidelity)
      expect(fidelity.changedByKind).toHaveLength(DRIFT_KINDS.length)
      for (const k of fidelity.changedByKind) expect(md).toContain(`| ${k.kind} | ${k.withFigure} | ${k.withoutFigure} |`)
      expect(md).toContain('| period | 1 | 0 |')
      expect(md).toContain('| scope | 0 | 1 |')
    })

    it("lists each changed fact under its group with its kind and the second pass's reason, a figure first; the context facts are counted, never listed", () => {
      const md = report(scoreFidelity(labels, readings))
      const [withFigure, without] = lists(md)
      expect(withFigure!.heading).toMatch(/\(1\)$/)
      expect(withFigure!.items).toEqual([expect.stringMatching(/^- period: ".*Sentence of S3F1\..*: drops since March 2$/)])
      expect(without!.heading).toMatch(/\(1\)$/)
      expect(without!.items).toEqual([expect.stringMatching(/^- scope: ".*Sentence of S7F1\..*: drops during El Niño years$/)])
      expect(md).not.toContain('Sentence of S2F1.')
      expect(md).not.toContain('Sentence of S8F1.')
    })

    it('says so when the second pass found no fact of a group changed', () => {
      const md = report(
        scoreFidelity(
          labels,
          readings.filter(r => r.rejection.item.fact !== fig3),
        ),
      )
      const all = lines(md)
      const [withFigure, without] = all.flatMap((l, i) => (l.startsWith('#### ') ? [i] : []))
      expect(all[withFigure!]).toMatch(/\(0\)$/)
      expect(all.slice(withFigure! + 1, without!).filter(Boolean)).toEqual(['None.'])
      expect(lists(md)[1]!.items).toHaveLength(1)
    })

    it("lists the facts the second pass left unjudged, those with a figure first, with the label pass's reason, and only when there are some", () => {
      const md = report(
        scoreFidelity(
          labels,
          readings.filter(r => r.rejection.item.fact !== plain8),
        ),
      )
      const unjudged = lists(md)[2]!
      expect(unjudged.heading).toMatch(/\(2\)/)
      expect(unjudged.items).toEqual([
        expect.stringMatching(/^- ".*Sentence of S4F1\..*: not in the sentence$/),
        expect.stringMatching(/^- ".*Sentence of S8F1\..*: not in the sentence$/),
      ])
      const answered = [...readings, read(fig4!, 'changed', 'figure', 'a year as a quantity')]
      expect(lists(report(scoreFidelity(labels, answered)))).toHaveLength(2)
    })

    it('says why the second pass did not run, gives no table by kind, and lists every fact the label pass rejected under its group, a figure first, past the cap', () => {
      const figures = Array.from({ length: MAX_LISTED + 2 }, (_, i) => contextFact(`S${i + 1}F1`))
      const many = contextFactFixtures([{ slug: 'story-a', title: 'Story A', facts: [...figures, contextFact('S99F1', { value: null })] }], 300)
      const all = { accepted: [], unsupported: many.facts.map(rejectedBy), unlabeled: [] }
      const why = 'estimate $0.5000 for 4 uncached calls exceeds the remaining budget $0.1000'
      const md = renderOverviewReport(
        input({
          steps: ['pass-pool', 'fact-check'],
          factCheck: {
            sample: { source: 'pool', facts: many, half: 'judge' },
            labeled: many.facts.length,
            labels: all,
            variants: [],
            scores: [],
            stoppedDrift: why,
            fidelity: scoreFidelity(all, null),
          },
        }),
      )
      expect(md).toContain(`The second pass did not run: ${why}.`)
      expect(md).toContain(`- With a figure: 0 of ${MAX_LISTED + 2} judged facts accepted by the label pass; 0 without a verdict.`)
      expect(md).not.toContain('| Changed, by kind |')
      const [withFigure, without] = lists(md)
      expect([withFigure!.heading, without!.heading].map(h => /\((\d+)\)$/.exec(h)?.[1])).toEqual([String(MAX_LISTED + 2), '1'])
      expect(withFigure!.items).toHaveLength(MAX_LISTED + 2)
      expect(withFigure!.items.every(l => l.endsWith(': not in the sentence'))).toBe(true)
      expect(without!.items).toEqual([expect.stringContaining('Statement of S99F1.')])
      expect(md).not.toContain('### Statements their evidence does not support')
    })

    it('closes the fact-check section, after the variants table and the arms', () => {
      const fidelity = scoreFidelity(labels, readings)
      const md = report(fidelity, { scores: [scoreArm({ arm: 'gpt-6-luna@low', runs: [[]] })] })
      const measure = md.indexOf(rows(fidelity.bars)[0]!)
      expect(md.indexOf('| Kind | Expected | Variants |')).toBeLessThan(measure)
      expect(md.indexOf('#### False rejections')).toBeGreaterThan(-1)
      expect(md.indexOf('#### False rejections')).toBeLessThan(measure)
    })
  })

  it('shows no rendering measure for a sample of statements', () => {
    const md = renderOverviewReport(
      input({
        steps: ['fact-check'],
        factCheck: { sample: { source: 'research', fixtures }, labeled: 0, labels: { accepted: [], unsupported: [], unlabeled: [] }, variants: [], scores: [] },
      }),
    )
    expect(md).not.toContain('judged facts accepted')
    expect(md).not.toContain('| Measure |')
  })

  it("checks a first pass's pool facts as rendered, with the field-level kinds", () => {
    const facts = contextFactFixtures([{ slug: 'story-a', title: 'Story A', facts: [contextFact('S1F1'), contextFact('S2F1', { value: null })] }], 300)
    const md = renderOverviewReport(
      input({
        steps: ['pass-pool', 'fact-check'],
        factCheck: {
          sample: { source: 'pool', facts, half: 'judge' },
          labeled: 2,
          labels: { accepted: facts.facts, unsupported: [], unlabeled: [] },
          variants: [],
          scores: [scoreArm({ arm: 'gpt-6-luna@low', runs: [[]] })],
        },
      }),
    )
    expect(md).toContain('`--facts pool`):** 2 facts (of 300 asked for)')
    expect(md).toContain('from 1 stories (half judge)')
    expect(md).toContain('| wrong-place | unsupported | 0 |')
    expect(md).toContain('as rendered against their evidence')
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
              withResearchRun: 2,
              eitherRoles: 3,
              toReview: 2,
              rolesToReview: 1,
            },
            errors: ['entry a: quote not found: "x"'],
            sharedMusts: [{ slug: 'deal', keys: ['ebola', 'strait'] }],
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
    expect(md).toContain('| Ebola | ebola.json | 3 / 1 | 2 | 1 | 4 | 2 | 2 | 3 | 2 | 1 | 1 |')
    expect(md).toContain('2 drafted responses and centers are not reviewed yet')
    expect(md).toContain('1 entry carries a role an AI session changed (`roleReview`')
    expect(md).toContain('- entry a: quote not found: "x"')
    expect(md).toContain('1 story is a must entry of more than one development.')
    expect(md).toContain('- deal: ebola, strait')
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

describe('the figure check against its source', () => {
  /** A kept figure (100 people) and one production removed (3 villages). */
  const sample = figureFixtures(
    [
      {
        slug: 'a',
        title: 'A',
        facts: [contextFact('S1F1', { supportingSentence: 'About 100 people fled.' }), contextFact('S1F2', { value: null, unit: '', counted: '' })],
        removed: [{ ref: 'S1F2', figure: '3 villages', counted: 'villages burned', answer: 'computed' }],
      },
    ],
    300,
  )
  const [kept, removed] = sample.figures
  const labels: Answered<FigureFixture>[] = [
    { item: kept!, answer: 'given' },
    { item: removed!, answer: 'given' },
  ]
  const variants = kept?.kept ? figureVariants(kept) : []
  /** The arm misses every planted error. */
  const runs = [{ arm: 'gpt-6-luna@low', runs: [variants.map(item => ({ item, answer: 'given' as const }))] }]
  const none = { calls: 0, uncached: 0, usd: 0 }
  const result = (extra: Partial<FigureCheckResult> = {}): FigureCheckResult => ({
    source: 'pool',
    half: 'judge',
    sample,
    labeled: sample.figures.length,
    estimate: { labels: none, arms: none, armsUpperBound: false },
    labels,
    variants,
    stopped: null,
    score: scoreFigureCheck(labels, runs),
    ...extra,
  })
  /** The section's lines, its heading up to the next. */
  const section = (md: string) => {
    const lines = md.split('\n')
    const from = lines.indexOf('## Figure check against its source')
    const to = lines.findIndex((l, i) => i > from && l.startsWith('## '))
    return lines.slice(from + 1, to)
  }

  it("follows the fact check's section", () => {
    const factCheck: FactCheckReport = {
      sample: { source: 'research', fixtures },
      labeled: 0,
      labels: { accepted: [], unsupported: [], unlabeled: [] },
      variants: [],
      scores: [],
    }
    expect(headings(renderOverviewReport(input({ factCheck, figureCheck: result() })))).toEqual([
      '## Fact check under planted errors',
      '## Figure check against its source',
      '## Spend',
    ])
  })

  it("gives each arm's bars, and lists the arm's misses and production's disagreements with the figure's source", () => {
    const md = section(renderOverviewReport(input({ figureCheck: result() }))).join('\n')
    for (const row of rows(result().score.bars)) expect(md).toContain(row)
    expect(md).toContain('### gpt-6-luna@low')
    expect(md).toContain('150 people')
    expect(md).toContain('3 villages')
    expect(md).toContain('About 100 people fled.')
  })

  it('says why the label pass did not run, and shows nothing it would have given', () => {
    const lines = section(
      renderOverviewReport(
        input({ figureCheck: result({ labels: null, variants: [], stopped: { pass: 'labels', reason: 'reason R' }, score: scoreFigureCheck(null, []) }) }),
      ),
    )
    expect(lines.join('\n')).toContain('reason R')
    expect(lines.filter(l => l.startsWith('|') || l.startsWith('#'))).toEqual([])
  })

  it('says why no arm ran once the labels were known, and shows the labels but no arm', () => {
    const md = section(
      renderOverviewReport(input({ figureCheck: result({ stopped: { pass: 'arms', reason: 'reason R' }, score: scoreFigureCheck(labels, []) }) })),
    ).join('\n')
    expect(md).toContain('reason R')
    expect(md).toContain('3 villages')
    expect(md).not.toContain('### gpt-6-luna@low')
  })

  it('renders an empty sample with its shortfall and its bars without a value', () => {
    const empty = figureFixtures([], 300)
    const score = scoreFigureCheck([], [{ arm: 'gpt-6-luna@low', runs: [[]] }])
    const md = section(renderOverviewReport(input({ figureCheck: result({ sample: empty, labeled: 0, labels: [], variants: [], score }) }))).join('\n')
    expect(md).toContain(empty.shortfalls[0]!)
    for (const row of rows(score.bars)) expect(md).toContain(row)
  })
})
