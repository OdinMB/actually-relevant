import { it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import prisma from './prisma.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import {
  fetchEmbeddingBackfillBatch,
  fetchStoriesForEmbedding,
  fetchStoryForEmbedding,
  saveEmbedding,
  saveEmbeddingTx,
  saveEmbeddingWithClient,
  searchByEmbedding,
  toVectorLiteral,
} from './vectors.js'

let feedId: string
let issueId: string

/** The stored embedding's axis (the index of its 1), its hash and whether the generated time is set. */
async function embeddingOf(id: string) {
  const [row] = await prisma.$queryRaw<{ axis: number | null; hash: string | null; generated: boolean }[]>`
    SELECT (SELECT i - 1 FROM unnest(embedding::real[]) WITH ORDINALITY AS u(v, i) WHERE v = 1 LIMIT 1)::int AS axis,
           embedding_content_hash AS hash, embedding_generated_at IS NOT NULL AS generated
    FROM stories WHERE id = ${id}`
  return row
}

describeDb('pgvector queries (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(async () => {
    issueId = (await createIssue()).id
    feedId = (await createFeed(issueId)).id
  })

  it('toVectorLiteral writes the pgvector text form', () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe('[0.1,-2,3]')
  })

  it('fetchStoryForEmbedding maps the row to camelCase with its status, and null for an unknown id', async () => {
    const story = await createStory({ feedId, status: 'analyzed', title: 'T', summary: 'S' })
    await prisma.$executeRaw`UPDATE stories SET title_label = 'Label', embedding_content_hash = 'h1' WHERE id = ${story.id}`

    expect(await fetchStoryForEmbedding(story.id)).toEqual({
      id: story.id,
      status: 'analyzed',
      title: 'T',
      titleLabel: 'Label',
      summary: 'S',
      embeddingContentHash: 'h1',
    })
    expect(await fetchStoryForEmbedding('no-such-story')).toBeNull()
  })

  it('fetchStoriesForEmbedding returns the named stories only, and nothing for no ids', async () => {
    const [a, b] = await Promise.all([createStory({ feedId, title: 'A' }), createStory({ feedId, title: 'B' }), createStory({ feedId })])
    const rows = await fetchStoriesForEmbedding([a.id, b.id])
    expect(rows.map(r => r.title).sort()).toEqual(['A', 'B'])
    expect(rows[0]).toHaveProperty('embeddingContentHash', null)
    expect(await fetchStoriesForEmbedding([])).toEqual([])
  })

  it('each save writes the vector, the content hash and the generated time', async () => {
    const [a, b, c] = await Promise.all([createStory({ feedId }), createStory({ feedId }), createStory({ feedId })])

    await saveEmbedding(a.id, axisVector(3), 'ha')
    await prisma.$transaction(tx => saveEmbeddingTx(tx, b.id, axisVector(4), 'hb'))
    await saveEmbeddingWithClient(prisma, c.id, axisVector(5), 'hc')

    expect(await embeddingOf(a.id)).toEqual({ axis: 3, hash: 'ha', generated: true })
    expect(await embeddingOf(b.id)).toEqual({ axis: 4, hash: 'hb', generated: true })
    expect(await embeddingOf(c.id)).toEqual({ axis: 5, hash: 'hc', generated: true })
  })

  it('searchByEmbedding ranks published stories with an embedding by cosine distance, within the limit and filter', async () => {
    const other = await createIssue()
    const otherFeed = await createFeed(other.id)
    const near = await createStory({ feedId, status: 'published', issueId })
    const far = await createStory({ feedId, status: 'published', issueId })
    const unpublished = await createStory({ feedId, status: 'analyzed', issueId })
    const noEmbedding = await createStory({ feedId, status: 'published', issueId })
    const elsewhere = await createStory({ feedId: otherFeed.id, status: 'published', issueId: other.id })
    await setEmbedding(near.id, 1)
    await setEmbedding(far.id, 2)
    await setEmbedding(unpublished.id, 1)
    await setEmbedding(elsewhere.id, 1)
    const query = axisVector(1).map((v, i) => (i === 2 ? 0.5 : v))

    expect((await searchByEmbedding(query)).map(r => r.id)).toEqual(expect.arrayContaining([near.id, far.id, elsewhere.id]))
    expect((await searchByEmbedding(query)).map(r => r.id)).not.toContain(unpublished.id)
    expect((await searchByEmbedding(query)).map(r => r.id)).not.toContain(noEmbedding.id)

    const filtered = await searchByEmbedding(query, { issueFilter: Prisma.sql`AND s.issue_id = ${issueId}` })
    expect(filtered.map(r => r.id)).toEqual([near.id, far.id])
    expect((await searchByEmbedding(query, { limit: 1, issueFilter: Prisma.sql`AND s.issue_id = ${issueId}` })).map(r => r.id)).toEqual([near.id])
  })

  it('fetchEmbeddingBackfillBatch pages published stories by id, skipping hashed ones unless overriding', async () => {
    const stories = await Promise.all(Array.from({ length: 4 }, () => createStory({ feedId, status: 'published' })))
    await createStory({ feedId, status: 'analyzed' })
    const ids = stories.map(s => s.id).sort()
    await prisma.$executeRaw`UPDATE stories SET embedding_content_hash = 'done' WHERE id = ${ids[1]}`

    const first = await fetchEmbeddingBackfillBatch(undefined, 2, false)
    expect(first.map(r => r.id)).toEqual([ids[0], ids[2]])
    const second = await fetchEmbeddingBackfillBatch(first.at(-1)!.id, 2, false)
    expect(second.map(r => r.id)).toEqual([ids[3]])

    expect((await fetchEmbeddingBackfillBatch(undefined, 10, true)).map(r => r.id)).toEqual(ids)
  })
})
