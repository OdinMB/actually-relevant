import { it, expect, vi, beforeEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { NotFoundError } from '../utils/errors.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'

const mockGenerate = vi.hoisted(() => vi.fn())
const mockEnsureEmbeddings = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerate,
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: mockEnsureEmbeddings,
}))

const { updateStory } = await import('./story.js')

async function story(status: 'analyzed' | 'published', title = 'A title') {
  const issue = await createIssue()
  const feed = await createFeed(issue.id)
  return createStory({ feedId: feed.id, status, title, slug: status === 'published' ? `s-${Date.now()}` : null })
}

const embeddingOf = async (id: string) =>
  (
    await prisma.$queryRaw<{ has: boolean; hash: string | null }[]>`
    SELECT embedding IS NOT NULL AS has, embedding_content_hash AS hash FROM stories WHERE id = ${id}`
  )[0]

describeDb('updateStory (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(3), hash: 'new-hash' })
    mockEnsureEmbeddings.mockReset().mockResolvedValue(undefined)
  })

  it('a publish with no content fields still asks for an embedding and gets a slug and a date', async () => {
    const s = await story('analyzed')

    const updated = await updateStory(s.id, { status: 'published' })

    expect(mockEnsureEmbeddings).toHaveBeenCalledWith([s.id])
    expect(updated.status).toBe('published')
    expect(updated.slug).toBe('a-title')
    expect(updated.datePublished).not.toBeNull()
  })

  it('a publish goes ahead without an embedding when generation fails', async () => {
    const s = await story('analyzed')
    mockEnsureEmbeddings.mockRejectedValue(new Error('openai down'))

    const updated = await updateStory(s.id, { status: 'published' })

    expect(updated.status).toBe('published')
    expect(await embeddingOf(s.id)).toEqual({ has: false, hash: null })
  })

  it('a content edit of a published story fails, unchanged, when generation fails', async () => {
    const s = await story('published')
    mockGenerate.mockRejectedValue(new Error('openai down'))

    await expect(updateStory(s.id, { title: 'New title' })).rejects.toThrow('openai down')
    expect((await prisma.story.findUniqueOrThrow({ where: { id: s.id } })).title).toBe('A title')
  })

  it('a content edit of a published story regenerates from the merged content', async () => {
    const s = await story('published')

    await updateStory(s.id, { summary: 'New summary' })

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ title: 'A title', summary: 'New summary' }))
    expect(await embeddingOf(s.id)).toEqual({ has: true, hash: 'new-hash' })
  })

  it('an edit of an unpublished story makes no embedding call', async () => {
    const s = await story('analyzed')
    await updateStory(s.id, { title: 'Draft edit', sourceDatePublished: '2026-01-02T00:00:00.000Z' })
    expect(mockGenerate).not.toHaveBeenCalled()
    const row = await prisma.story.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.sourceDatePublished?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
  })

  it('an unknown story fails as not found', async () => {
    await expect(updateStory('00000000-0000-0000-0000-000000000000', { status: 'published' })).rejects.toBeInstanceOf(NotFoundError)
  })
})
