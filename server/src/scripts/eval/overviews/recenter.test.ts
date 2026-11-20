import { describe, expect, it } from 'vitest'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import { readKeyFiles, type KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { offeredOn, plannedCases, runRecenterStep } from './recenter.js'
import { ANCHOR_BREACH, NARROWED_PLANTS } from './recenterPlants.js'
import { scoreRecenters, type RecenterCaseRun } from './recenterScore.js'
import { checkpointsOf } from './replayScore.js'
import { recenterLines } from './upkeepReport.js'

const FILES = readKeyFiles()
const KEYS = FILES.flatMap(f => (f.key ? [f.key] : []))
const byId = new Map(KEYS.map(k => [k.id, k]))

/** Every slug of the keys, each a published story on its key date; near misses that are no key's entry are titled NEAR, so the fake model turns them away. */
const entrySlugs = new Set(KEYS.flatMap(k => k.entries.map(e => e.slug)))
const STORIES = new Map<string, LinkStory>()
for (const k of KEYS)
  for (const x of [...k.entries, ...k.nearMisses])
    STORIES.set(x.slug, {
      id: `id-${x.slug}`,
      title: `${entrySlugs.has(x.slug) ? 'Title' : 'NEAR'} ${x.slug}`,
      label: 'Label',
      summary: 'Summary.',
      datePublished: new Date(`${x.date}T08:00:00Z`),
      date: x.date,
      issueId: null,
      facts: [],
    })
const stories = async (slugs: string[]) => new Map(slugs.map(s => [s, STORIES.get(s) ?? null]))

const ids = (prompt: string, tag: 'ENTRY' | 'STORY') =>
  [...prompt.matchAll(new RegExp(`<${tag} id="([ES]\\d+)"[^>]*>\\n<TITLE>([^<]*)</TITLE>`, 'g'))].map(m => ({ id: m[1]!, near: m[2]!.startsWith('NEAR') }))

/** A model that re-centers every case, keeping every entry and taking in every story but the near misses; the judge agrees. */
const answer = (schemaName: string, prompt: string): unknown => {
  const entries = ids(prompt, 'ENTRY').map(e => ({ id: e.id, belongs: 'yes', reason: 'fits' }))
  const told = ids(prompt, 'STORY')
  if (schemaName.startsWith('overview-end-event-judge')) return { same: 'yes', why: 'the same declaration' }
  if (schemaName.startsWith('overview-recenter-check'))
    return { entries, stories: told.map(s => ({ id: s.id, belongs: s.near ? 'no' : 'yes', reason: 'x' })), endEventConcrete: 'yes', neighbours: [] }
  const out = [...prompt.matchAll(/<OUT>([^<]*)<\/OUT>/g)].map(m => m[1]!)
  return {
    decision: 'recenter',
    title: 'The development as it grew',
    charter: { in: 'Everything the development became.', out, endEvent: 'The end the key names.' },
    entries,
    stories: told.map(s => ({ id: s.id, belongs: s.near ? 'no' : 'yes', role: 'routine', roleKind: null })),
    reason: 'It grew.',
  }
}

describe('the planted cases', () => {
  it("name must entries of their keys published by the two-thirds checkpoint, and the breach Colorado's near misses", () => {
    for (const p of NARROWED_PLANTS) {
      const k = byId.get(p.key)!
      const day = checkpointsOf(k).find(c => c.at === 'two-thirds')!.day
      for (const slug of p.members)
        expect(
          k.entries.find(e => e.slug === slug && e.join === 'must' && e.date <= day),
          `${p.key}: ${slug}`,
        ).toBeDefined()
      expect(p.members.length).toBeGreaterThanOrEqual(2)
    }
    const colorado = byId.get(ANCHOR_BREACH.key)!
    for (const slug of ANCHOR_BREACH.offered) expect(colorado.nearMisses.some(n => n.slug === slug)).toBe(true)
  })
})

describe('offeredOn', () => {
  it('takes the stories of the 90 days up to the day, newest first, at most half of the ten near misses', () => {
    const nm = Array.from({ length: 7 }, (_, i) => ({ slug: `n${i}`, date: `2026-06-0${i + 1}` }))
    const en = [
      ...Array.from({ length: 7 }, (_, i) => ({ slug: `e${i}`, date: `2026-05-1${i}` })),
      { slug: 'old', date: '2026-01-01' },
      { slug: 'later', date: '2026-07-01' },
    ]
    expect(offeredOn('2026-06-30', en, nm)).toEqual(['n6', 'n5', 'n4', 'n3', 'n2', 'e6', 'e5', 'e4', 'e3', 'e2'])
    expect(offeredOn('2026-06-30', en.slice(0, 2), nm.slice(0, 1))).toEqual(['n0', 'e1', 'e0'])
  })
})

describe('plannedCases', () => {
  const judged = KEYS.filter(k => ['ebola-drc-2026', 'el-nino-2026', 'lebanon-war-2026', 'pandemic-agreement-pabs', 'colorado-river-rules'].includes(k.id))

  it('builds the plants at the two-thirds checkpoint, the breach on its newest story, and the negatives at the end', async () => {
    const { planned, notRun } = plannedCases(judged, await stories([...STORIES.keys()]))
    expect(planned.map(p => `${p.id} ${p.day} ${p.members}/${p.offered}`)).toEqual([
      'planted ebola-drc-2026 2026-10-11 5/10',
      'planted el-nino-2026 2026-08-27 3/10',
      'planted lebanon-war-2026 2026-03-24 3/10',
      'planted pandemic-agreement-pabs 2026-06-18 2/6',
      'planted colorado-river-rules 2026-06-06 2/6',
      'breach colorado-river-rules 2026-08-26 6/4',
      'negative colorado-river-rules 2026-08-18 6/4',
      'negative ebola-drc-2026 2026-11-16 52/3',
      'negative el-nino-2026 2026-11-07 43/8',
      'negative lebanon-war-2026 2026-04-25 15/7',
    ])
    expect(notRun).toEqual([{ what: 'negative pandemic-agreement-pabs', reason: '0 stories to offer on 2026-09-12, fewer than the 2 a re-center takes in' }])
    const ebola = planned[0]!
    expect(ebola.case.charter.out).toEqual(byId.get('ebola-drc-2026')!.charter.out)
    expect(ebola.case.anchor.founding).toEqual([
      'entry:who-declares-international-emergency-after-deaths-in-drc-and-uganda',
      'entry:who-raises-national-risk-to-very-high-in-eastern-drc',
    ])
    expect(ebola.case.stories.map(s => s.date)).toEqual([...ebola.case.stories.map(s => s.date)].sort().reverse())
  })

  it("builds a key's center on the day of its third entry on or after from, and leaves a thinner one out", async () => {
    const colorado = byId.get('colorado-river-rules')!
    const center = (n: number): AnswerKey => ({
      ...colorado,
      centers: [
        {
          from: '2026-09-01',
          title: 'Colorado River water shortage',
          charter: { in: 'The shortage.', out: [...colorado.charter.out], endEvent: null },
          why: 'Shortage',
          entries: Array.from({ length: n }, (_, i) => ({
            slug: `shortage-${i}`,
            date: `2026-09-0${i + 2}`,
            title: `S${i}`,
            join: 'must' as const,
            role: 'routine' as const,
            kind: null,
            values: [],
            statuses: [],
            why: 'x',
          })),
          nearMisses: [],
          responses: [],
          closed: null,
          reviewed: true,
        },
      ],
    })
    const loaded = new Map([
      ...STORIES,
      ...[0, 1, 2].map(i => [`shortage-${i}`, { ...STORIES.get(colorado.entries[0]!.slug)!, id: `id-s${i}`, date: `2026-09-0${i + 2}` }] as const),
    ])
    const three = plannedCases([center(3)], loaded).planned.find(p => p.kind === 'center')!
    expect(three).toMatchObject({
      id: 'center colorado-river-rules "Colorado River water shortage"',
      day: '2026-09-04',
      members: 6,
      offered: 3,
      expectedEndEvent: null,
    })
    expect(three.case.title).toBe(colorado.title)
    expect(plannedCases([center(2)], loaded).notRun).toContainEqual({
      what: 'center colorado-river-rules "Colorado River water shortage"',
      reason: '2 center entries on or after 2026-09-01, fewer than 3: too thin to build',
    })
  })
})

describe('runRecenterStep', () => {
  it('asks every case its runs, judges the applied end events, and scores the bars', async () => {
    const ctx = fakeEvalContext(answer)
    const report = await runRecenterStep({ ctx, files: FILES, half: 'judge', stories, budgetUsd: 5 })
    expect(report.runs).toHaveLength(5 * 3 + 3 + 4)
    expect(ctx.calls).toHaveLength(15 * 3 + 7 * 2)
    expect(report.runs.filter(r => r.kind === 'planted').every(r => r.outcome === 'recentered' && r.anchorHeld && r.endEventVerdict === 'right')).toBe(true)
    expect(report.runs.filter(r => r.kind !== 'planted').map(r => `${r.outcome} ${r.rule}`)).toEqual(Array(7).fill('refused joins'))
    expect(report.score).toMatchObject({
      positives: 15,
      recentered: 15,
      negatives: 7,
      falseRecenters: 0,
      nearMissesJoined: 0,
      heldBy: { 'refused (joins)': 7 },
    })
    expect(report.score.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['re-centered where expected', 1, null],
      ['wrong end events (where one is named)', 0, true],
      ['false re-centers', 0, true],
      ['near misses joined', 0, true],
      ['applied re-centers whose anchor did not hold', 0, true],
    ])
    const text = recenterLines(report).join('\n')
    expect(text).toContain('| planted ebola-drc-2026 | 2026-10-11 | 1 | recentered |')
    expect(text).toContain('Not run: negative pandemic-agreement-pabs')
  })

  it('asks nothing once the budget is spent, and refuses a half that holds a center no one reviewed', async () => {
    const spent = await runRecenterStep({ ctx: fakeEvalContext(answer, { spentUsd: 5 }), files: FILES, half: 'judge', stories, budgetUsd: 5 })
    expect(spent.runs).toEqual([])
    expect(spent.stopped).toMatch(/budget ran out in run 1/)
    const colorado = byId.get('colorado-river-rules')!
    const drafted: KeyFile[] = [
      {
        file: 'colorado-river-rules.json',
        key: {
          ...colorado,
          centers: [
            {
              from: '2026-09-01',
              title: 'Shortage',
              charter: colorado.charter,
              why: 'x',
              entries: [],
              nearMisses: [],
              responses: [],
              closed: null,
              reviewed: false,
            },
          ],
        },
        errors: [],
      },
    ]
    const ctx = fakeEvalContext(answer)
    const refused = await runRecenterStep({ ctx, files: drafted, half: 'judge', stories, budgetUsd: 5 })
    expect(refused.stopped).toMatch(/^refused: 1 drafted center is not reviewed yet/)
    expect(ctx.calls).toEqual([])
  })
})

describe('scoreRecenters', () => {
  const run = (over: Partial<RecenterCaseRun>): RecenterCaseRun => ({
    case: 'c',
    kind: 'planted',
    key: 'k',
    day: '2026-06-01',
    run: 1,
    outcome: 'recentered',
    rule: null,
    refusals: [],
    title: 't',
    endEvent: 'e',
    joined: [],
    nearMissesJoined: [],
    detached: [],
    anchorHeld: true,
    endEventVerdict: 'right',
    why: null,
    costUsd: 0,
    ...over,
  })

  it('counts a false re-center, a near miss joined, a broken anchor and a wrong end event, and leaves failed calls out', () => {
    const s = scoreRecenters([
      run({ nearMissesJoined: ['n1'], endEventVerdict: 'wrong' }),
      run({ outcome: 'kept', title: null, endEventVerdict: null, anchorHeld: null }),
      run({ outcome: 'failed', endEventVerdict: null, anchorHeld: null }),
      run({ kind: 'breach', anchorHeld: false, endEventVerdict: null }),
      run({ kind: 'negative', outcome: 'refused', rule: 'anchor', endEventVerdict: null, anchorHeld: null }),
    ])
    expect(s).toMatchObject({
      positives: 2,
      recentered: 1,
      negatives: 2,
      falseRecenters: 1,
      nearMissesJoined: 1,
      anchorRegressions: 1,
      failed: 1,
      heldBy: { 'refused (anchor)': 1 },
    })
    expect(s.bars.map(b => [b.value, b.met])).toEqual([
      [0.5, null],
      [1, false],
      [1, false],
      [1, false],
      [1, false],
    ])
  })

  it('leaves the end-event bar without a verdict while one is unjudged, and every bar without data on no attempt', () => {
    expect(scoreRecenters([run({ endEventVerdict: 'unjudged' })]).bars[1]!.value).toBeNull()
    expect(scoreRecenters([]).bars.every(b => b.value === null)).toBe(true)
  })
})
