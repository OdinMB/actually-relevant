import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { ConflictError } from '../utils/errors.js'
import { membershipsOf } from './overviewCandidates.js'
import { foundResult, joinResult, linkStory } from '../test/db/overviewFixtures.js'
import { applyBurst, applyLink, applyReview, editorAction, undoDecision } from './overviewLifecycle.js'
import { owedStories } from './overviewQueue.js'
import { reviewDue } from './overviewStatus.js'
import { overviewStates, reviewCase } from './overviewUpkeepInput.js'

const DAY = 86_400_000
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }
const EDITOR = 'editor-1'
const routine = { role: 'routine' as const, roleKind: null }

describeDb("an editor's actions and undo", () => {
  useTestDatabase()

  // Stories published in the last days, so they are owed while unlinked
  async function stories(n: number) {
    const feed = await createFeed((await createIssue()).id)
    return Promise.all(
      Array.from({ length: n }, (_, i) =>
        createStory({ feedId: feed.id, status: 'published', datePublished: new Date(Date.now() - (n - i) * DAY), title: `Story ${i}` }),
      ),
    )
  }

  async function overview(
    storyIds: string[],
    over: Partial<{ scope: 'single' | 'forming' | 'ongoing'; status: 'open' | 'closed'; closedReason: string }> = {},
  ) {
    const o = await prisma.overview.create({
      data: {
        title: 'Ebola in Ituri',
        charter,
        charterModel: 'm',
        charterPromptVersion: 'v',
        foundedAt: new Date(Date.now() - 30 * DAY),
        scope: 'forming',
        ...over,
      },
    })
    const entries = []
    for (const storyId of storyIds)
      entries.push(await prisma.overviewEntry.create({ data: { overviewId: o.id, storyId, role: 'routine', joinedBy: 'pipeline' } }))
    return { ...o, entries }
  }

  const row = (id: string) => prisma.overview.findUniqueOrThrow({ where: { id } })
  const entryOf = (storyId: string) => prisma.overviewEntry.findFirstOrThrow({ where: { storyId }, orderBy: { joinedAt: 'desc' } })

  it('attaches a story as locked, and undo and an undo of the undo take it out and put it back', async () => {
    const [a, s] = await stories(2)
    const o = await overview([a!.id], { scope: 'single' })
    const { decisionId } = await editorAction({ kind: 'attach', overviewId: o.id, storyId: s!.id, role: routine }, EDITOR)
    expect(await entryOf(s!.id)).toMatchObject({ status: 'active', locked: true, joinedBy: 'editor', decisionId })
    expect(await row(o.id)).toMatchObject({ scope: 'forming', lastEntryAt: s!.datePublished })
    expect(await prisma.overviewDecision.findUniqueOrThrow({ where: { id: decisionId } })).toMatchObject({
      kind: 'editor_attach',
      outcome: 'attached',
      actor: EDITOR,
    })

    const undo = await undoDecision(decisionId, EDITOR)
    expect(await entryOf(s!.id)).toMatchObject({ status: 'detached', detachReason: 'undone', locked: false })
    expect(await row(o.id)).toMatchObject({ scope: 'single', lastEntryAt: a!.datePublished })
    expect((await prisma.overviewDecision.findUniqueOrThrow({ where: { id: decisionId } })).undoneBy).toBe(EDITOR)

    await undoDecision(undo.decisionId, EDITOR)
    expect(await entryOf(s!.id)).toMatchObject({ status: 'active', locked: true })
    expect((await prisma.overviewDecision.findUniqueOrThrow({ where: { id: decisionId } })).undoneAt).toBeNull()
    await expect(undoDecision(undo.decisionId, EDITOR)).rejects.toThrow('already undone')
  })

  it('refuses to attach a story that is in another overview, and an undo whose rows changed since', async () => {
    const [a, b] = await stories(2)
    const one = await overview([a!.id])
    const other = await overview([b!.id])
    await expect(editorAction({ kind: 'attach', overviewId: other.id, storyId: a!.id, role: routine }, EDITOR)).rejects.toBeInstanceOf(ConflictError)

    const { decisionId } = await editorAction({ kind: 'retitle', overviewId: one.id, title: 'Ebola' }, EDITOR)
    await editorAction({ kind: 'retitle', overviewId: one.id, title: 'Ebola in Congo' }, EDITOR)
    await expect(undoDecision(decisionId, EDITOR)).rejects.toThrow('its title changed after it. Undo the later change first')
    expect((await row(one.id)).title).toBe('Ebola in Congo')
    expect((await prisma.overviewDecision.findUniqueOrThrow({ where: { id: decisionId } })).undoneAt).toBeNull()
  })

  it('detaches an entry as locked, so linking never offers that overview to the story again', async () => {
    const [a, b, c] = await stories(3)
    const o = await overview([a!.id, b!.id, c!.id], { scope: 'ongoing' })
    await editorAction({ kind: 'detach', overviewId: o.id, entryId: o.entries[2]!.id }, EDITOR)
    expect(await entryOf(c!.id)).toMatchObject({ status: 'detached', detachReason: 'editor', detachedBy: EDITOR, locked: true })
    expect((await membershipsOf(prisma, [c!.id])).lockedOut.get(c!.id)).toEqual([o.id])
    // An ongoing overview below 3 stays public until its next review
    expect((await row(o.id)).scope).toBe('ongoing')
  })

  it('sets a role as locked, and closes, reopens and freezes, each undoable', async () => {
    const [a, b] = await stories(2)
    const o = await overview([a!.id, b!.id])
    const role = await editorAction(
      { kind: 'role', overviewId: o.id, entryId: o.entries[0]!.id, role: { role: 'turning_point', roleKind: 'response' } },
      EDITOR,
    )
    expect(await entryOf(a!.id)).toMatchObject({ role: 'turning_point', roleKind: 'response', locked: true })
    await undoDecision(role.decisionId, EDITOR)
    expect(await entryOf(a!.id)).toMatchObject({ role: 'routine', roleKind: null, locked: false })

    await editorAction({ kind: 'close', overviewId: o.id, closed: true }, EDITOR)
    expect(await row(o.id)).toMatchObject({ status: 'closed', closedReason: 'editor' })
    const reopen = await editorAction({ kind: 'close', overviewId: o.id, closed: false }, EDITOR)
    expect(await row(o.id)).toMatchObject({ status: 'open', closedReason: null, closedAt: null })
    // A reopen counts as activity, so the next run does not close it again; undone, it no longer does
    expect((await overviewStates(prisma, new Date()))[0]!.reopenedAt).not.toBeNull()
    await undoDecision(reopen.decisionId, EDITOR)
    expect(await row(o.id)).toMatchObject({ status: 'closed', closedReason: 'editor' })
    expect((await overviewStates(prisma, new Date()))[0]!.reopenedAt).toBeNull()

    await editorAction({ kind: 'hide', overviewId: o.id, hidden: true }, EDITOR)
    expect((await row(o.id)).hidden).toBe(true)
  })

  it('undoes a join: the entry detached and locked, the story owed again; an undo of that undo restores both', async () => {
    const [a, b, s] = await stories(3)
    const o = await overview([a!.id, b!.id], { scope: 'ongoing' })
    await applyLink(joinResult(linkStory(s!), o.id), false)
    const link = await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'link', storyId: s!.id } })
    const owed = async () => {
      const slices = await owedStories(new Date())
      return [...slices.backlog, ...slices.retries, ...slices.night]
    }
    expect(await owed()).not.toContain(s!.id)

    const undo = await undoDecision(link.id, EDITOR)
    expect(await entryOf(s!.id)).toMatchObject({ status: 'detached', detachReason: 'undone', locked: true })
    expect(await owed()).toContain(s!.id)
    expect((await membershipsOf(prisma, [s!.id])).lockedOut.get(s!.id)).toEqual([o.id])

    await undoDecision(undo.decisionId, EDITOR)
    expect(await entryOf(s!.id)).toMatchObject({ status: 'active', detachReason: null, locked: false })
    expect(await owed()).not.toContain(s!.id)
  })

  /** Whether each decision is undone, in the order given. */
  const undone = async (...ids: string[]) => {
    const rows = await prisma.overviewDecision.findMany({ where: { id: { in: ids } }, select: { id: true, undoneAt: true } })
    return ids.map(id => rows.find(r => r.id === id)!.undoneAt !== null)
  }

  it('keeps a join’s chain of undos consistent at depth 3 and 4: each undo’s target is undone exactly while the undo is live', async () => {
    const [a, b, s] = await stories(3)
    const o = await overview([a!.id, b!.id], { scope: 'ongoing' })
    await applyLink(joinResult(linkStory(s!), o.id), false)
    const join = (await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'link', storyId: s!.id } })).id
    const owed = async () => {
      const slices = await owedStories(new Date())
      return [...slices.backlog, ...slices.retries, ...slices.night]
    }
    const u1 = (await undoDecision(join, EDITOR)).decisionId
    const u2 = (await undoDecision(u1, EDITOR)).decisionId
    const u3 = (await undoDecision(u2, EDITOR)).decisionId
    // U3 makes U1 live again, so the join U1 undid is undone again: the story is owed, its entry out and locked
    expect(await undone(join, u1, u2, u3)).toEqual([true, false, true, false])
    expect(await entryOf(s!.id)).toMatchObject({ status: 'detached', detachReason: 'undone', locked: true })
    expect(await owed()).toContain(s!.id)
    await expect(undoDecision(join, EDITOR)).rejects.toThrow('already undone')
    expect((await prisma.overviewDecision.findUniqueOrThrow({ where: { id: join } })).undoneBy).toBe(EDITOR)

    const u4 = (await undoDecision(u3, EDITOR)).decisionId
    expect(await undone(join, u1, u2, u3, u4)).toEqual([false, true, false, true, false])
    expect(await entryOf(s!.id)).toMatchObject({ status: 'active', locked: false })
    expect(await owed()).not.toContain(s!.id)
    // The chain stays undoable from its top: undoing U4 takes the join out again
    await undoDecision(u4, EDITOR)
    expect(await undone(join, u1, u2, u3, u4)).toEqual([true, false, true, false, true])
    expect(await owed()).toContain(s!.id)
  })

  it('undoes a founding by detaching both its entries, leaving the pair settled; an undo is refused once the story is elsewhere', async () => {
    const [a, b] = await stories(2)
    await applyLink(foundResult(linkStory(b!), linkStory(a!)), false)
    const found = await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'found', outcome: 'founded' } })
    const o = { id: found.overviewId! }
    expect((await row(o.id)).scope).toBe('forming')
    await expect(undoDecision((await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'link', storyId: a!.id } })).id, EDITOR)).rejects.toThrow(
      'Undo the founding instead',
    )
    const undo = await undoDecision(found.id, EDITOR)
    expect((await prisma.overviewEntry.findMany({ where: { overviewId: o.id } })).map(e => [e.status, e.locked])).toEqual([
      ['detached', true],
      ['detached', true],
    ])
    expect((await row(o.id)).scope).toBe('single')
    const slices = await owedStories(new Date())
    expect([...slices.backlog, ...slices.retries, ...slices.night]).not.toContain(a!.id)

    // The story joined another overview meanwhile: putting it back would give it two
    const other = await overview([])
    await editorAction({ kind: 'attach', overviewId: other.id, storyId: a!.id, role: routine }, EDITOR)
    await expect(undoDecision(undo.decisionId, EDITOR)).rejects.toThrow('another overview')
  })

  it('undoes a review so that the next night’s review cannot take it back: entries and OUT locked, nothing due', async () => {
    const members = await stories(4)
    const o = await overview(
      members.map(s => s.id),
      { scope: 'ongoing' },
    )
    const narrowed = { ...charter, out: [...charter.out, 'cholera'] }
    // The review detaches the last story and narrows the charter; it keeps 3
    const c = (await reviewCase(prisma, o.id))!
    await applyReview(c, {
      trigger: 'periodic',
      outcome: 'reviewed',
      actions: [
        { kind: 'detach', entryId: o.entries[3]!.id, storyId: members[3]!.id, reason: 'No.' },
        { kind: 'narrow', added: ['cholera'], charter: narrowed },
      ],
      refusals: [],
      kept: 3,
      scope: 'ongoing',
      brake: null,
      answer: null,
      costUsd: 0.2,
      model: 'large',
      promptVersion: 'v',
    })
    const review = await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'review' } })
    expect(await row(o.id)).toMatchObject({ charter: narrowed, entriesAtLastReview: 3 })

    const undo = await undoDecision(review.id, EDITOR)
    expect(await entryOf(members[3]!.id)).toMatchObject({ status: 'active', locked: true, detachReason: null })
    // What the review ran stays run: an ongoing overview counts as reviewed at the entries the undo leaves
    expect(await row(o.id)).toMatchObject({ charter, entriesAtLastReview: 4 })
    const state = (await overviewStates(prisma, new Date()))[0]!
    expect(reviewDue(state, { now: new Date() })).toBeNull()
    expect((await reviewCase(prisma, o.id))!.lockedOut).toEqual(['cholera'])

    // Undone in turn, the lock goes with it; the count is one-way and stays
    const again = await undoDecision(undo.decisionId, EDITOR)
    expect(await row(o.id)).toMatchObject({ charter: narrowed, entriesAtLastReview: 4 })
    expect((await reviewCase(prisma, o.id))!.lockedOut).toEqual([])

    // Depth 3: the first undo is live again, so the review is undone again, and nothing offers its Undo
    const third = await undoDecision(again.decisionId, EDITOR)
    expect(await undone(review.id, undo.decisionId, again.decisionId, third.decisionId)).toEqual([true, false, true, false])
    expect(await entryOf(members[3]!.id)).toMatchObject({ status: 'active', locked: true })
    expect(await row(o.id)).toMatchObject({ charter })
    expect((await reviewCase(prisma, o.id))!.lockedOut).toEqual(['cholera'])
    await expect(undoDecision(review.id, EDITOR)).rejects.toThrow('already undone')

    // Depth 4: the review is live again, as it left the overview
    const fourth = await undoDecision(third.decisionId, EDITOR)
    expect(await undone(review.id, undo.decisionId, again.decisionId, third.decisionId, fourth.decisionId)).toEqual([false, true, false, true, false])
    expect(await entryOf(members[3]!.id)).toMatchObject({ status: 'detached', detachReason: 'review', locked: false })
    expect(await row(o.id)).toMatchObject({ charter: narrowed })
    expect((await reviewCase(prisma, o.id))!.lockedOut).toEqual([])
  })

  it('refuses a review’s undo whole once a later change touched what it changed', async () => {
    const members = await stories(4)
    const o = await overview(
      members.map(s => s.id),
      { scope: 'ongoing' },
    )
    const c = (await reviewCase(prisma, o.id))!
    await applyReview(c, {
      trigger: 'periodic',
      outcome: 'reviewed',
      actions: [
        { kind: 'detach', entryId: o.entries[3]!.id, storyId: members[3]!.id, reason: 'No.' },
        { kind: 'retitle', from: 'Ebola in Ituri', to: 'Ebola in Ituri province' },
      ],
      refusals: [],
      kept: 3,
      scope: 'ongoing',
      brake: null,
      answer: null,
      costUsd: 0.2,
      model: 'large',
      promptVersion: 'v',
    })
    const review = await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'review' } })
    await editorAction({ kind: 'retitle', overviewId: o.id, title: 'Mine' }, EDITOR)
    await expect(undoDecision(review.id, EDITOR)).rejects.toThrow('a review is undone whole or not at all')
    // Nothing of it was undone: the detached entry stays out
    expect(await entryOf(members[3]!.id)).toMatchObject({ status: 'detached', detachReason: 'review' })
    expect((await prisma.overviewDecision.findUniqueOrThrow({ where: { id: review.id } })).undoneAt).toBeNull()
  })

  it("re-centers on an editor's charter with no end event: a review queued until it runs, and Undo lifting it", async () => {
    const members = await stories(4)
    const o = await overview(
      members.map(s => s.id),
      { scope: 'ongoing' },
    )
    await prisma.overview.update({
      where: { id: o.id },
      data: {
        reviewedAt: new Date(Date.now() - DAY),
        entriesAtLastReview: 4,
      },
    })
    const wider = { in: 'The Ebola outbreak in eastern Congo.', out: [], endEvent: null }
    const at = () => ({ now: new Date() })
    const recenter = (basedOn: { title: string; charter: typeof charter }) =>
      editorAction({ kind: 'recenter', overviewId: o.id, title: 'Ebola in eastern Congo', charter: wider, anchorConfirmed: true, basedOn }, EDITOR)
    // A form opened before a review added an OUT entry is refused, and nothing is written
    await expect(recenter({ title: 'Ebola in Ituri', charter: { ...charter, out: [] } })).rejects.toThrow('changed after you opened the form')
    // The charter as the page read it, compared with the jsonb as stored (its own key order)
    const { decisionId } = await recenter({ title: 'Ebola in Ituri', charter })
    expect(await row(o.id)).toMatchObject({
      title: 'Ebola in eastern Congo',
      charter: wider,
      status: 'open',
      recenteredBy: 'editor',
      charterModel: 'm',
      automatedRecenters: 0,
    })
    expect(await prisma.overviewDecision.findUniqueOrThrow({ where: { id: decisionId } })).toMatchObject({
      kind: 'editor_recenter',
      outcome: 'recentered',
      actor: EDITOR,
      inputs: expect.objectContaining({ anchorConfirmed: true }),
    })
    const state = (await overviewStates(prisma, new Date()))[0]!
    expect(reviewDue(state, at())).toBe('recenter')
    // Its review reads the entries under the new charter
    expect((await reviewCase(prisma, o.id))!.charter).toEqual(wider)

    await undoDecision(decisionId, EDITOR)
    expect(await row(o.id)).toMatchObject({
      title: 'Ebola in Ituri',
      charter,
      status: 'open',
      recenteredBy: null,
      recenteredAt: null,
    })
    expect(reviewDue((await overviewStates(prisma, new Date()))[0]!, at())).toBeNull()
  })

  it("clears a burst's freeze by undo without the same joins freezing it again, and an editor's freeze asks for no burst review", async () => {
    const members = await stories(3)
    const o = await overview(members.map(s => s.id))
    const state = (await overviewStates(prisma, new Date()))[0]!
    await applyBurst(state, new Date())
    const freeze = await prisma.overviewDecision.findFirstOrThrow({ where: { overviewId: o.id, kind: 'status', outcome: 'frozen' } })
    await undoDecision(freeze.id, EDITOR)
    const after = (await overviewStates(prisma, new Date()))[0]!
    expect(after).toMatchObject({ frozen: false, burstJoins: 0, burstAt: null })

    await editorAction({ kind: 'freeze', overviewId: o.id, frozen: true }, EDITOR)
    expect((await overviewStates(prisma, new Date()))[0]).toMatchObject({ frozen: true, burstAt: null })
    // The burst's freeze was undone and an editor froze it since: its undo would lift the editor's freeze
    await prisma.overviewDecision.update({ where: { id: freeze.id }, data: { undoneAt: null } })
    await expect(undoDecision(freeze.id, EDITOR)).rejects.toThrow('its freeze changed after it')
  })
})
