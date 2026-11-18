import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createCluster, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { groupCandidates, membershipsOf, nearestPublished } from './overviewCandidates.js'
import { candidateOverviews, linkStories } from './overviewInput.js'
import type { Membership } from './overviewTypes.js'

const DAY = 86_400_000
const AS_OF = new Date('2026-06-01T12:00:00Z')
const daysFrom = (days: number) => new Date(AS_OF.getTime() + days * DAY)

/** An embedding at cosine distance `distance` from the first axis (the story's own is at 0). */
async function embedAt(storyId: string, distance: number): Promise<void> {
  const v = new Array<number>(1536).fill(0)
  v[0] = 1 - distance
  v[1] = Math.sqrt(1 - (1 - distance) ** 2)
  await prisma.$executeRaw`
    INSERT INTO story_embeddings (story_id, embedding, content_hash)
    VALUES (${storyId}, ${`[${v.join(',')}]`}::vector, ${`d-${distance}`})`
}

const OPTIONS = { maxDistance: 0.45, neighbourLimit: 40, memberLookbackDays: 180 }

describeDb('overview candidates', () => {
  useTestDatabase()

  async function published(feedId: string, days: number, distance: number | null) {
    const s = await createStory({ feedId, status: 'published', datePublished: daysFrom(days), title: `Story ${days} ${distance}`, summary: 'Summary.' })
    if (distance !== null) await embedAt(s.id, distance)
    return s
  }

  it('reads published neighbours within the distance and the lookback before the story, never one published after it', async () => {
    const feed = await createFeed((await createIssue()).id)
    const story = await published(feed.id, 0, 0)
    const near = await published(feed.id, -1, 0.2)
    await published(feed.id, -2, 0.6) // past the distance
    await published(feed.id, -181, 0.1) // past the lookback
    await published(feed.id, 1, 0.1) // after the story
    const notPublished = await createStory({ feedId: feed.id, status: 'selected', datePublished: daysFrom(-1) })
    await embedAt(notPublished.id, 0.1)

    const got = await nearestPublished(prisma, story.id, AS_OF, OPTIONS)
    expect(got.map(n => [n.id, n.via])).toEqual([[near.id, 'near']])
    expect(got[0]!.distance).toBeCloseTo(0.2, 5)

    // The lookback counts from asOf: two hundred days later, nothing is near enough in time
    expect(await nearestPublished(prisma, story.id, daysFrom(200), OPTIONS)).toEqual([])
  })

  it("adds the earlier stories the story's research linked and its cluster's members, whatever their distance", async () => {
    const feed = await createFeed((await createIssue()).id)
    const story = await published(feed.id, 0, 0)
    const earlier = await published(feed.id, -300, 0.9)
    const member = await published(feed.id, -1, null)
    await createCluster([story.id, member.id], story.id)
    await prisma.evidenceSource.create({
      data: { storyId: story.id, origin: 'earlier', earlierStoryId: earlier.id, url: '', normalizedUrl: `story:${earlier.id}`, ref: 'E1' },
    })
    const got = await nearestPublished(prisma, story.id, AS_OF, OPTIONS)
    expect(got.map(n => [n.id, n.via])).toEqual([
      [earlier.id, 'linked'],
      [member.id, 'linked'],
    ])
    expect(got[1]!.distance).toBe(2)
  })

  it("falls back on the newest completed legacy run's earlier stories when the pool has none", async () => {
    const feed = await createFeed((await createIssue()).id)
    const story = await published(feed.id, 0, 0)
    const earlier = await published(feed.id, -40, 0.7)
    const older = await published(feed.id, -50, 0.7)
    await prisma.storyResearchRun.create({
      data: { storyId: story.id, status: 'completed', costUsd: 0, result: { earlier: [{ storyId: older.id }] }, startedAt: daysFrom(-3) },
    })
    await prisma.storyResearchRun.create({
      data: { storyId: story.id, status: 'completed', costUsd: 0, result: { earlier: [{ storyId: earlier.id }] }, startedAt: daysFrom(-2) },
    })
    const got = await nearestPublished(prisma, story.id, AS_OF, OPTIONS)
    expect(got.map(n => n.id)).toEqual([earlier.id])
  })

  it('groups the same candidates from memberships read from the tables as from the same map in memory', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await published(feed.id, 0, 0)
    const member = await published(feed.id, -3, 0.1)
    const detachedFrom = await published(feed.id, -4, 0.15)
    const unlinked = await published(feed.id, -5, 0.3)
    const charter = { in: 'In.', out: [], endEvent: 'End.' }
    const a = await prisma.overview.create({
      data: { title: 'A', charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: daysFrom(-10), lastEntryAt: daysFrom(-3) },
    })
    const b = await prisma.overview.create({
      data: { title: 'B', charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: daysFrom(-10), lastEntryAt: daysFrom(-4) },
    })
    await prisma.overviewEntry.create({ data: { overviewId: a.id, storyId: member.id, role: 'routine', joinedBy: 'pipeline' } })
    await prisma.overviewEntry.create({ data: { overviewId: b.id, storyId: detachedFrom.id, role: 'routine', joinedBy: 'pipeline' } })
    await prisma.overviewEntry.create({
      data: { overviewId: b.id, storyId: story.id, role: 'routine', joinedBy: 'pipeline', status: 'detached', detachedBy: 'editor', locked: true },
    })

    const neighbours = await nearestPublished(prisma, story.id, AS_OF, OPTIONS)
    const read = await membershipsOf(prisma, [story.id, ...neighbours.map(n => n.id)])
    const open = (overviewId: string, lastEntryAt: Date): Membership => ({
      overviewId,
      scope: 'forming',
      status: 'open',
      closedReason: null,
      frozen: false,
      lastEntryAt,
    })
    const inMemory = {
      active: new Map([
        [member.id, open(a.id, daysFrom(-3))],
        [detachedFrom.id, open(b.id, daysFrom(-4))],
      ]),
      lockedOut: new Map([[story.id, [b.id]]]),
    }
    expect(read).toEqual(inMemory)
    const options = { ...OPTIONS, foundingWindowDays: 30, candidateOverviews: 5, foundingCandidates: 3 }
    const fromTables = groupCandidates(story as { id: string; datePublished: Date }, neighbours, read, options)
    expect(fromTables).toEqual(groupCandidates(story as { id: string; datePublished: Date }, neighbours, inMemory, options))
    expect(fromTables.overviews.map(o => o.overviewId)).toEqual([a.id])
    expect(fromTables.partners.map(p => p.id)).toEqual([unlinked.id])

    // The link prompt's view of them: the overview with its newest published entries, the stories with their usable facts
    expect(await candidateOverviews(prisma, [a.id], AS_OF)).toEqual([{ id: a.id, title: 'A', charter, entries: [{ title: member.title, date: '2026-05-29' }] }])
    const [linked] = await linkStories(prisma, [unlinked.id])
    expect(linked).toMatchObject({ id: unlinked.id, title: unlinked.title, label: '', summary: 'Summary.', date: '2026-05-27', facts: [] })
  })

  it("bounds an overview's entries and last entry by the story's date, as the development stood that day", async () => {
    const feed = await createFeed((await createIssue()).id)
    const before = await published(feed.id, -5, 0.1)
    const after = await published(feed.id, 3, 0.1)
    const charter = { in: 'In.', out: [], endEvent: 'End.' }
    const a = await prisma.overview.create({
      data: { title: 'A', charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: daysFrom(-5), lastEntryAt: daysFrom(3) },
    })
    for (const s of [before, after]) await prisma.overviewEntry.create({ data: { overviewId: a.id, storyId: s.id, role: 'routine', joinedBy: 'pipeline' } })

    expect((await candidateOverviews(prisma, [a.id], AS_OF))[0]!.entries).toEqual([{ title: before.title, date: '2026-05-27' }])
    expect((await candidateOverviews(prisma, [a.id], daysFrom(4)))[0]!.entries.map(e => e.title)).toEqual([after.title, before.title])
    expect((await membershipsOf(prisma, [before.id], AS_OF)).active.get(before.id)!.lastEntryAt).toEqual(daysFrom(-5))
    // Without a date, the overview's own last entry
    expect((await membershipsOf(prisma, [before.id])).active.get(before.id)!.lastEntryAt).toEqual(daysFrom(3))
  })

  it("counts only published members toward an overview's last entry as of the story's date", async () => {
    const feed = await createFeed((await createIssue()).id)
    const old = await published(feed.id, -200, 0.1)
    const unpublished = await published(feed.id, -2, 0.1)
    const charter = { in: 'In.', out: [], endEvent: 'End.' }
    const a = await prisma.overview.create({
      data: { title: 'A', charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: daysFrom(-200), lastEntryAt: daysFrom(-200) },
    })
    for (const s of [old, unpublished]) await prisma.overviewEntry.create({ data: { overviewId: a.id, storyId: s.id, role: 'routine', joinedBy: 'pipeline' } })
    // Rejected before the job detached it: it must not keep the development alive
    await prisma.story.update({ where: { id: unpublished.id }, data: { status: 'rejected' } })
    expect((await membershipsOf(prisma, [old.id], AS_OF)).active.get(old.id)!.lastEntryAt).toEqual(daysFrom(-200))
  })
})
