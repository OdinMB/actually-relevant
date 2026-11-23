import { expect, it } from 'vitest'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import type { LinkCandidateAnswer } from '../schemas/overviews.js'
import { membershipsOf } from './overviewCandidates.js'
import { candidateOverviews, linkStories } from './overviewInput.js'
import { applyLink, applyStatus } from './overviewLifecycle.js'
import { linkInOrder, linkStory as linkOne, type LinkDeps, type LinkResult } from './overviewLink.js'
import { owedStories } from './overviewQueue.js'
import { nextState } from './overviewStatus.js'
import { overviewStates } from './overviewUpkeepInput.js'
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
  signals: [],
  heldBy: null,
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
      answer: { id: 'O1', belongs: 'yes', ...shared, reportsEndEvent: false, scope: 'inside', centerMoved: false, signalQuote: '', confidence: 0.8 },
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

  it('joins a story: its entry, its link decision, and the overview reopened by the status machine after it', async () => {
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
    // The join moves only what follows the entries; the same run's status machine opens it again
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: faded.id } })).toMatchObject({ status: 'closed', lastEntryAt: s!.datePublished })
    const [state] = (await overviewStates(prisma, s!.datePublished)).filter(x => x.id === faded.id)
    const moves = nextState(state!, s!.datePublished)
    expect(moves).toContainEqual({ kind: 'status', from: 'closed', to: 'open', reason: 'active' })
    await applyStatus(state!, moves, s!.datePublished)
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: faded.id } })).toMatchObject({ status: 'open', closedReason: null, closedAt: null })
    // Its link decision keeps the change set an Undo inverts
    const inputs = entry.decision!.inputs as { changes: { table: string; after: { status?: string } }[]; created: { table: string }[] }
    expect(inputs.changes.find(c => c.table === 'entry')?.after.status).toBe('active')
    expect(inputs.created).toEqual([{ table: 'entry', id: entry.id }])
  })

  it("keeps a join's end-event flag on its link decision as linking settled it, though the row's charter names none by the write", async () => {
    const [s, t] = await stories(2)
    const o = await overviewRow()
    await applyLink(joinResult(s!, o.id), false)
    // An editor's re-center between t's link call and its write: the flag follows the charter the call was shown
    await prisma.overview.update({ where: { id: o.id }, data: { charter: { ...charter, endEvent: null } } })
    const flagged = joinResult(t!, o.id)
    await applyLink({ ...flagged, join: { ...flagged.join!, reportsEndEvent: true } }, false)
    const decisions = await prisma.overviewDecision.findMany({ where: { kind: 'link' } })
    expect(Object.fromEntries(decisions.map(d => [d.storyId, (d.inputs as { reportsEndEvent: boolean }).reportsEndEvent]))).toEqual({
      [s!.id]: false,
      [t!.id]: true,
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
    expect(await applyLink(foundResult(s!, partner!), true, NOW)).toEqual({ kind: 'written', outcome: 'conflict' })
    // A conflict settles nothing: the story is owed again a day later
    expect((await owedStories(daysFrom(1))).retries).toContain(s!.id)
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

  it('a story held by a frozen overview waits with no call until the freeze lifts; a failed one backs off a day', async () => {
    const [s, t] = await stories(2)
    const frozen = await overviewRow({ frozen: true })
    expect(await applyLink(joinResult(s!, frozen.id), false, daysFrom(-1))).toEqual({ kind: 'written', outcome: 'held' })
    await applyLink(result(t!, { outcome: 'failed' }), false, NOW)
    expect(await owedStories(NOW)).toMatchObject({ backlog: [], retries: [], frozenWaiting: 1 })
    await prisma.overview.update({ where: { id: frozen.id }, data: { frozen: false } })
    expect(await owedStories(daysFrom(1))).toMatchObject({ retries: [s!.id, t!.id], frozenWaiting: 0 })
  })

  it('a story whose overview was already frozen when it was linked waits on that freeze, not a retry each night', async () => {
    const feed = await createFeed((await createIssue()).id)
    const text = { title: 'Ebola cases rise in Ituri', summary: 'The Ebola outbreak in Ituri province grew.' }
    const member = await createStory({ feedId: feed.id, status: 'published', datePublished: daysFrom(-3), ...text })
    const s = await createStory({ feedId: feed.id, status: 'published', datePublished: daysFrom(-1), ...text })
    const frozen = await overviewRow({ frozen: true })
    await prisma.overviewEntry.create({ data: { overviewId: frozen.id, storyId: member.id, role: 'routine', joinedBy: 'pipeline' } })
    const yes: LinkCandidateAnswer = {
      id: 'O1',
      belongs: 'yes',
      ...shared,
      end: { story: 'Ebola', other: 'Ebola' },
      reportsEndEvent: false,
      scope: 'inside',
      centerMoved: false,
      signalQuote: '',
      confidence: 0.9,
    }
    const deps: LinkDeps = {
      neighbours: async () => [{ id: member.id, datePublished: member.datePublished!, distance: 0.2, via: 'near' as const }],
      memberships: (ids, asOf) => membershipsOf(prisma, ids, asOf),
      overviews: (ids, asOf) => candidateOverviews(prisma, ids, asOf),
      stories: ids => linkStories(prisma, ids),
      link: async () => ({ parsed: { candidates: [yes], role: 'routine', roleKind: null }, costUsd: 0, model: 'small-model' }),
      found: async () => ({ parsed: null, costUsd: 0, model: 'large-model' }),
      foundCheck: async () => ({ parsed: null, costUsd: 0, model: 'large-model' }),
    }
    const [story] = await linkStories(prisma, [s.id])
    const held = await linkOne(story!, deps)
    expect(held).toMatchObject({ outcome: 'held', heldBy: frozen.id, join: null })
    expect(await applyLink(held, false, daysFrom(-1))).toEqual({ kind: 'written', outcome: 'held' })
    expect(await prisma.overviewDecision.findFirstOrThrow({ where: { storyId: s.id } })).toMatchObject({ kind: 'link', outcome: 'held', overviewId: frozen.id })
    expect(await prisma.overviewEntry.count({ where: { storyId: s.id } })).toBe(0)
    expect(await owedStories(daysFrom(1))).toMatchObject({ retries: [], frozenWaiting: 1 })
    await prisma.overview.update({ where: { id: frozen.id }, data: { frozen: false } })
    expect(await owedStories(daysFrom(1))).toMatchObject({ retries: [s.id], frozenWaiting: 0 })
  })

  it('owes published stories with no settling link decision, the new backlog and the night apart, each oldest first, then the retries due', async () => {
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
    // The held story's overview is gone: it is due again, after the stories new to linking
    expect(got).toEqual({ backlog: [backlogA.id, backlogB.id], retries: [held.id], night: [night.id], backlogTotal: 2, lastTries: [], frozenWaiting: 0 })
    expect(got.backlog).not.toContain(old.id)
    // While older new stories remain owed beyond the slice, the night's stories wait in the backlog, and the retries have no room
    expect(await owedStories(NOW, { ...config.overviews, backfillPerRun: 1 })).toEqual({
      backlog: [backlogA.id],
      retries: [],
      night: [],
      backlogTotal: 2,
      lastTries: [],
      frozenWaiting: 0,
    })
  })

  it('a development spread over the backfill and the night founds one overview, linked strictly oldest first', async () => {
    const feed = await createFeed((await createIssue()).id)
    const text = { title: 'Ebola cases rise in Ituri', summary: 'The outbreak in Ituri province grew; it ends when the ministry declares it over.' }
    const at = (days: number) => createStory({ feedId: feed.id, status: 'published', datePublished: daysFrom(days), ...text })
    const a1 = await at(-25)
    const a2 = await at(-21)
    const o = await at(-6)
    const n = await at(-1 / 12) // the night's
    const draft = {
      title: 'Ebola outbreak in Ituri',
      charter: { in: 'The Ebola outbreak in Ituri province.', out: [], endEvent: 'the ministry declares it over' },
    }
    const quoted = (id: string): LinkCandidateAnswer => ({
      id,
      belongs: 'yes',
      cause: { story: 'Ebola', other: 'Ebola' },
      place: { story: 'Ituri', other: 'Ituri' },
      end: { story: 'declares it over', other: 'declares it over' },
      reportsEndEvent: false,
      scope: 'inside',
      centerMoved: false,
      signalQuote: '',
      confidence: 0.9,
    })
    // Each story's neighbours: every other story of the development (the candidate code keeps only earlier ones); o and n nearest each other
    const all = [a1, a2, o, n]
    const distance = (x: string, y: string) => ([x, y].sort().join() === [o.id, n.id].sort().join() ? 0.1 : 0.3)
    const deps: LinkDeps = {
      neighbours: async s =>
        all.filter(x => x.id !== s.id).map(x => ({ id: x.id, datePublished: x.datePublished!, distance: distance(s.id, x.id), via: 'near' as const })),
      memberships: (ids, asOf) => membershipsOf(prisma, ids, asOf),
      overviews: (ids, asOf) => candidateOverviews(prisma, ids, asOf),
      stories: ids => linkStories(prisma, ids),
      // A yes to the overview when one is shown, else to every partner
      link: async input => ({
        parsed: { candidates: input.overviews.length > 0 ? [quoted('O1')] : input.partners.map(p => quoted(p.ref)), role: 'routine', roleKind: null },
        costUsd: 0,
        model: 'small-model',
      }),
      found: async () => ({ parsed: { ...draft, roles: { a: routine, b: routine } }, costUsd: 0, model: 'large-model' }),
      foundCheck: async () => ({ parsed: { a: fits, b: fits, endEventConcrete: 'yes' }, costUsd: 0, model: 'large-model' }),
    }
    const options = { ...config.overviews, backfillPerRun: 1 }
    for (let run = 0; run < 4; run++) {
      const slices = await owedStories(NOW, options)
      await linkInOrder(await linkStories(prisma, [...slices.backlog, ...slices.retries, ...slices.night]), deps, applyLink, { concurrency: 1 })
    }
    expect(await prisma.overview.count()).toBe(1)
    const entries = await prisma.overviewEntry.findMany({ where: { status: 'active' }, select: { storyId: true } })
    expect(entries.map(e => e.storyId).sort()).toEqual(all.map(s => s.id).sort())
  })
})

const routine = { role: 'routine' as const, roleKind: null }
const fits = { fits: 'yes' as const, reason: 'r', occurred: 'yes' as const }
