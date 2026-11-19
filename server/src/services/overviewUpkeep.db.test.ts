import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import type { CloseResult } from './overviewClose.js'
import { applyAudit, applyBurst, applyClosing, applyReview, applyStands, applyStatus } from './overviewLifecycle.js'
import type { AuditResult, ReviewResult } from './overviewReview.js'
import type { StandsResult } from './overviewStands.js'
import { owedStories } from './overviewQueue.js'
import { nextState } from './overviewStatus.js'
import { auditPicks, overviewStates, pendingClosings, reviewCase, standsCases } from './overviewUpkeepInput.js'

const DAY = 86_400_000
const NOW = new Date('2026-11-18T03:00:00Z')
const daysFrom = (days: number) => new Date(NOW.getTime() + days * DAY)
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }
const auditFailed: AuditResult = {
  outcome: 'failed',
  entries: 0,
  wrongJoins: 0,
  wrongRoles: 0,
  errorRate: null,
  actions: [],
  refusals: [],
  answer: null,
  costUsd: 0.3,
  model: 'large',
  promptVersion: 'v',
}

describeDb('the overview upkeep records', () => {
  useTestDatabase()

  async function stories(days: number[]) {
    const feed = await createFeed((await createIssue()).id)
    return Promise.all(days.map(d => createStory({ feedId: feed.id, status: 'published', datePublished: daysFrom(d), title: `Story ${d}` })))
  }

  async function overview(
    storyIds: string[],
    over: Partial<{
      scope: 'single' | 'forming' | 'ongoing'
      status: 'open' | 'quiet' | 'closing' | 'closed'
      frozen: boolean
      hidden: boolean
      slug: string
      closingSince: Date
      closingStoryId: string
    }> = {},
  ) {
    const o = await prisma.overview.create({
      data: {
        title: 'Ebola in Ituri',
        charter,
        charterModel: 'm',
        charterPromptVersion: 'v',
        foundedAt: daysFrom(-30),
        lastEntryAt: daysFrom(-1),
        scope: 'forming',
        ...over,
      },
    })
    for (const storyId of storyIds) await prisma.overviewEntry.create({ data: { overviewId: o.id, storyId, role: 'routine', joinedBy: 'pipeline' } })
    return o
  }

  const linkDecision = (storyId: string, overviewId: string, reportsEndEvent: boolean) =>
    prisma.overviewDecision.create({ data: { kind: 'link', storyId, overviewId, outcome: 'joined', inputs: { reportsEndEvent }, actor: 'pipeline' } })

  const closeResult = (outcome: CloseResult['outcome']): CloseResult => ({
    outcome,
    answers: { close: null, check: null },
    costUsd: 0.1,
    model: 'large',
    promptVersion: 'v+v',
  })

  it('finds a join flagged as reporting the end event until a check settles it, and begins the closing on agreement', async () => {
    const [a, b, end] = await stories([-10, -5, -2])
    const o = await overview([a!.id, b!.id, end!.id])
    await linkDecision(b!.id, o.id, false)
    await linkDecision(end!.id, o.id, true)

    const [pending, ...rest] = await pendingClosings(prisma)
    expect(rest).toEqual([])
    expect(pending).toMatchObject({ overviewId: o.id, charter, story: { id: end!.id } })
    expect(pending!.entries.map(e => e.title)).toEqual(['Story -5', 'Story -10'])

    await applyClosing(pending!, closeResult('failed'))
    expect(await pendingClosings(prisma)).toHaveLength(1)
    await applyClosing(pending!, closeResult('closing'))
    expect(await pendingClosings(prisma)).toEqual([])
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'closing', closingSince: end!.datePublished })
    const decisions = await prisma.overviewDecision.findMany({ where: { kind: 'close' }, orderBy: { createdAt: 'asc' } })
    expect(decisions.map(d => [d.outcome, d.storyId, d.costUsd])).toEqual([
      ['failed', end!.id, 0.1],
      ['closing', end!.id, 0.1],
    ])
  })

  it('detaches an unpublished member, undoes its link so it is linked afresh, and moves scope and status from the state read', async () => {
    const [a, b] = await stories([-40, -30])
    const o = await overview([a!.id, b!.id], { scope: 'forming' })
    await linkDecision(b!.id, o.id, false)
    await prisma.story.update({ where: { id: b!.id }, data: { status: 'rejected' } })

    const [state] = await overviewStates(prisma, NOW)
    expect(state).toMatchObject({ activeEntries: 1, unpublished: [{ storyId: b!.id }], burstAt: null, closureReviewed: false })
    const moves = nextState({ ...state!, lastEntryAt: a!.datePublished }, NOW)
    expect(moves.map(m => m.kind)).toEqual(['detach', 'scope', 'status'])
    await applyStatus(state!, moves, NOW)

    expect(await prisma.overviewEntry.findFirstOrThrow({ where: { storyId: b!.id } })).toMatchObject({
      status: 'detached',
      detachReason: 'unpublished',
      detachedBy: 'pipeline',
      locked: false,
    })
    expect((await prisma.overviewDecision.findFirstOrThrow({ where: { storyId: b!.id, kind: 'link' } })).undoneAt).not.toBeNull()
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ scope: 'single', status: 'quiet', lastEntryAt: a!.datePublished })
    expect((await prisma.overviewDecision.findMany({ where: { kind: 'status' } })).map(d => d.outcome).sort()).toEqual(['detached', 'quiet', 'single'])

    // A move computed from a state changed since is not applied
    await applyStatus(state!, [{ kind: 'status', from: 'open', to: 'closed', reason: 'faded' }], NOW)
    expect((await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('quiet')

    // Published again, the story is owed a link decision afresh
    await prisma.story.update({ where: { id: b!.id }, data: { status: 'published' } })
    const owed = await owedStories(NOW)
    expect([...owed.backlog, ...owed.night]).toContain(b!.id)
    expect([...owed.backlog, ...owed.night]).not.toContain(a!.id)
  })

  it('counts a burst of stories published within the night, freezes on it, and clears the burst once a review has run', async () => {
    // Entries are joined at the wall clock, so the night is counted back from it
    const feed = await createFeed((await createIssue()).id)
    const published = (hoursAgo: number) => createStory({ feedId: feed.id, status: 'published', datePublished: new Date(Date.now() - hoursAgo * 3_600_000) })
    const members = await Promise.all([published(2), published(3), published(4)])
    // A backfill's join of a story published a week ago never counts toward a burst
    const old = await published(24 * 7)
    const o = await overview([...members, old].map(s => s.id))
    const wall = new Date()
    const [state] = await overviewStates(prisma, wall)
    expect(state!.burstJoins).toBe(3)
    expect((await overviewStates(prisma, new Date(wall.getTime() + 2 * DAY)))[0]!.burstJoins).toBe(0)

    await applyBurst(state!, wall)
    const frozen = (await overviewStates(prisma, wall))[0]!
    expect(frozen.frozen).toBe(true)
    expect(frozen.burstAt).not.toBeNull()

    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ frozenBy: 'burst', frozenAt: wall, joinsCountedFrom: wall })
    const c = (await reviewCase(prisma, o.id))!
    await applyReview(c, review({ trigger: 'burst', scope: 'forming', kept: 4, actions: [{ kind: 'unfreeze' }] }), wall)
    const cleared = (await overviewStates(prisma, wall))[0]!
    expect(cleared.burstAt).toBeNull()
    // The joins the freeze answered never freeze it again at a run less than a day later
    expect(cleared.burstJoins).toBe(0)
  })

  it('cancels a closing when its end-event story is unpublished, frozen or not', async () => {
    const [a, b, end] = await stories([-12, -11, -10])
    const o = await overview([a!.id, b!.id, end!.id], {
      scope: 'ongoing',
      status: 'closing',
      closingSince: end!.datePublished!,
      closingStoryId: end!.id,
      frozen: true,
    })
    expect((await overviewStates(prisma, NOW))[0]!.closingStoryId).toBe(end!.id)
    await prisma.story.update({ where: { id: end!.id }, data: { status: 'rejected' } })

    const [state] = await overviewStates(prisma, NOW)
    const moves = nextState(state!, NOW)
    expect(moves.map(m => m.kind)).toEqual(['detach', 'cancel_closing'])
    await applyStatus(state!, moves, NOW)
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: 'open', closingSince: null, closedAt: null })
    const cancelled = await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'status', outcome: 'open' } })
    expect(cancelled).toMatchObject({ storyId: end!.id, inputs: { from: 'closing', to: 'open', reason: 'closing_cancelled', by: 'unpublished' } })
    // Nothing left to close at the next run
    expect(nextState((await overviewStates(prisma, NOW))[0]!, NOW).filter(m => m.kind === 'status')).toEqual([])
  })

  it("applies a review's actions, makes the overview public with its slug, and leaves an editor's entry alone", async () => {
    const [a, b, c, d] = await stories([-4, -3, -2, -1])
    const o = await overview([a!.id, b!.id, c!.id, d!.id])
    await prisma.overviewEntry.updateMany({ where: { storyId: d!.id }, data: { locked: true } })
    const rc = (await reviewCase(prisma, o.id))!
    expect(rc.entries.map(e => e.storyId)).toEqual([a!.id, b!.id, c!.id, d!.id])
    const [ea, eb, , ed] = rc.entries
    await applyReview(
      rc,
      review({
        actions: [
          { kind: 'detach', entryId: eb!.entryId, storyId: b!.id, reason: 'Cholera.' },
          { kind: 'detach', entryId: ed!.entryId, storyId: d!.id, reason: 'Not this.' },
          { kind: 'relabel', entryId: ea!.entryId, storyId: a!.id, from: ea!.role, to: { role: 'turning_point', roleKind: 'spread' } },
          { kind: 'narrow', added: ['cholera'], charter: { ...charter, out: [...charter.out, 'cholera'] } },
          { kind: 'retitle', from: 'Ebola in Ituri', to: 'Ebola in Ituri province' },
        ],
        kept: 3,
        scope: 'ongoing',
      }),
      NOW,
    )
    const after = await prisma.overview.findUniqueOrThrow({ where: { id: o.id }, include: { entries: true } })
    expect(after).toMatchObject({
      scope: 'ongoing',
      title: 'Ebola in Ituri province',
      slug: 'ebola-in-ituri-province',
      entriesAtLastReview: 3,
      reviewedAt: NOW,
    })
    expect(after.charter).toEqual({ ...charter, out: [...charter.out, 'cholera'] })
    const byStory = new Map(after.entries.map(e => [e.storyId, e]))
    expect(byStory.get(b!.id)).toMatchObject({ status: 'detached', detachedBy: 'review', detachReason: 'review' })
    expect(byStory.get(d!.id)!.status).toBe('active')
    expect(byStory.get(a!.id)).toMatchObject({ role: 'turning_point', roleKind: 'spread' })

    // A second overview with the same title gets the next free slug; the first keeps its slug when retitled again
    const [x, y, z] = await stories([-3, -2, -1])
    const twin = await overview([x!.id, y!.id, z!.id])
    await prisma.overview.update({ where: { id: twin.id }, data: { title: 'Ebola in Ituri province' } })
    await applyReview((await reviewCase(prisma, twin.id))!, review({ scope: 'ongoing', kept: 3 }), NOW)
    expect((await prisma.overview.findUniqueOrThrow({ where: { id: twin.id } })).slug).toBe('ebola-in-ituri-province-2')
    await applyReview((await reviewCase(prisma, o.id))!, review({ scope: 'ongoing', kept: 3, actions: [{ kind: 'retitle', from: 'x', to: 'Ebola' }] }), NOW)
    expect((await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).slug).toBe('ebola-in-ituri-province')
  })

  it('a closure review is recorded for its closing, and one that detaches the end-event story cancels it', async () => {
    const [a, b, end] = await stories([-12, -11, -10])
    const o = await overview([a!.id, b!.id, end!.id], { scope: 'ongoing', status: 'closing', closingSince: end!.datePublished!, closingStoryId: end!.id })
    const c = (await reviewCase(prisma, o.id))!
    expect(c.closingStoryId).toBe(end!.id)

    await applyReview(c, review({ trigger: 'closure', scope: 'ongoing', kept: 3 }), NOW)
    expect((await overviewStates(prisma, NOW))[0]!.closureReviewed).toBe(true)

    const endEntry = c.entries.find(e => e.storyId === end!.id)!
    await applyReview(
      c,
      review({
        trigger: 'closure',
        scope: 'forming',
        kept: 2,
        cancelsClosing: true,
        actions: [{ kind: 'detach', entryId: endEntry.entryId, storyId: end!.id, reason: 'Uganda.' }],
      }),
      NOW,
    )
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      status: 'open',
      closingSince: null,
      closingStoryId: null,
      scope: 'forming',
      lastEntryAt: b!.datePublished,
    })
    expect((await overviewStates(prisma, NOW))[0]!.closureReviewed).toBe(false)
    // The cancellation is its own status record, by the review
    expect(await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'status', outcome: 'open' } })).toMatchObject({
      storyId: end!.id,
      inputs: { reason: 'closing_cancelled', by: 'review' },
    })
  })

  it('applies no detach of a review that asks for more than half the unlocked entries, and freezes the overview for an editor', async () => {
    const members = await stories([-4, -3, -2, -1])
    const o = await overview(
      members.map(s => s.id),
      { scope: 'ongoing', slug: 'braked' },
    )
    const c = (await reviewCase(prisma, o.id))!
    await applyReview(c, review({ scope: 'ongoing', kept: 4, brake: { asked: 3, unlocked: 4 } }), NOW)
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ frozen: true, frozenBy: 'review', frozenAt: NOW })
    expect(await prisma.overviewEntry.count({ where: { overviewId: o.id, status: 'active' } })).toBe(4)
    // No burst review clears it: it waits for an editor
    expect((await overviewStates(prisma, NOW))[0]!.burstAt).toBeNull()
  })

  it('a failed review acts on nothing and leaves the review due', async () => {
    const members = await stories([-3, -2, -1])
    const o = await overview(members.map(s => s.id))
    await applyReview((await reviewCase(prisma, o.id))!, review({ outcome: 'failed', scope: 'ongoing' }), NOW)
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ scope: 'forming', reviewedAt: null, entriesAtLastReview: 0 })
    expect((await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'review' } })).outcome).toBe('failed')
  })

  it('audits public overviews once per period and logs what it found without acting', async () => {
    const members = await stories([-3, -2, -1])
    const o = await overview(
      members.map(s => s.id),
      { scope: 'ongoing', slug: 'audited' },
    )
    await overview([], { scope: 'ongoing', hidden: true, slug: 'hidden' })
    await overview([], { scope: 'forming' })
    // A failed audit counts as recent for a day, not for the month
    const failedAt = new Date()
    await applyAudit((await reviewCase(prisma, o.id))!, { ...auditFailed, costUsd: 0 }, failedAt)
    expect(await auditPicks(prisma, new Date(failedAt.getTime() + 3_600_000))).toEqual([])
    expect(await auditPicks(prisma, new Date(failedAt.getTime() + 25 * 3_600_000))).toEqual([o.id])
    await prisma.overviewDecision.deleteMany({ where: { outcome: 'audit_failed' } })
    // Audits are spaced by the wall clock they are logged at
    const wall = new Date()
    expect(await auditPicks(prisma, wall)).toEqual([o.id])
    const c = (await reviewCase(prisma, o.id))!
    const audit: AuditResult = {
      outcome: 'reviewed',
      entries: 3,
      wrongJoins: 1,
      wrongRoles: 0,
      errorRate: 1 / 3,
      actions: [{ kind: 'detach', entryId: c.entries[0]!.entryId, storyId: members[0]!.id, reason: 'No.' }],
      refusals: [],
      answer: null,
      costUsd: 0.3,
      model: 'large',
      promptVersion: 'v',
    }
    await applyAudit(c, audit)
    expect(await auditPicks(prisma, new Date())).toEqual([])
    expect(await auditPicks(prisma, new Date(wall.getTime() + 31 * DAY))).toEqual([o.id])
    expect((await prisma.overviewEntry.findMany({ where: { overviewId: o.id, status: 'active' } })).length).toBe(3)
  })

  it('keeps one current stands version, and the signature of the last refresh that did not fail', async () => {
    const members = await stories([-3, -2, -1])
    const o = await overview(
      members.map(s => s.id),
      { scope: 'ongoing', slug: 'stands' },
    )
    await overview([], { scope: 'ongoing', frozen: true, slug: 'frozen' })
    const today = '2026-11-18'
    const [c, ...rest] = await standsCases(prisma, today)
    expect(rest).toEqual([])
    expect(c).toMatchObject({ overviewId: o.id, lastSignature: null, members: [], unchanged: false })
    expect(c!.entries.map(e => e.title)).toEqual(['Story -3', 'Story -2', 'Story -1'])
    const record = (signature: string | null, until: string | null = null) => ({ signature, marker: c!.marker, until })

    // Refreshes are a night apart; here a few milliseconds keep their order
    const apart = () => new Promise(resolve => setTimeout(resolve, 5))
    await applyStands(c!, stands('written', 'One.'), record('sig-1'), today)
    await apart()
    await applyStands(c!, stands('written', 'Two.'), record('sig-2'), today)
    await apart()
    await applyStands(c!, stands('none_kept'), record('sig-3', '2026-11-20'), today)
    await apart()
    // Nothing its offer is made of changed, and its day has not come: its facts are not read
    expect((await standsCases(prisma, '2026-11-19'))[0]!.unchanged).toBe(true)
    expect((await standsCases(prisma, '2026-11-20'))[0]!.unchanged).toBe(false)
    // A role changed is a change of what it is made of
    await prisma.overviewEntry.updateMany({ where: { storyId: members[0]!.id }, data: { role: 'turning_point', roleKind: 'spread' } })
    expect((await standsCases(prisma, '2026-11-19'))[0]!.unchanged).toBe(false)
    const versions = await prisma.overviewStands.findMany({ where: { overviewId: o.id }, orderBy: { number: 'asc' } })
    expect(versions.map(v => [v.number, v.status, (v.sentences as { text: string }[])[0]!.text])).toEqual([
      [1, 'superseded', 'One.'],
      [2, 'current', 'Two.'],
    ])
    await applyStands(c!, stands('failed'), { signature: null, marker: null, until: null }, today)
    expect((await standsCases(prisma, today))[0]!.lastSignature).toBe('sig-3')

    await applyStands(c!, stands('too_few_facts'), record('sig-4'), today)
    expect(await prisma.overviewStands.count({ where: { overviewId: o.id, status: 'current' } })).toBe(0)
  })
})

function review(over: Partial<ReviewResult> = {}): ReviewResult {
  return {
    trigger: 'entries',
    outcome: 'reviewed',
    actions: [],
    refusals: [],
    kept: 3,
    scope: 'forming',
    cancelsClosing: false,
    answer: null,
    costUsd: 0.2,
    model: 'large',
    promptVersion: 'v',
    ...over,
  }
}

function stands(outcome: StandsResult['outcome'], text = ''): StandsResult {
  return {
    outcome,
    sentences: text ? [{ text, facts: ['f1'] }] : [],
    doing: [],
    offered: [],
    drops: [],
    checked: 1,
    failed: 0,
    costUsd: 0.02,
    model: 'medium',
    promptVersion: 'v',
  }
}
