import { expect, it } from 'vitest'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { applyLink } from './overviewLifecycle.js'
import type { LinkResult } from './overviewLink.js'
import { owedStories } from './overviewQueue.js'
import type { LinkStory, Shared } from './overviewTypes.js'

const DAY = 86_400_000
const NOW = new Date('2026-06-02T06:00:00Z')
const daysFrom = (days: number) => new Date(NOW.getTime() + days * DAY)
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }
const shared: Shared = { cause: { story: 'Ebola', other: 'Ebola' }, place: { story: 'Ituri', other: 'Ituri' }, end: { story: 'over', other: 'over' } }

const linkStory = (s: { id: string; datePublished: Date | null }, issueId: string | null = null): LinkStory => ({
  id: s.id,
  title: 'Title',
  label: '',
  summary: 'Summary.',
  datePublished: s.datePublished!,
  date: s.datePublished!.toISOString().slice(0, 10),
  issueId,
  facts: [],
})

const result = (story: LinkStory, over: Partial<LinkResult> = {}): LinkResult => ({
  story,
  outcome: 'none',
  role: { role: 'routine', roleKind: null },
  join: null,
  founding: null,
  shown: { overviews: [], partners: [] },
  answer: null,
  proposed: 0,
  refusals: [],
  model: 'small-model',
  promptVersion: 'v1',
  costUsd: 0.001,
  ...over,
})

const overviewRow = (over: Partial<{ status: 'open' | 'quiet' | 'closed'; closedReason: string | null; frozen: boolean }> = {}) =>
  prisma.overview.create({
    data: { title: 'Ebola in Ituri', charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: daysFrom(-20), lastEntryAt: daysFrom(-5), ...over },
  })

const joinResult = (story: LinkStory, overviewId: string): LinkResult =>
  result(story, {
    outcome: 'joined',
    role: { role: 'turning_point', roleKind: 'spread' },
    join: {
      candidate: { id: overviewId, title: 'Ebola in Ituri', charter, entries: [], ref: 'O1', distance: 0.2, frozen: false },
      answer: { id: 'O1', belongs: 'yes', ...shared, reportsEndEvent: false, confidence: 0.8 },
      shared,
      reportsEndEvent: false,
    },
    shown: { overviews: [{ ref: 'O1', id: overviewId, distance: 0.2 }], partners: [] },
  })

const foundResult = (story: LinkStory, partner: LinkStory, shownPartners = [{ ref: 'F1', id: partner.id, distance: 0.2 }]): LinkResult =>
  result(story, {
    outcome: 'founded',
    role: { role: 'routine', roleKind: null },
    founding: {
      partner,
      outcome: 'founded',
      draft: { title: 'Ebola in Ituri', charter, roles: { a: { role: 'turning_point', roleKind: 'spread' }, b: { role: 'routine', roleKind: null } } },
      answers: { draft: null, check: null },
      shared,
      confidence: 0.85,
      costUsd: 0.04,
      model: 'large-model',
    },
    shown: { overviews: [], partners: shownPartners },
  })

describeDb('the overview lifecycle', () => {
  useTestDatabase()

  async function stories(n: number, issueId: string | null = null) {
    const feed = await createFeed((await createIssue()).id)
    return Promise.all(
      Array.from({ length: n }, async (_, i) =>
        linkStory(await createStory({ feedId: feed.id, status: 'published', datePublished: daysFrom(-n + i), issueId }), issueId),
      ),
    )
  }

  it('the indexes refuse a second active entry for a story and a second current stands for an overview', async () => {
    const [s] = await stories(1)
    const a = await overviewRow()
    const b = await overviewRow()
    await prisma.overviewEntry.create({ data: { overviewId: a.id, storyId: s!.id, role: 'routine', joinedBy: 'pipeline' } })
    await expect(prisma.overviewEntry.create({ data: { overviewId: b.id, storyId: s!.id, role: 'routine', joinedBy: 'pipeline' } })).rejects.toThrow()
    // A detached entry is no obstacle
    await prisma.overviewEntry.create({ data: { overviewId: b.id, storyId: s!.id, role: 'routine', joinedBy: 'pipeline', status: 'detached' } })

    const stands = (number: number) => ({ overviewId: a.id, number, sentences: [], asOf: NOW, model: 'm', promptVersion: 'v' })
    await prisma.overviewStands.create({ data: stands(1) })
    await expect(prisma.overviewStands.create({ data: stands(2) })).rejects.toThrow()
    await prisma.overviewStands.create({ data: { ...stands(3), status: 'superseded' } })
  })

  it('a story entry needs its story', async () => {
    const a = await overviewRow()
    await expect(
      prisma.$executeRaw`INSERT INTO overview_entries (id, overview_id, kind, role, joined_by) VALUES ('e1', ${a.id}, 'story', 'routine', 'pipeline')`,
    ).rejects.toThrow()
  })

  it('joins a story: its entry, its link decision, and the overview reopened by the entry', async () => {
    const [s] = await stories(1)
    const faded = await overviewRow({ status: 'closed', closedReason: 'faded' })
    expect(await applyLink(joinResult(s!, faded.id), false)).toEqual({ kind: 'written', outcome: 'joined' })
    const entry = await prisma.overviewEntry.findFirstOrThrow({ where: { storyId: s!.id }, include: { decision: true } })
    expect(entry).toMatchObject({
      overviewId: faded.id,
      status: 'active',
      role: 'turning_point',
      roleKind: 'spread',
      joinedBy: 'pipeline',
      confidence: 0.8,
      shared,
    })
    expect(entry.decision).toMatchObject({ kind: 'link', outcome: 'joined', overviewId: faded.id, actor: 'pipeline', costUsd: 0.001 })
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: faded.id } })).toMatchObject({
      status: 'open',
      closedReason: null,
      lastEntryAt: s!.datePublished,
    })
  })

  it('holds a story bound for an overview frozen since, and writes nothing for one linked meanwhile', async () => {
    const [s, t] = await stories(2)
    const frozen = await overviewRow({ frozen: true })
    expect(await applyLink(joinResult(s!, frozen.id), false)).toEqual({ kind: 'written', outcome: 'held' })
    expect(await prisma.overviewEntry.count()).toBe(0)

    const open = await overviewRow()
    await applyLink(joinResult(t!, open.id), false)
    expect(await applyLink(joinResult(t!, open.id), false)).toEqual({ kind: 'skipped' })
    expect(await prisma.overviewDecision.count({ where: { storyId: t!.id } })).toBe(1)
  })

  it('founds a development from two stories: a forming overview, both entries, its found decision and both link decisions', async () => {
    const issue = await createIssue()
    const [partner, s] = await stories(2, issue.id)
    expect(await applyLink(foundResult(s!, partner!), false)).toEqual({ kind: 'written', outcome: 'founded' })
    const overview = await prisma.overview.findFirstOrThrow({ include: { entries: true, decisions: true } })
    expect(overview).toMatchObject({
      scope: 'forming',
      status: 'open',
      title: 'Ebola in Ituri',
      charter,
      issueId: issue.id,
      foundedAt: partner!.datePublished,
      lastEntryAt: s!.datePublished,
    })
    const roleOf = (id: string) => overview.entries.find(e => e.storyId === id)
    // The earlier story is A
    expect(roleOf(partner!.id)).toMatchObject({ role: 'turning_point', roleKind: 'spread', shared: { cause: { story: 'Ebola', other: 'Ebola' } } })
    expect(roleOf(s!.id)).toMatchObject({ role: 'routine', roleKind: null })
    expect(overview.decisions.map(d => `${d.kind}:${d.outcome}:${d.storyId === s!.id ? 'story' : 'partner'}`).sort()).toEqual([
      'found:founded:story',
      'link:founded:partner',
      'link:founded:story',
    ])
    // Both stories are settled
    expect(await owedStories(NOW)).toMatchObject({ backlog: [], night: [] })
  })

  it('logs a founding attempt that did not agree, and leaves the story alone', async () => {
    const [partner, s] = await stories(2)
    const attempt = foundResult(s!, partner!)
    await applyLink({ ...attempt, outcome: 'none', founding: { ...attempt.founding!, outcome: 'disagreed', draft: null } }, false)
    expect(await prisma.overview.count()).toBe(0)
    const decisions = await prisma.overviewDecision.findMany()
    expect(decisions.map(d => `${d.kind}:${d.outcome}`).sort()).toEqual(['found:disagreed', 'link:none'])
  })

  it('a result whose partner joined since is stale, and a conflict on its last try', async () => {
    const [partner, s] = await stories(2)
    const open = await overviewRow()
    await applyLink(joinResult(partner!, open.id), false)
    expect(await applyLink(foundResult(s!, partner!), false)).toEqual({ kind: 'stale' })
    expect(await prisma.overviewDecision.count({ where: { storyId: s!.id } })).toBe(0)
    expect(await applyLink(foundResult(s!, partner!), true)).toEqual({ kind: 'written', outcome: 'conflict' })
    // A conflict settles nothing: the story is owed at the next run
    const owed = await owedStories(NOW)
    expect([...owed.backlog, ...owed.night]).toContain(s!.id)
  })

  it('logs a write the one-active-entry index refuses as a conflict, rolled back', async () => {
    const [partner, s] = await stories(2)
    const open = await overviewRow()
    await prisma.overviewEntry.create({ data: { overviewId: open.id, storyId: partner!.id, role: 'routine', joinedBy: 'editor' } })
    // The partner's entry came after the stale check could see it (an editor's attach at the same moment)
    expect(await applyLink(foundResult(s!, partner!, []), false)).toEqual({ kind: 'written', outcome: 'conflict' })
    expect(await prisma.overview.count()).toBe(1)
    expect(await prisma.overviewDecision.findMany({ select: { kind: true, outcome: true, storyId: true } })).toEqual([
      { kind: 'link', outcome: 'conflict', storyId: s!.id },
    ])
  })

  it('owes published stories with no settling link decision, the backlog and the night apart, each oldest first', async () => {
    const feed = await createFeed((await createIssue()).id)
    const at = (hours: number, status: 'published' | 'selected' = 'published') =>
      createStory({ feedId: feed.id, status, datePublished: new Date(NOW.getTime() + hours * 3_600_000) })
    const old = await at(-24 * 200)
    const backlogB = await at(-24 * 3)
    const backlogA = await at(-24 * 5)
    const night = await at(-2)
    await at(-1, 'selected')
    const settled = await at(-24 * 4)
    const held = await at(-24 * 6)
    await applyLink(result(linkStory(settled), { outcome: 'none' }), false)
    await applyLink(result(linkStory(held), { outcome: 'held' }), false)

    const got = await owedStories(NOW)
    expect(got).toEqual({ backlog: [held.id, backlogA.id, backlogB.id], night: [night.id], backlogTotal: 3 })
    expect(got.backlog).not.toContain(old.id)
    expect((await owedStories(NOW, { ...config.overviews, backfillPerRun: 1 })).backlog).toEqual([held.id])
  })
})
