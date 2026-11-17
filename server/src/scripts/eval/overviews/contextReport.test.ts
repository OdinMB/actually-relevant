import { describe, it, expect } from 'vitest'
import { contextFact, contextResult, gapKey, sentenceBox } from '../../../test/contextFixtures.js'
import type { ContextStepReport } from './context.js'
import { contextLines, gapDraftLines, gapKeyLines } from './contextReport.js'
import { resultDates, scoreContext, scoreFields, type FieldLabel, type StoryRun } from './contextScore.js'
import type { GapDraftReport } from './gapDraft.js'

describe('gapKeyLines', () => {
  it('says how to begin when no key is committed', () => {
    expect(gapKeyLines([]).join('\n')).toMatch(/No gap keys committed yet.*--steps gap-draft/)
  })

  it('shows each key with its half, needs and response, and lists the errors', () => {
    const md = gapKeyLines([
      { file: 'a.json', summary: { slug: 'a', title: 'A | story', half: 'judge', needs: 4, must: 3, openMust: 2, response: 'findable' }, errors: [] },
      { file: 'b.json', summary: { slug: 'b', title: 'B', half: 'tune', needs: 3, must: 2, openMust: 1, response: 'in-story' }, errors: ['dated 2026-11-14'] },
      { file: 'c.json', summary: null, errors: ['not valid JSON'] },
    ]).join('\n')
    expect(md).toContain('3 gap keys: 1 in the tune half, 1 in the judge half')
    expect(md).toContain('Response needs: findable 1, in-story 1.')
    expect(md).toContain('| A / story | a.json | judge | 4 (3 must, 2 not in the story) | findable | 0 |')
    expect(md).toContain('| c.json | (does not parse) | | | | 1 |')
    expect(md).toContain('**b.json**\n\n- dated 2026-11-14')
  })
})

describe('gapDraftLines', () => {
  const report = (extra: Partial<GapDraftReport> = {}): GapDraftReport => ({
    createdAt: '2026-11-17T09:00:00.000Z',
    anchor: '2026-11-14',
    candidates: 40,
    sample: [
      { slug: 'a', issue: 'climate', figures: 4, stratum: 'climate · figure-heavy' },
      { slug: 'b', issue: 'climate', figures: 0, stratum: 'climate · figure-light' },
      { slug: 'c', issue: 'health', figures: 0, stratum: 'health · figure-light' },
      { slug: 'd', issue: 'health', figures: 0, stratum: 'health · figure-light' },
    ],
    shortfalls: ['4 of 30 items available'],
    noInput: ['c'],
    estimate: { calls: 2, uncached: 2, usd: 0.12 },
    stopped: null,
    drafts: [
      { slug: 'a', outcome: 'ok', key: gapKey({ slug: 'a' }), errors: ['slot why_now is neither needed nor not needed'] },
      { slug: 'b', outcome: 'parse_failure', key: null, errors: ['no draft: parse_failure'] },
    ],
    written: ['/out/gap-drafts/a.json'],
    ...extra,
  })

  it('shows the sample, its strata, and each story with its draft and format errors', () => {
    const md = gapDraftLines(report()).join('\n')
    expect(md).toContain('**Sample:** 4 of 30 stories from 40 candidates: published in the 4 months to the newest published story (2026-11-14)')
    expect(md).toContain('- Shortfall: 4 of 30 items available')
    expect(md).toContain('Strata: health · figure-light 2, climate · figure-heavy 1, climate · figure-light 1.')
    expect(md).toContain(
      '**Drafts:** 1 written to `gap-drafts/` in this folder, 1 of them with format errors to fix; 1 calls gave no draft (2 calls (2 uncached) ≈ $0.1200).',
    )
    expect(md).toContain('No input (production')
    expect(md).toContain('| a | climate · figure-heavy | written | slot why_now is neither needed nor not needed |')
    expect(md).toContain('| b | climate · figure-light | none (parse_failure) | no draft: parse_failure |')
    expect(md).toContain('| c | health · figure-light | no input |  |')
    expect(md).toContain('| d | health · figure-light | not drafted |  |')
  })

  it('says why no draft was made when the gate stopped the calls', () => {
    const md = gapDraftLines(report({ stopped: '2 uncached calls and OPENAI_API_KEY is missing', drafts: [], written: [], noInput: [], anchor: null })).join(
      '\n',
    )
    expect(md).toContain('**Drafts:** none; the calls did not run: 2 uncached calls and OPENAI_API_KEY is missing')
    expect(md).toContain('newest published story (none)')
    expect(md).not.toContain('No input')
  })
})

describe('contextLines', () => {
  const search = (slot: 'response' | 'next', query: string, kept: string[]) => ({
    slot,
    wanted: 'w',
    query,
    recent: false,
    cached: false,
    credits: 1,
    results: 3,
    kept,
  })
  const run = (n: number, extra: Partial<StoryRun> = {}): StoryRun => ({
    slug: 'story-a',
    run: n,
    key: gapKey(),
    result: contextResult(
      {
        facts: [contextFact('S1F1', { origin: 'search', source: { ...contextFact('S1F1').source, url: 'https://a.example/1' } })],
        boxes: [sentenceBox('response', ['S1F1'])],
        modelUsd: 0.02,
        credits: 2,
      },
      { searches: [search('response', 'peat moratorium', ['https://a.example/1']), search('next', 'next | step', ['https://b.example/2'])] },
    ),
    needs: [
      { id: 'record', met: n === 1, factIds: [], why: '' },
      { id: 'response', met: true, factIds: ['S1F1'], why: '' },
    ],
    items: [{ label: 'Box 1 sentence 1', text: 'A sentence.', supported: n === 1, problem: n === 1 ? '' : 'not stated' }],
    notes: [
      { mode: 'model', box: 0, place: 'P1', adds: true, why: '' },
      { mode: 'random', box: 0, place: 'P2', adds: false, why: '' },
    ],
    ...extra,
  })
  const label = (extra: Partial<FieldLabel> = {}): FieldLabel => ({
    key: 'story-a#1:S1F1',
    run: 1,
    verdict: 'supported',
    right: { value: true, unit: true, counted: true, place: false, asOf: true, credited: true },
    invented: false,
    problem: 'the place is the province',
    ...extra,
  })
  const report = (extra: Partial<ContextStepReport> = {}): ContextStepReport => {
    const runs = [run(1), run(2)]
    return {
      half: 'judge',
      repeat: 2,
      keys: 2,
      left: [{ file: 'gone.json', reason: 'no input: the story is not published' }],
      stories: 1,
      deskUsd: null,
      skipped: [{ storyId: 'late#2', reason: 'budget' }],
      judge: { estimate: { calls: 8, uncached: 8, usd: 0.4 }, stopped: null },
      score: scoreContext(runs),
      fields: scoreFields([
        label(),
        label({ key: 'story-a#2:S1F1', run: 2, right: { value: true, unit: true, counted: true, place: true, asOf: true, credited: true } }),
      ]),
      dates: resultDates([{ slug: 'story-a', run: 1, endDate: '2026-11-14', dates: ['2026-11-10', null, '2026-11-20', '2026-11-12'] }]),
      ...extra,
    }
  }

  it('holds the means over the runs against the bars', () => {
    const md = contextLines(report()).join('\n')
    expect(md).toContain('**Stories:** 1 of 2 gap keys chosen (half judge), each run 2 times')
    expect(md).toContain('- Left out: gone.json: no input')
    expect(md).toContain('- Not run: late#2: budget')
    expect(md).toContain('**Strong judge:** 8 calls (8 uncached) ≈ $0.4000.')
    expect(md).toContain("| Must needs the story doesn't state, met by the kept cards | at least 60.0% | 75.0% | 50.0% to 100.0%, SD 35.4% | met |")
    expect(md).toContain('| Wasted searches per story | at most 1 | 1.00 | 1.00 to 1.00, SD 0.00 | met |')
    expect(md).toContain('| Box items the strong judge finds their cited facts do not support | none | 0.5 | 0.0 to 1.0, SD 0.7 | not met |')
    expect(md).toContain('| Notes `model` places beside a paragraph or point that add to it | at least 85.0% | 100.0% |')
    expect(md).toContain('| Cost per story (model calls at the flex price, plus search credits) | at most $0.0500 | $0.0260 |')
    expect(md).toContain('| at least 95.0%; none | 50.0%; 0 | 0.0% to 100.0%, SD 70.7% | not met |')
  })

  it('shows each run, the fields, the hindsight and the items for a read', () => {
    const md = contextLines(report()).join('\n')
    expect(md).toContain('| 2 | 1 | 0 | 1 of 2 | 2 (1; 1) | 1 of 1 | 1 (1; 0) | 100.0% of 1 / 0.0% of 1 | $0.0260 |')
    expect(md).toContain('Wrong by field: value 0, unit 0, counted 0, place 1, asOf 0, credited 0.')
    expect(md).toContain('4 results, 1 of them undated (25.0%) and 1 dated after the story')
    expect(md).toContain('#### Box items found unsupported (1)')
    expect(md).toContain('- story-a#2, Box 1 sentence 1: "A sentence.": not stated')
    expect(md).toContain('- story-a#2: record')
    expect(md).toContain('- story-a#1, next: "next / step"')
    expect(md).toContain('- story-a#1:S1F1 (supported): place: the place is the province')
  })

  it('says the judge did not run, and calls a limited run a smoke run', () => {
    const unjudged = [run(1, { needs: null, items: null, notes: null })]
    const md = contextLines(
      report({
        limit: 1,
        repeat: 1,
        judge: { estimate: { calls: 4, uncached: 4, usd: 0.2 }, stopped: '4 uncached calls and OPENAI_API_KEY is missing' },
        score: scoreContext(unjudged),
        fields: scoreFields([]),
      }),
    ).join('\n')
    expect(md).toContain('the first 1: a smoke run, not evidence), each run 1 time ')
    expect(md).toContain('**The strong judge did not run:** 4 uncached calls and OPENAI_API_KEY is missing')
    expect(md).toContain('| none | n/a | n/a | no verdicts |')
    expect(md).toContain('| Wasted searches per story | at most 1 | 1.00 | one run | met |')
  })
})
