import { it, expect, vi, beforeEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createFeed, createIssue, createStory, describeDb, setEmbedding, useTestDatabase } from '../test/db/harness.js'

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('./llm.js', () => ({
  getLLMByTier: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  rateLimitDelay: () => Promise.resolve(),
}))
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: vi.fn(),
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))

const { getRelatedStories, updateStoryStatus } = await import('./story.js')

const { displayCount } = config.relatedStories
let seq = 0

/** A published source with `count` published neighbours, nearest first (cosine order). */
async function seed(count: number) {
  const issue = await createIssue()
  const feed = await createFeed(issue.id)
  const slug = `source-${++seq}`
  const source = await createStory({ feedId: feed.id, status: 'published', slug, title: 'Source' })
  await setEmbedding(source.id, 0)
  const neighbours = []
  for (let i = 0; i < count; i++) {
    const s = await createStory({ feedId: feed.id, status: 'published', slug: `${slug}-n${i}`, title: `N${i}` })
    // Mostly along axis 0, less so for later ones: cosine order is creation order
    await prisma.$executeRaw`UPDATE stories SET embedding = (
      SELECT ('[' || string_agg(CASE WHEN g = 1 THEN '1' WHEN g = ${i + 2} THEN ${String(0.1 * (i + 1))} ELSE '0' END, ',') || ']')::vector
      FROM generate_series(1, 1536) g) WHERE id = ${s.id}`
    neighbours.push(s)
  }
  return { slug, source, neighbours }
}

describeDb('related stories (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('returns the nearest published stories without a model call when there are few', async () => {
    const { slug, neighbours } = await seed(displayCount)
    const result = await getRelatedStories(slug)
    expect(result.map(s => s.id)).toEqual(neighbours.map(s => s.id))
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('serves a cached list without stories unpublished since', async () => {
    const { slug, neighbours } = await seed(displayCount)
    await getRelatedStories(slug)

    await prisma.story.update({ where: { id: neighbours[1].id }, data: { status: 'rejected' } })

    const again = await getRelatedStories(slug)
    expect(again.map(s => s.id)).toEqual([neighbours[0].id, neighbours[2].id, neighbours[3].id])
  })

  it('returns nothing once the source is unpublished, however that happened', async () => {
    const a = await seed(2)
    await getRelatedStories(a.slug)
    await updateStoryStatus(a.source.id, 'trashed') // through the service: drops the entry
    expect(await getRelatedStories(a.slug)).toEqual([])

    const b = await seed(2)
    await getRelatedStories(b.slug)
    await prisma.story.update({ where: { id: b.source.id }, data: { status: 'rejected' } }) // behind the service's back
    expect(await getRelatedStories(b.slug)).toEqual([])
  })

  it('coalesces concurrent misses for a story into one model call, and caches the ranking', async () => {
    const { slug, neighbours } = await seed(displayCount + 2)
    const ranked = [neighbours[5], neighbours[0], neighbours[3], neighbours[1]].map(s => s.id)
    let release!: () => void
    mockInvoke.mockImplementation(
      () =>
        new Promise(r => {
          release = () => r({ selectedIds: ranked })
        }),
    )

    const pending = [getRelatedStories(slug), getRelatedStories(slug), getRelatedStories(slug, 2)]
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    release()
    const [first, second, third] = await Promise.all(pending)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(first.map(s => s.id)).toEqual(ranked)
    expect(second.map(s => s.id)).toEqual(ranked)
    expect(third.map(s => s.id)).toEqual(ranked.slice(0, 2))

    expect((await getRelatedStories(slug)).map(s => s.id)).toEqual(ranked)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('returns nothing for an unknown or unpublished slug', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const draft = await createStory({ feedId: feed.id, status: 'analyzed', slug: 'draft-slug' })
    await setEmbedding(draft.id, 0)
    expect(await getRelatedStories('no-such-slug')).toEqual([])
    expect(await getRelatedStories('draft-slug')).toEqual([])
  })
})
