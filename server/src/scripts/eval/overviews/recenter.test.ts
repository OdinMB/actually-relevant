import { describe, expect, it } from 'vitest'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import { readKeyFiles, type KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { offeredOn, plannedCases, runRecenterStep, signalQuote } from './recenter.js'
import { ANCHOR_BREACH, NARROWED_PLANTS, NEIGHBOUR_ABSORB } from './recenterPlants.js'
import { scoreRecenters, type RecenterCaseRun } from './recenterScore.js'
import { checkpointsOf } from './replayScore.js'
import { recenterLines } from './upkeepReport.js'

const FILES = readKeyFiles()
const KEYS = FILES.flatMap(f => (f.key ? [f.key] : []))
const byId = new Map(KEYS.map(k => [k.id, k]))

/**
 * Every slug of the keys, each a published story on its key date; near misses that are no judged
 * key's entry are titled NEAR, so the fake model turns them away. Only the judged half counts: a
 * near miss of Lebanon's may be an entry of a tuned key (its Iran-war look-alikes are the Iran key's).
 */
const entrySlugs = new Set(KEYS.filter(k => inDevelopmentHalf(k.id, 'judge')).flatMap(k => k.entries.map(e => e.slug)))
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
  // Entries of either join: a planted early charter's members may be the forecasts the owner's founding rule of 2026-11-23 made optional
  it("name entries of their keys published by the two-thirds checkpoint, and the breach Colorado's near misses", () => {
    for (const p of NARROWED_PLANTS) {
      const k = byId.get(p.key)!
      const day = checkpointsOf(k).find(c => c.at === 'two-thirds')!.day
      for (const slug of p.members)
        expect(
          k.entries.find(e => e.slug === slug && e.date <= day),
          `${p.key}: ${slug}`,
        ).toBeDefined()
      expect(p.members.length).toBeGreaterThanOrEqual(2)
    }
    const colorado = byId.get(ANCHOR_BREACH.key)!
    for (const slug of ANCHOR_BREACH.offered) expect(colorado.nearMisses.some(n => n.slug === slug)).toBe(true)
  })

  it("name the neighbor case's OUT entries and near misses in its key, none an entry of the neighbor's key, and quote only offered stories", () => {
    const lebanon = byId.get(NEIGHBOUR_ABSORB.key)!
    const hormuz = byId.get(NEIGHBOUR_ABSORB.neighbour)!
    for (const out of NEIGHBOUR_ABSORB.notYetOut) expect(lebanon.charter.out, out).toContain(out)
    for (const slug of NEIGHBOUR_ABSORB.offered) {
      expect(lebanon.nearMisses.some(n => n.slug === slug)).toBe(true)
      // An entry of the Hormuz overview would be active there, and production never offers an active story
      expect(
        hormuz.entries.some(e => e.slug === slug),
        slug,
      ).toBe(false)
    }
    for (const plant of [ANCHOR_BREACH, NEIGHBOUR_ABSORB]) expect(plant.offered).toEqual(expect.arrayContaining(Object.keys(plant.quotes)))
  })
})

describe('signalQuote', () => {
  const story = STORIES.get(KEYS[0]!.entries[0]!.slug)!
  it("gives a plant's quote the story's text holds, and otherwise the story's title", () => {
    expect(signalQuote({ slug: 'x', story: { ...story, summary: 'The region teeters toward war.' }, quote: 'region teeters toward war' })).toBe(
      'region teeters toward war',
    )
    expect(signalQuote({ slug: 'x', story, quote: 'words it does not hold' })).toBe(story.title)
    expect(signalQuote({ slug: 'x', story })).toBe(story.title)
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

  it('builds the plants at the two-thirds checkpoint, the breach and the neighbor case on their newest story, and the negatives at the end', async () => {
    const { planned, notRun } = plannedCases(judged, await stories([...STORIES.keys()]), KEYS)
    expect(planned.map(p => `${p.id} ${p.day} ${p.members}/${p.offered}`)).toEqual([
      'planted ebola-drc-2026 2026-10-11 5/10',
      'planted el-nino-2026 2026-09-04 3/10',
      'planted lebanon-war-2026 2026-03-24 3/10',
      'planted pandemic-agreement-pabs 2026-06-18 2/6',
      'planted colorado-river-rules 2026-08-01 2/6',
      'breach colorado-river-rules 2026-08-26 5/4',
      'neighbour lebanon-war-2026 2026-04-17 14/6',
      'negative colorado-river-rules 2026-08-18 5/4',
      'negative ebola-drc-2026 2026-11-16 52/3',
      'negative el-nino-2026 2026-11-07 36/7',
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
    // Every offered story carries one signal quote, as a flagged one does; only the neighbor case has a neighbor
    expect(planned.every(p => p.case.stories.every(s => s.quotes.length === 1))).toBe(true)
    expect(planned.filter(p => p.case.neighbours.length > 0).map(p => p.id)).toEqual(['neighbour lebanon-war-2026'])
  })

  it('gives the neighbor case an earlier charter, the Hormuz overview beside it, and needs that key committed', async () => {
    const loaded = await stories([...STORIES.keys()])
    const lebanon = byId.get('lebanon-war-2026')!
    const hormuz = byId.get('hormuz-shipping-2026')!
    const p = plannedCases(judged, loaded, KEYS).planned.find(x => x.kind === 'neighbour')!
    expect(p.case.charter.out).toEqual(lebanon.charter.out.filter(x => !(NEIGHBOUR_ABSORB.notYetOut as readonly string[]).includes(x)))
    expect(p.case.charter.in).toBe(lebanon.charter.in)
    expect(p.case.neighbours).toEqual([{ overviewId: 'overview:hormuz-shipping-2026', title: hormuz.title, in: hormuz.charter.in }])
    expect(p.nearMisses).toEqual([...NEIGHBOUR_ABSORB.offered])
    expect(plannedCases(judged, loaded).notRun).toContainEqual({
      what: 'neighbour lebanon-war-2026',
      reason: "its neighbor's key hormuz-shipping-2026 is not committed",
    })
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
      members: 5,
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
    // 5 plants, the breach and the neighbor case 3 runs each, 4 negatives 1
    expect(report.runs).toHaveLength(5 * 3 + 3 + 3 + 4)
    expect(ctx.calls).toHaveLength(15 * 3 + 10 * 2)
    expect(report.runs.filter(r => r.kind === 'planted').every(r => r.outcome === 'recentered' && r.draftAnchorHeld && r.endEventVerdict === 'right')).toBe(
      true,
    )
    expect(report.runs.filter(r => r.kind !== 'planted').map(r => `${r.outcome} ${r.rule}`)).toEqual(Array(10).fill('refused joins'))
    expect(report.score).toMatchObject({
      positives: 15,
      recentered: 15,
      negatives: 10,
      falseRecenters: 0,
      nearMissesJoined: 0,
      heldBy: { 'refused (joins)': 10 },
    })
    // Each draft is shown every story's signal; only the neighbor case's check is shown a neighbor, the Hormuz overview
    const drafts = ctx.calls.filter(c => c.schemaName.startsWith('overview-recenter') && !c.schemaName.startsWith('overview-recenter-check'))
    expect(drafts.every(c => c.prompt.split('<STORY id=').length - 1 === c.prompt.split('<SIGNAL>').length - 1)).toBe(true)
    const shown = ctx.calls.filter(c => c.schemaName.startsWith('overview-recenter-check') && c.prompt.includes('<NEIGHBOR id='))
    expect(shown).toHaveLength(3)
    expect(shown[0]!.prompt).toContain('<TITLE>Disruption of shipping through the Strait of Hormuz</TITLE>')
    expect(report.score.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['re-centered where expected', 1, null],
      ['wrong end events (where one is named)', 0, null],
      ['false re-centers', 0, true],
      ['near misses joined', 0, true],
      ['proposals whose own judgments broke the anchor', 0, true],
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
    draftAnchorHeld: true,
    endEventVerdict: 'right',
    why: null,
    costUsd: 0,
    ...over,
  })

  it('counts a false re-center, a near miss joined, a draft that broke the anchor and a wrong end event, and leaves failed calls out', () => {
    const s = scoreRecenters([
      run({ joined: ['a', 'n1'], nearMissesJoined: ['n1'], endEventVerdict: 'wrong' }),
      run({ outcome: 'kept', title: null, endEventVerdict: null, draftAnchorHeld: null }),
      run({ outcome: 'failed', endEventVerdict: null, draftAnchorHeld: null }),
      run({ kind: 'breach', endEventVerdict: null }),
      // Refused by code, but the model's draft broke the anchor all the same
      run({ kind: 'negative', outcome: 'refused', rule: 'anchor', endEventVerdict: null, draftAnchorHeld: false }),
    ])
    expect(s).toMatchObject({
      positives: 2,
      recentered: 1,
      negatives: 2,
      falseRecenters: 1,
      nearMissesJoined: 1,
      proposals: 3,
      anchorBreaks: 1,
      failed: 1,
      heldBy: { 'refused (anchor)': 1 },
    })
    expect(s.bars.map(b => [b.value, b.met])).toEqual([
      [0.5, null],
      [1, null],
      // Shares, at most 10% each: 1 of 2 negatives re-centered, 1 near miss of the 2 stories taken in, 1 of 3 drafts off the anchor
      [0.5, false],
      [0.5, false],
      [1 / 3, false],
    ])
  })

  it('leaves the end-event bar without a verdict while one is unjudged, and every bar without data on no attempt', () => {
    expect(scoreRecenters([run({ endEventVerdict: 'unjudged' })]).bars[1]!.value).toBeNull()
    expect(scoreRecenters([]).bars.every(b => b.value === null)).toBe(true)
  })
})
