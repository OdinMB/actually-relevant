import { describe, expect, it } from 'vitest'
import type { MemberFact } from '../../../services/overviewStands.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import type { PoolFact, PoolSource } from '../../../services/researchPool.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { runPassPool } from './passPool.js'
import { runReplayStep } from './replay.js'
import { runReviewStep } from './review.js'
import { runStandsStep } from './stands.js'
import { replayLines, reviewLines, standsLines } from './upkeepReport.js'

type Entry = AnswerKey['entries'][number]

const DAYS = ['2026-05-01', '2026-05-03', '2026-05-05']
const ID = 'ebola-drc-2026'

const entry = (slug: string, date: string, over: Partial<Entry> = {}): Entry => ({
  slug,
  date,
  title: slug,
  join: 'must',
  role: 'routine',
  kind: null,
  values: [],
  statuses: [],
  why: 'belongs',
  ...over,
})

const KEY: AnswerKey = {
  schemaVersion: 2,
  id: ID,
  title: 'Ebola in eastern DR Congo',
  charter: { in: 'The Ebola outbreak in eastern DR Congo.', out: [], endEvent: 'The outbreak is declared over.' },
  figures: [],
  entries: [
    entry('e1', DAYS[0]!, { values: [{ figure: 'cases', value: 120, approx: 'exact', asOf: DAYS[0]!, matches: true, countedAs: null, quote: '120' }] }),
    entry('e2', DAYS[1]!),
    entry('e3', DAYS[2]!),
  ],
  nearMisses: [{ slug: 'n1', date: DAYS[1]!, title: 'n1', why: 'same province' }],
  responses: [{ date: DAYS[0]!, what: 'WHO ring vaccination', slug: 'e1', quote: 'vaccination', reviewed: true }],
  centers: [],
  notes: '',
}
/** The key as `key-draft` leaves it: its response drafted, not reviewed yet. */
const DRAFTED: KeyFile[] = [
  {
    file: `${ID}.json`,
    key: { ...KEY, responses: KEY.responses.map(r => ({ ...r, reviewed: false })) },
    errors: [],
  },
]
const FILES: KeyFile[] = [
  { file: `${ID}.json`, key: KEY, errors: [] },
  { file: 'broken.json', key: null, errors: ['not JSON'] },
]

const story = (slug: string, date: string): LinkStory => ({
  id: `id-${slug}`,
  title: `Title ${slug}`,
  label: `Label ${slug}`,
  summary: `Summary ${slug}.`,
  datePublished: new Date(`${date}T08:00:00Z`),
  date,
  issueId: null,
  facts: [],
})
const STORIES = new Map([
  ...KEY.entries.map(e => [e.slug, story(e.slug, e.date)] as const),
  ['n1', story('n1', DAYS[1]!)] as const,
  // A center's entry, for the keys below that hold one
  ['w1', story('w1', DAYS[1]!)] as const,
])
const stories = async (slugs: string[]) => new Map(slugs.map(s => [s, STORIES.get(s) ?? null]))

const source = (storyId: string, date: string): PoolSource => ({
  id: `src-${storyId}`,
  ref: 'S1',
  origin: 'search',
  earlierStoryId: null,
  url: `https://example.org/${storyId}`,
  outlet: 'Outlet',
  title: `Page ${storyId}`,
  date,
  kind: 'news-report',
  country: 'DR Congo',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: 'pass-1',
})

const fact = (storyId: string, n: number, date: string): PoolFact => ({
  id: `${storyId}:f${n}`,
  ref: `S1F${n}`,
  sourceRef: 'S1',
  reusedFromId: null,
  supportingSentence: `Officials reported finding ${n === 1 ? 120 : n * 7} things in the province.`,
  passage: null,
  supportFound: true,
  statement: n === 1 ? 'Confirmed cases rose to 120.' : `Statement ${n} about ${storyId}.`,
  measures: '',
  slot: null,
  structured: {
    value: n === 1 ? 120 : n * 7,
    valueHigh: null,
    unit: 'cases',
    approx: 'exact',
    provisional: false,
    counted: 'confirmed cases',
    place: 'North Kivu',
    asOf: date,
    credited: '',
    creditedKind: null,
    validity: 'fast',
    by: { model: 'm', promptVersion: 'v' },
  },
  extractedBy: { model: 'm', promptVersion: 'v' },
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: { model: 'm', promptVersion: 'v', passId: 'pass-1' },
  status: 'unreviewed',
  firstPassId: 'pass-1',
  drop: null,
})

const facts = async (ids: string[]): Promise<MemberFact[]> =>
  ids.flatMap(id => {
    const s = [...STORIES.values()].find(x => x.id === id)!
    return [1, 2, 3].map(n => ({ storyId: id, published: true, fact: fact(id, n, s.date), source: source(id, s.date) }))
  })

const base = (schemaName: string) => schemaName.split('#')[0]

/** The stands write, its fact check and the judge, each answering one line. */
const standsAnswer = (schemaName: string): unknown => {
  const name = base(schemaName)
  if (name === 'overview-stands-check') return { items: [{ number: 1, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' }] }
  if (name === 'overview-stands-judge') return { lines: [{ id: 'L1', supported: 'yes', why: '' }] }
  if (name === 'overview-stands') return { sentences: [{ text: 'The outbreak has reached 120 confirmed cases.', factIds: ['S1F1'] }], doing: [] }
  return null
}

describe('runStandsStep', () => {
  it("writes, checks and judges the stands at each checkpoint from the must entries published by then, and keeps run 1's lines", async () => {
    const ctx = fakeEvalContext(standsAnswer)
    const report = await runStandsStep({ ctx, files: FILES, half: 'judge', stories, facts, repeat: 2, budgetUsd: 5 })
    expect(report.keys).toEqual([ID])
    expect(report.runs.map(r => [r.run, r.at, r.offered, r.outcome])).toEqual([
      [1, 'third', 3, 'written'],
      [1, 'two-thirds', 6, 'written'],
      [1, 'end', 9, 'written'],
      [2, 'third', 3, 'written'],
      [2, 'two-thirds', 6, 'written'],
      [2, 'end', 9, 'written'],
    ])
    const [first] = report.runs
    expect(first).toMatchObject({
      lines: [{ part: 'sentence', text: 'The outbreak has reached 120 confirmed cases.', supported: true }],
      latest: [{ figure: 'cases', value: 120, stated: true }],
      responseDue: true,
      doingPresent: false,
    })
    expect(report.kept).toHaveLength(3)
    expect(report.kept[0]!.facts.map(f => f.statement)).toEqual(['Confirmed cases rose to 120.'])
    expect(ctx.calls.some(c => c.schemaName.endsWith('~run2'))).toBe(true)
    expect(report.score).toMatchObject({ checkpoints: 3, enough: 3 })
    expect(report.score.note).toMatch(/not enough evidence/)
    const text = standsLines(report).join('\n')
    expect(text).toContain(`| ${ID} | ${DAYS[0]} | 1 | 3 | written | 1 (0) | 1 of 1 | yes / no |`)
  })

  it("writes each checkpoint under the key's center in force that day: its title and its members", async () => {
    const ctx = fakeEvalContext(standsAnswer)
    const center = {
      from: DAYS[1]!,
      title: 'Ebola across the Great Lakes',
      charter: { in: 'Wider.', out: [], endEvent: null },
      why: 'It spread',
      entries: [entry('w1', DAYS[1]!)],
      nearMisses: [],
      responses: [],
      reviewed: true,
    }
    const report = await runStandsStep({
      ctx,
      files: [{ file: `${ID}.json`, key: { ...KEY, centers: [center] }, errors: [] }],
      half: 'judge',
      stories,
      facts,
      repeat: 1,
      budgetUsd: 5,
    })
    expect(report.runs.map(r => [r.at, r.offered])).toEqual([
      ['third', 3],
      ['two-thirds', 9],
      ['end', 12],
    ])
    const written = ctx.calls.filter(c => base(c.schemaName) === 'overview-stands').map(c => c.prompt.includes(center.title))
    expect(written).toEqual([false, true, true])
  })

  it('counts a checkpoint with too few facts without writing it, and starts nothing once the budget is spent', async () => {
    const ctx = fakeEvalContext(standsAnswer)
    const few = await runStandsStep({ ctx, files: FILES, half: 'all', stories, facts: async () => [], repeat: 1, budgetUsd: 5, limit: 1 })
    expect(few.runs.map(r => [r.enough, r.outcome])).toEqual([
      [false, null],
      [false, null],
      [false, null],
    ])
    expect(ctx.calls).toEqual([])
    const spent = await runStandsStep({
      ctx: fakeEvalContext(standsAnswer, { spentUsd: 5 }),
      files: FILES,
      half: 'judge',
      stories,
      facts,
      repeat: 1,
      budgetUsd: 5,
    })
    expect(spent.runs).toEqual([])
    expect(spent.stopped).toMatch(/the budget ran out in run 1/)
  })

  it('refuses, before reading a story or making a call, while a response of its half is a draft no one reviewed', async () => {
    const ctx = fakeEvalContext(standsAnswer)
    let asked = 0
    const report = await runStandsStep({
      ctx,
      files: DRAFTED,
      half: 'judge',
      stories: async slugs => {
        asked += slugs.length
        return stories(slugs)
      },
      facts,
      repeat: 1,
      budgetUsd: 5,
    })
    expect(report.stopped).toBe(
      `refused: 1 drafted response is not reviewed yet (${ID}: 1): in each key, mark every one "reviewed": true or delete it, then run again`,
    )
    expect([report.runs, ctx.calls, asked]).toEqual([[], [], 0])
    expect(standsLines(report).join('\n')).toContain('- Stopped: refused: 1 drafted response')
    // Another half's drafts do not stop it
    expect((await runStandsStep({ ctx, files: DRAFTED, half: 'tune', stories, facts, repeat: 1, budgetUsd: 5 })).stopped).toBeUndefined()
  })
})

describe('runReviewStep', () => {
  // Every entry judged to belong as routine, and OUT given one phrase again
  const reviewAnswer = (schemaName: string): unknown =>
    base(schemaName) === 'overview-review'
      ? {
          entries: ['E1', 'E2', 'E3', 'E4'].map(id => ({ id, belongs: 'yes', reason: 'Belongs.', role: 'routine', roleKind: null })),
          charter: { ...KEY.charter, out: ['Uganda'] },
          title: '',
          clearFreeze: false,
        }
      : null

  it('reviews each development with its plants and scores what was caught and demoted', async () => {
    const report = await runReviewStep({ ctx: fakeEvalContext(reviewAnswer), files: FILES, half: 'judge', stories, repeat: 1, budgetUsd: 5 })
    expect(report.keys).toEqual([ID])
    expect(report.cases).toHaveLength(1)
    expect(report.cases[0]!.plantedJoins).toEqual(['planted:n1'])
    // The flipped role set back and OUT narrowed again; the planted join kept
    expect(report.score.runs).toEqual([{ run: 1, planted: 3, caught: 2, correct: 2, demoted: 0 }])
    expect(reviewLines(report).join('\n')).toContain('| 1 | 2 of 3 | 0 of 2 |')
  })

  it('reviews nothing once the budget is spent', async () => {
    const report = await runReviewStep({ ctx: fakeEvalContext(reviewAnswer, { spentUsd: 5 }), files: FILES, half: 'all', stories, repeat: 1, budgetUsd: 5 })
    expect(report.cases).toEqual([])
    expect(report.stopped).toMatch(/budget ran out/)
  })
})

describe('runReplayStep', () => {
  it('links the stories day by day, runs the upkeep after each day and looks at each checkpoint', async () => {
    const ctx = fakeEvalContext(() => null)
    const report = await runReplayStep({
      ctx,
      files: FILES,
      half: 'judge',
      stories,
      // e2 sees e1 as a founding partner; the link call gives nothing, so the story fails, is linked again 1, 3 and 7 days later as in production, and is given up
      neighbours: async id => (id === 'id-e2' ? [{ id: 'id-e1', datePublished: STORIES.get('e1')!.datePublished, distance: 0.1, via: 'near' }] : []),
      facts,
      repeat: 1,
      concurrency: 2,
      budgetUsd: 5,
    })
    expect(report.stories).toBe(4)
    expect(report.left).toEqual([{ what: 'broken.json', reason: '1 format errors: fix the key' }])
    expect(ctx.calls.map(c => base(c.schemaName))).toEqual(['overview-link', 'overview-link', 'overview-link', 'overview-link'])
    const [run] = report.runs
    expect(run!.safeguards['stories given up after their last try']).toBe(1)
    expect(run!.checkpoints.map(c => [c.at, c.day, c.overview, c.mustByThen, c.mustFound])).toEqual([
      ['third', DAYS[0], null, 1, 0],
      ['two-thirds', DAYS[1], null, 2, 0],
      ['end', DAYS[2], null, 3, 0],
    ])
    const text = replayLines(report).join('\n')
    expect(text).toContain('### Checkpoints')
    expect(text).toContain(`| 1 | ${ID} | third | ${DAYS[0]} | none |`)
  })

  it('replays nothing once the budget is spent, and nothing without stories', async () => {
    const spent = await runReplayStep({
      ctx: fakeEvalContext(() => null, { spentUsd: 5 }),
      files: FILES,
      half: 'judge',
      stories,
      neighbours: async () => [],
      facts,
      repeat: 1,
      concurrency: 1,
      budgetUsd: 5,
    })
    expect(spent.stopped).toMatch(/the budget ran out in run 1/)
    const none = await runReplayStep({
      ctx: fakeEvalContext(() => null),
      files: FILES,
      half: 'judge',
      stories: async slugs => new Map(slugs.map(s => [s, null])),
      neighbours: async () => [],
      facts,
      repeat: 1,
      concurrency: 1,
      budgetUsd: 5,
    })
    expect(none.runs).toEqual([])
    expect(none.left.filter(l => l.reason === 'not published in this database').map(l => l.what)).toEqual(['e1', 'e2', 'e3', 'n1'])
  })

  it('refuses, before reading a story or making a call, while a center of a development of its half is a draft no one reviewed', async () => {
    const ctx = fakeEvalContext(() => null)
    let asked = 0
    const center = {
      from: DAYS[1]!,
      title: 'Ebola across the Great Lakes',
      charter: { in: 'Wider.', out: [], endEvent: null },
      why: 'It spread',
      entries: [entry('w1', DAYS[1]!)],
      nearMisses: [],
      responses: [],
      reviewed: false,
    }
    const report = await runReplayStep({
      ctx,
      files: [{ file: `${ID}.json`, key: { ...KEY, centers: [center] }, errors: [] }],
      half: 'judge',
      stories: async slugs => {
        asked += slugs.length
        return stories(slugs)
      },
      neighbours: async () => [],
      facts,
      repeat: 1,
      concurrency: 1,
      budgetUsd: 5,
    })
    expect(report.stopped).toMatch(new RegExp(`^refused: 1 drafted center is not reviewed yet \\(${ID}: 1\\)`))
    expect([report.runs, ctx.calls, asked, report.stories]).toEqual([[], [], 0, 0])
  })
})

describe('runPassPool', () => {
  it('leaves out the stories with no first-pass input and runs no pass for them', async () => {
    const { report, facts: pools } = await runPassPool({
      ctx: fakeEvalContext(() => null),
      tavily: { search: async () => ({ results: [] }) } as never,
      files: FILES,
      half: 'judge',
      inputs: async slugs => new Map(slugs.map(s => [s, null])),
      relevanceMin: 5,
      concurrency: 1,
      budgetUsd: 5,
      spentUsd: () => 0,
      limit: 2,
    })
    expect(report).toMatchObject({ stories: 0, withFacts: 0, facts: 0 })
    expect(report.left.map(l => l.what)).toEqual(['e1', 'e2'])
    expect(pools.size).toBe(0)
  })

  it("asks only for the stories the stands' checkpoints read, and says of how many must entries", async () => {
    const many: AnswerKey = { ...KEY, entries: Array.from({ length: 12 }, (_, i) => entry(`m${i + 1}`, `2026-05-${String(i + 1).padStart(2, '0')}`)) }
    let asked: string[] = []
    const { report } = await runPassPool({
      ctx: fakeEvalContext(() => null),
      tavily: { search: async () => ({ results: [] }) } as never,
      files: [{ file: `${ID}.json`, key: many, errors: [] }],
      half: 'judge',
      inputs: async slugs => {
        asked = slugs
        return new Map(slugs.map(s => [s, null]))
      },
      relevanceMin: 5,
      concurrency: 1,
      budgetUsd: 5,
      spentUsd: () => 0,
    })
    expect(asked).toEqual(['m2', 'm3', 'm4', 'm6', 'm7', 'm8', 'm10', 'm11', 'm12'])
    expect(report).toMatchObject({ mustEntries: 12, stories: 0 })
    expect(report.left).toHaveLength(9)
  })
})
