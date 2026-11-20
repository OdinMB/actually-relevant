import { expect, it } from 'vitest'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { editorAction } from './overviewLifecycle.js'
import { adminOverview, adminOverviewList, storyOverview } from './overviewViews.js'

const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }

describeDb('the overview admin reads', () => {
  useTestDatabase()

  async function setUp() {
    const feed = await createFeed((await createIssue()).id)
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map(d => createStory({ feedId: feed.id, status: 'published', datePublished: new Date(Date.UTC(2026, 10, d)), title: `Story ${d}` })),
    )
    const overview = (title: string, over: object = {}) =>
      prisma.overview.create({ data: { title, charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: new Date(Date.UTC(2026, 10, 1)), ...over } })
    const o = await overview('Ebola in Ituri', { scope: 'ongoing', slug: 'ebola-in-ituri', lastEntryAt: new Date(Date.UTC(2026, 10, 2)) })
    const other = await overview('Cholera in Kasai', { frozen: true, lastEntryAt: new Date(Date.UTC(2026, 9, 1)) })
    for (const s of [a!, b!]) await prisma.overviewEntry.create({ data: { overviewId: o.id, storyId: s.id, role: 'routine', joinedBy: 'pipeline' } })
    return { a: a!, b: b!, c: c!, o, other }
  }

  it('lists overviews by filter with their public flag and published entries, the newest last entry first', async () => {
    const { o, other, b } = await setUp()
    await prisma.story.update({ where: { id: b.id }, data: { status: 'rejected' } })
    const all = await adminOverviewList()
    expect(all.map(r => [r.id, r.entries, r.public])).toEqual([
      [o.id, 1, true],
      [other.id, 0, false],
    ])
    expect((await adminOverviewList({ frozen: true })).map(r => r.id)).toEqual([other.id])
  })

  it("gives the detail's entries, stands lines with their facts as they stand now, and the log with what can be undone", async () => {
    const { a, o } = await setUp()
    const source = await prisma.evidenceSource.create({
      data: { storyId: a.id, ref: 'S1', origin: 'search', url: 'https://example.org/a', normalizedUrl: 'example.org/a', outlet: 'Example' },
    })
    const fact = await prisma.poolFact.create({
      data: {
        storyId: a.id,
        sourceId: source.id,
        ref: 'S1F1',
        factKey: 'k1',
        supportingSentence: 'Cases rose to 120.',
        statement: 'Cases rose to 120.',
        extractModel: 'm',
        extractPromptVersion: 'v',
        verdict: 'supported',
        status: 'demoted',
      },
    })
    await prisma.overviewStands.create({
      data: {
        overviewId: o.id,
        number: 1,
        sentences: [{ text: 'Cases rose.', facts: [fact.id, 'gone-id'] }],
        asOf: new Date(Date.UTC(2026, 10, 2)),
        model: 'm',
        promptVersion: 'v',
      },
    })
    await editorAction({ kind: 'retitle', overviewId: o.id, title: 'Ebola' }, 'editor-1')
    await prisma.overviewDecision.create({ data: { kind: 'stands', overviewId: o.id, outcome: 'written', actor: 'pipeline' } })

    const detail = await adminOverview(o.id)
    expect(detail).toMatchObject({ title: 'Ebola', entries: 2, public: true, on: false, charter })
    expect(detail.members.map(m => m.story?.title)).toEqual(['Story 2', 'Story 1'])
    expect(detail.stands[0]!.sentences[0]!.facts).toEqual([
      expect.objectContaining({ id: fact.id, outlet: 'Example', usable: false, gone: false }),
      { id: 'gone-id', gone: true },
    ])
    expect(detail.decisions.map(d => [d.kind, d.undoable])).toEqual([
      ['stands', false],
      ['editor_retitle', true],
    ])
    expect(detail).toMatchObject({ decisionsTotal: 2, statusHistory: [] })
  })

  it('shows the newest decisions up to the log size, the total, and every status move with what it moved', async () => {
    const { o } = await setUp()
    const move = { from: 'open', to: 'quiet', reason: 'quiet', changes: [], created: [] }
    await prisma.overviewDecision.create({ data: { kind: 'status', overviewId: o.id, outcome: 'quiet', inputs: move, actor: 'pipeline' } })
    await prisma.overviewDecision.createMany({
      data: Array.from({ length: config.overviews.logSize + 4 }, () => ({ kind: 'stands' as const, overviewId: o.id, outcome: 'written', actor: 'pipeline' })),
    })
    const detail = await adminOverview(o.id)
    expect(detail.decisions).toHaveLength(config.overviews.logSize)
    expect(detail.decisionsTotal).toBe(config.overviews.logSize + 5)
    expect(detail.statusHistory.map(d => [d.kind, d.move])).toEqual([['status', { from: 'open', to: 'quiet', reason: 'quiet' }]])
  })

  it("gives the re-centering: the anchor from the founding's entries and the turning points, the count, the editor's lock and the charter history", async () => {
    const { a, b, o } = await setUp()
    const [ea, eb] = await Promise.all([a, b].map(s => prisma.overviewEntry.findFirstOrThrow({ where: { storyId: s.id } })))
    await prisma.overviewEntry.update({ where: { id: eb!.id }, data: { role: 'turning_point', roleKind: 'response' } })
    await prisma.overviewDecision.create({
      data: {
        kind: 'found',
        overviewId: o.id,
        outcome: 'founded',
        actor: 'pipeline',
        inputs: {
          partnerId: b.id,
          changes: [],
          created: [
            { table: 'overview', id: o.id },
            { table: 'entry', id: ea!.id },
          ],
        },
      },
    })
    const before = await adminOverview(o.id)
    expect(before.recentering).toMatchObject({
      automated: 0,
      limit: config.overviews.maxAutomatedRecenters,
      recenteredBy: null,
      lockedUntil: null,
      history: [],
    })
    expect(before.recentering.anchor).toEqual({
      standIns: false,
      entries: [
        { entryId: ea!.id, storyId: a.id, title: 'Story 1', founding: true },
        { entryId: eb!.id, storyId: b.id, title: 'Story 2', founding: false },
      ],
    })

    const wider = { in: 'The Ebola outbreak in eastern Congo.', out: [], endEvent: null }
    await editorAction(
      {
        kind: 'recenter',
        overviewId: o.id,
        title: 'Ebola in eastern Congo',
        charter: wider,
        anchorConfirmed: true,
        basedOn: { title: before.title, charter: before.charter },
      },
      'editor-1',
    )
    const after = await adminOverview(o.id)
    expect(after.charter).toEqual(wider)
    const lockDays = (after.recentering.lockedUntil!.getTime() - after.recentering.recenteredAt!.getTime()) / 86_400_000
    expect([after.recentering.recenteredBy, lockDays]).toEqual(['editor', config.overviews.editorRecenterLockDays])
    expect(after.recentering.history).toEqual([
      expect.objectContaining({
        kind: 'editor_recenter',
        actor: 'editor-1',
        undoneAt: null,
        anchorConfirmed: true,
        title: { from: 'Ebola in Ituri', to: 'Ebola in eastern Congo' },
        charter: { from: charter, to: wider },
      }),
    ])
  })

  it("gives a story's block: its overview, its last link's candidates with the answers, and nothing to attach to while it is in one", async () => {
    const { a, c, o, other } = await setUp()
    await prisma.overviewDecision.create({
      data: {
        kind: 'link',
        storyId: c.id,
        outcome: 'none',
        inputs: { shown: { overviews: [{ ref: 'O1', id: o.id, distance: 0.2 }], partners: [{ ref: 'F1', id: a.id, distance: 0.3 }] }, refusals: [] },
        answer: { candidates: [{ id: 'O1', belongs: 'no' }] },
        actor: 'pipeline',
      },
    })
    const alone = await storyOverview(c.id)
    expect(alone.membership).toBeNull()
    expect(alone.lastLink!.candidates).toEqual([
      { ref: 'O1', id: o.id, distance: 0.2, kind: 'overview', title: 'Ebola in Ituri', belongs: 'no' },
      { ref: 'F1', id: a.id, distance: 0.3, kind: 'story', title: 'Story 1', belongs: null },
    ])
    expect(alone.attachable.map(x => x.id)).toEqual([o.id, other.id])
    // A closed overview takes no story until it is reopened, so the picker leaves it out
    await prisma.overview.update({ where: { id: other.id }, data: { status: 'closed', closedReason: 'editor', closedAt: new Date() } })
    expect((await storyOverview(c.id)).attachable.map(x => x.id)).toEqual([o.id])
    const member = await storyOverview(a.id)
    expect(member.membership).toMatchObject({ overview: { id: o.id }, joinedBy: 'pipeline' })
    expect(member.attachable).toEqual([])
  })
})
