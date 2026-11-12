import { it, expect } from 'vitest'
import type { StoryStatus } from '@prisma/client'
import { createCluster, createFeed, createIssue, createStory, describeDb, monthsAgo, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import prisma from '../lib/prisma.js'
import { researchStoriesByIds } from './researchInput.js'

// The loader's guarantees live in its SQL, so they are tested here against PostgreSQL, never by
// replaying the SQL in a mock: which statuses load, and the earlier-coverage window, whose end is
// the run time for a story not yet published.

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

async function feed() {
  const issue = await createIssue()
  return (await createFeed(issue.id)).id
}

const assessed = { title: 'Assessed title', summary: 'Assessed summary', relevance: 6 }

describeDb('researchStoriesByIds', () => {
  useTestDatabase()

  it('loads analyzed, selected and published stories only, in the order asked for', async () => {
    const feedId = await feed()
    const statuses: StoryStatus[] = ['fetched', 'pre_analyzed', 'analyzed', 'selected', 'published', 'rejected', 'trashed']
    const stories = await Promise.all(
      statuses.map(status => createStory({ feedId, status, ...assessed, datePublished: status === 'published' ? daysAgo(1) : null })),
    )
    const ids = stories.map(s => s.id).reverse()
    const loaded = await researchStoriesByIds(prisma, ids)
    const statusOf = new Map(stories.map((s, i) => [s.id, statuses[i]]))
    expect(loaded.map(s => statusOf.get(s.id))).toEqual(['published', 'selected', 'analyzed'])
  })

  it('leaves out a story whose assessment is missing its title, summary or rating', async () => {
    const feedId = await feed()
    const complete = await createStory({ feedId, status: 'analyzed', ...assessed })
    const noTitle = await createStory({ feedId, status: 'analyzed', ...assessed, title: null })
    const noSummary = await createStory({ feedId, status: 'analyzed', ...assessed, summary: null })
    const noRating = await createStory({ feedId, status: 'analyzed', ...assessed, relevance: null })
    const loaded = await researchStoriesByIds(prisma, [complete.id, noTitle.id, noSummary.id, noRating.id])
    expect(loaded.map(s => s.id)).toEqual([complete.id])
  })

  it('dates a story not yet published at the run time, and a published one at its publication', async () => {
    const feedId = await feed()
    const published = await createStory({ feedId, status: 'published', ...assessed, datePublished: daysAgo(3) })
    const analyzed = await createStory({ feedId, status: 'analyzed', ...assessed })
    const before = Date.now()
    const [p, a] = await researchStoriesByIds(prisma, [published.id, analyzed.id])
    const after = Date.now()
    expect(p?.datePublished).toBe(published.datePublished?.toISOString())
    const loadedAt = Date.parse(a!.datePublished)
    expect(loadedAt).toBeGreaterThanOrEqual(before - 1000)
    expect(loadedAt).toBeLessThanOrEqual(after + 1000)
  })

  it('finds earlier coverage in the 12 months before the run time for a story not yet published', async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'selected', ...assessed })
    const recent = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(2) })
    const old = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(13) })
    const unpublished = await createStory({ feedId, status: 'analyzed', ...assessed })
    for (const s of [story, recent, old, unpublished]) await setEmbedding(s.id, 0)
    const [loaded] = await researchStoriesByIds(prisma, [story.id])
    expect(loaded?.earlier.map(e => e.id)).toEqual([recent.id])
  })

  it("finds earlier coverage in the 12 months before a published story's own date", async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(6) })
    const later = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(2) })
    const before = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(8) })
    const tooOld = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(19) })
    for (const s of [story, later, before, tooOld]) await setEmbedding(s.id, 0)
    const [loaded] = await researchStoriesByIds(prisma, [story.id])
    expect(loaded?.earlier.map(e => e.id)).toEqual([before.id])
  })

  it('leaves out earlier coverage and neighbours from the story’s own cluster, which come as cluster members', async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'analyzed', ...assessed })
    const member = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(1) })
    const neighbour = await createStory({ feedId, status: 'analyzed', ...assessed, dateCrawled: daysAgo(5) })
    const outsideWindow = await createStory({ feedId, status: 'analyzed', ...assessed, dateCrawled: daysAgo(30) })
    await createCluster([story.id, member.id], story.id)
    for (const s of [story, member, neighbour, outsideWindow]) await setEmbedding(s.id, 0)
    const [loaded] = await researchStoriesByIds(prisma, [story.id])
    expect(loaded?.clusterMembers.map(m => m.storyId)).toEqual([member.id])
    expect(loaded?.neighbours.map(n => n.storyId)).toEqual([neighbour.id])
    expect(loaded?.earlier).toEqual([])
  })

  it('loads a story without an embedding, with no neighbours or earlier coverage', async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'analyzed', ...assessed })
    const other = await createStory({ feedId, status: 'published', ...assessed, datePublished: monthsAgo(1) })
    await setEmbedding(other.id, 0)
    const [loaded] = await researchStoriesByIds(prisma, [story.id])
    expect(loaded?.id).toBe(story.id)
    expect(loaded?.neighbours).toEqual([])
    expect(loaded?.earlier).toEqual([])
  })
})
