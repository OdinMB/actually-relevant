import { it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import prisma from './prisma.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import { storyInIssueSql, storyInIssueWhere } from './issueFilter.js'
import { searchByEmbedding } from './vectors.js'

const mockSearchEmbedding = vi.hoisted(() => vi.fn())
vi.mock('../services/embedding.js', () => ({
  generateSearchEmbedding: mockSearchEmbedding,
  generateEmbeddingForContent: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))

const { getPublishedStories } = await import('../services/story.js')

/**
 * Issues: parent "climate" with child "oceans", and unrelated "health". Each story records whether
 * it belongs to "climate" under the rule (own issue, else the feed's; the issue or a child of it).
 */
async function seedMatrix() {
  const climate = await createIssue({ slug: 'climate' })
  const oceans = await createIssue({ slug: 'oceans', parentId: climate.id })
  const health = await createIssue({ slug: 'health' })
  const climateFeed = await createFeed(climate.id)
  const oceansFeed = await createFeed(oceans.id)
  const healthFeed = await createFeed(health.id)

  const cases: { name: string; feedId: string; issueId: string | null; inClimate: boolean }[] = [
    { name: 'own issue is climate', feedId: healthFeed.id, issueId: climate.id, inClimate: true },
    { name: 'own issue is a child of climate', feedId: healthFeed.id, issueId: oceans.id, inClimate: true },
    { name: 'no own issue, feed is climate', feedId: climateFeed.id, issueId: null, inClimate: true },
    { name: 'no own issue, feed is a child of climate', feedId: oceansFeed.id, issueId: null, inClimate: true },
    { name: 'own issue health beats a climate feed', feedId: climateFeed.id, issueId: health.id, inClimate: false },
    { name: 'no own issue, feed is health', feedId: healthFeed.id, issueId: null, inClimate: false },
  ]
  const stories = []
  for (const [axis, c] of cases.entries()) {
    const story = await createStory({ feedId: c.feedId, issueId: c.issueId, status: 'published', title: `climate ${c.name}` })
    await setEmbedding(story.id, axis)
    stories.push({ ...c, id: story.id, axis })
  }
  return stories
}

describeDb('issue filter (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => { mockSearchEmbedding.mockReset() })

  it('the Prisma and SQL forms select the same stories, for a parent and for a child slug', async () => {
    const stories = await seedMatrix()

    for (const slug of ['climate', 'oceans', 'health', 'missing']) {
      const viaPrisma = await prisma.story.findMany({ where: storyInIssueWhere(slug), select: { id: true } })
      const viaSql = await prisma.$queryRaw<{ id: string }[]>`SELECT s.id FROM stories s WHERE ${storyInIssueSql(slug)}`
      expect(viaSql.map(r => r.id).sort()).toEqual(viaPrisma.map(r => r.id).sort())
    }

    const climate = await prisma.story.findMany({ where: storyInIssueWhere('climate'), select: { id: true } })
    expect(climate.map(r => r.id).sort()).toEqual(stories.filter(s => s.inClimate).map(s => s.id).sort())
  })

  it('searchByEmbedding orders published stories by cosine distance and applies the issue filter', async () => {
    const stories = await seedMatrix()
    const draft = await createStory({ feedId: stories[0].feedId, status: 'analyzed' })
    await setEmbedding(draft.id, 0)
    await createStory({ feedId: stories[0].feedId, status: 'published' }) // no embedding

    // Nearest to axis 2, then a mix of 1 and 2
    const query = axisVector(2)
    query[1] = 0.5
    const all = await searchByEmbedding(query, { limit: 3 })
    expect(all.map(r => r.id)).toEqual([stories[2].id, stories[1].id, expect.any(String)])
    expect(all.map(r => r.id)).not.toContain(draft.id)

    const inHealth = await searchByEmbedding(query, { issueFilter: Prisma.sql`AND ${storyInIssueSql('health')}` })
    expect(inHealth.map(r => r.id).sort()).toEqual(stories.filter(s => !s.inClimate).map(s => s.id).sort())
  })

  it("hybrid search keeps both legs inside the issue", async () => {
    const stories = await seedMatrix()
    // The semantic leg is nearest to an out-of-issue story; the filter must still drop it
    mockSearchEmbedding.mockResolvedValue(axisVector(stories.find(s => !s.inClimate)!.axis))

    const result = await getPublishedStories({ search: 'climate', issueSlug: 'climate', pageSize: 50 })

    expect(result.data.map(s => s.id).sort()).toEqual(stories.filter(s => s.inClimate).map(s => s.id).sort())
  })
})
