/**
 * The automated re-center against PostgreSQL (`.context/overviews.md`, "Re-centering"): the link
 * decisions' signals found through the GIN index's containment query and counted from the last attempt,
 * the stories a re-center may take in (flagged or review-detached, never an editor's), its write with a
 * reused row and a new one, its stale path, and Undo putting the charter back and locking automation out.
 */
import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { applyRecenter, undoDecision } from './overviewLifecycle.js'
import type { RecenterResult } from './overviewRecenter.js'
import { recenterCases } from './overviewRecenterInput.js'

const DAY = 86_400_000
const NOW = new Date('2026-11-18T03:00:00Z')
const daysFrom = (days: number) => new Date(NOW.getTime() + days * DAY)
const AT = { clock: NOW, now: NOW }
const charter = { in: 'The fight over the post-2026 Colorado River rules.', out: ['Western drought'], endEvent: 'The final rule is published' }
const wider = { in: 'The Colorado River water shortage and the fight over its rules.', out: ['Western drought', 'Sacramento aquifer'], endEvent: null }

describeDb('the automated re-center records', () => {
  useTestDatabase()

  async function setup() {
    const feed = await createFeed((await createIssue()).id)
    const story = (d: number, title: string) => createStory({ feedId: feed.id, status: 'published', datePublished: daysFrom(d), title })
    const members = await Promise.all([-60, -50, -40].map((d, i) => story(d, `Rules story ${i + 1}`)))
    const o = await prisma.overview.create({
      data: {
        title: 'Colorado River rules',
        charter,
        charterModel: 'founding-model',
        charterPromptVersion: 'fv',
        foundedAt: daysFrom(-60),
        lastEntryAt: daysFrom(-40),
        scope: 'ongoing',
        slug: 'colorado-river-rules',
        recenterTriedAt: daysFrom(-20),
      },
    })
    const entries = []
    for (const s of members)
      entries.push(await prisma.overviewEntry.create({ data: { overviewId: o.id, storyId: s.id, role: 'routine', joinedBy: 'pipeline' } }))
    // The founding made the first two entries
    await prisma.overviewDecision.create({
      data: {
        kind: 'found',
        outcome: 'founded',
        overviewId: o.id,
        actor: 'pipeline',
        inputs: { partnerId: members[1]!.id, created: entries.slice(0, 2).map(e => ({ table: 'entry', id: e.id })) },
      },
    })
    const signal = async (storyId: string, linkedAt: Date, kind: 'wider' | 'center_moved', overviewId = o.id) =>
      prisma.overviewDecision.create({
        data: {
          kind: 'link',
          outcome: 'none',
          storyId,
          actor: 'pipeline',
          inputs: { signals: [{ overviewId, kind, quote: 'water shortage' }], linkedAt: linkedAt.toISOString() },
        },
      })
    return { o, members, entries, story, signal }
  }

  it('fires on signals after the last attempt, offers flagged and review-detached stories, never one an editor detached, and reads the anchor', async () => {
    const { o, entries, story, signal } = await setup()
    const [old, a, b, edited, detached] = await Promise.all([-30, -10, -5, -4, -3].map(d => story(d, `Shortage story ${d}`)))
    // Before the last attempt: weighed again as a story, not counted as a signal
    await signal(old!.id, daysFrom(-30), 'wider')
    await signal(a!.id, daysFrom(-10), 'wider')
    expect(await recenterCases(prisma, AT)).toEqual([])
    await signal(b!.id, daysFrom(-5), 'wider')
    await signal(edited!.id, daysFrom(-4), 'wider')
    await prisma.overviewEntry.create({
      data: { overviewId: o.id, storyId: edited!.id, role: 'routine', joinedBy: 'editor', status: 'detached', detachedBy: 'ed-1', locked: true },
    })
    const reviewRow = await prisma.overviewEntry.create({
      data: {
        overviewId: o.id,
        storyId: detached!.id,
        role: 'routine',
        joinedBy: 'pipeline',
        status: 'detached',
        detachedBy: 'review',
        detachReason: 'review',
      },
    })
    // A signal for another overview, and an undone decision, count for nothing
    await signal(b!.id, daysFrom(-5), 'center_moved', 'other')
    await prisma.overviewDecision.updateMany({ where: { storyId: old!.id }, data: { undoneAt: daysFrom(-1) } })

    const [c] = await recenterCases(prisma, AT)
    // The editor-detached story's flag still counts as a signal; it is only never offered
    expect(c).toMatchObject({ overviewId: o.id, fired: { wider: 3, centerMoved: 0 }, neighbours: [] })
    expect(c!.stories.map(s => [s.storyId, s.entryId, s.quotes])).toEqual([
      [detached!.id, reviewRow.id, []],
      [b!.id, null, ['water shortage']],
      [a!.id, null, ['water shortage']],
    ])
    expect(c!.anchor).toEqual({ founding: [entries[0]!.id, entries[1]!.id], standIns: false, turningPoints: [] })

    // At the limit, or locked by an editor's re-center, it is no case
    await prisma.overview.update({ where: { id: o.id }, data: { automatedRecenters: 2 } })
    expect(await recenterCases(prisma, AT)).toEqual([])
    await prisma.overview.update({ where: { id: o.id }, data: { automatedRecenters: 0, recenteredAt: daysFrom(-1), recenteredBy: 'editor' } })
    expect(await recenterCases(prisma, AT)).toEqual([])
  })

  it('applies a re-center with a reused row and a new one, goes stale when a story was taken meanwhile, and Undo puts it back', async () => {
    const { o, members, entries, story, signal } = await setup()
    const [a, b, detached] = await Promise.all([-10, -5, -3].map(d => story(d, `Shortage story ${d}`)))
    await signal(a!.id, daysFrom(-10), 'wider')
    await signal(b!.id, daysFrom(-5), 'wider')
    const reviewRow = await prisma.overviewEntry.create({
      data: {
        overviewId: o.id,
        storyId: detached!.id,
        role: 'routine',
        joinedBy: 'pipeline',
        status: 'detached',
        detachedBy: 'review',
        detachReason: 'review',
      },
    })
    const [c] = await recenterCases(prisma, AT)
    const result: RecenterResult = {
      outcome: 'recentered',
      rule: null,
      refusals: [],
      title: 'Colorado River water shortage',
      charter: wider,
      outAdded: ['Sacramento aquifer'],
      detaches: [{ entryId: entries[2]!.id, storyId: members[2]!.id }],
      joins: [
        { storyId: detached!.id, entryId: reviewRow.id, datePublished: detached!.datePublished!, role: { role: 'turning_point', roleKind: 'response' } },
        { storyId: b!.id, entryId: null, datePublished: b!.datePublished!, role: { role: 'routine', roleKind: null } },
      ],
      anchor: [],
      kept: 2,
      fired: c!.fired,
      answer: { draft: null, check: null },
      costUsd: 0.14,
      model: 'large-model',
      promptVersion: 'rv',
    }

    // A story to join that an editor attached elsewhere during the calls: stale, nothing applied
    const elsewhere = await prisma.overview.create({ data: { title: 'Other', charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: NOW } })
    const taken = await prisma.overviewEntry.create({ data: { overviewId: elsewhere.id, storyId: b!.id, role: 'routine', joinedBy: 'editor', locked: true } })
    expect(await applyRecenter(c!, result, NOW)).toBe('stale')
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ title: 'Colorado River rules', recenterTriedAt: daysFrom(-20) })
    expect(await prisma.overviewDecision.count({ where: { kind: 'recenter', outcome: 'stale' } })).toBe(1)
    await prisma.overviewEntry.delete({ where: { id: taken.id } })

    expect(await applyRecenter(c!, result, NOW)).toBe('written')
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      title: 'Colorado River water shortage',
      charter: wider,
      charterModel: 'large-model',
      charterPromptVersion: 'rv',
      recenteredBy: 'recenter',
      recenterTriedAt: NOW,
      automatedRecenters: 1,
      slug: 'colorado-river-rules',
    })
    const after = await prisma.overviewEntry.findMany({ where: { overviewId: o.id } })
    expect(after.find(e => e.id === reviewRow.id)).toMatchObject({ status: 'active', role: 'turning_point', roleKind: 'response', locked: false })
    expect(after.find(e => e.storyId === b!.id)).toMatchObject({ status: 'active', joinedBy: 'recenter', model: 'large-model', promptVersion: 'rv' })
    expect(after.find(e => e.id === entries[2]!.id)).toMatchObject({ status: 'detached', detachedBy: 'recenter', detachReason: 'recenter' })

    // Undo: the charter, the title, the count and the entries back; automation locked out by the Undo; the attempt stays marked
    const d = await prisma.overviewDecision.findFirstOrThrow({ where: { kind: 'recenter', outcome: 'recentered' } })
    await undoDecision(d.id, 'ed-1')
    expect(await prisma.overview.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      title: 'Colorado River rules',
      charter,
      charterModel: 'founding-model',
      automatedRecenters: 0,
      recenteredBy: 'undo',
      recenterTriedAt: NOW,
      lockedOut: ['Sacramento aquifer'],
    })
    const undone = await prisma.overviewEntry.findMany({ where: { overviewId: o.id, status: 'active' } })
    expect(undone.map(e => e.id).sort()).toEqual(entries.map(e => e.id).sort())
    expect(await recenterCases(prisma, AT)).toEqual([])
  })
})
