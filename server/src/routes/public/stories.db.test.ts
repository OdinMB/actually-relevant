import { it, expect, vi } from 'vitest'
import request from 'supertest'
import type { z } from 'zod'
import prisma from '../../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../../test/db/harness.js'
import { strictSchema } from '../../test/strictSchema.js'

// No model calls: the embedding client is built at import and needs a key, and nothing here searches
vi.mock('../../services/embedding.js', () => ({
  buildEmbeddingContent: vi.fn(),
  computeContentHash: vi.fn(),
  needsEmbeddingUpdate: vi.fn(),
  generateEmbedding: vi.fn(),
  generateSearchEmbedding: vi.fn(),
  generateEmbeddingsBatch: vi.fn(),
  generateEmbeddingForContent: vi.fn(),
  batchGenerateEmbeddings: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))
vi.mock('../../services/llm.js', () => ({ getLLMByTier: vi.fn(), rateLimitDelay: () => Promise.resolve() }))

const { default: app } = await import('../../app.js')
const { publicStorySchema, storyListResponseSchema } = await import('../../lib/openapi.js')

/**
 * Two published stories, one with every public field filled in and one with every field the
 * document allows to be null left null (and no issue), next to one that is not published.
 */
async function seedStories() {
  const issue = await createIssue({ slug: 'planet-climate' })
  const feed = await createFeed(issue.id)
  await prisma.feed.update({ where: { id: feed.id }, data: { displayTitle: 'The Daily Example' } })
  const full = await createStory({
    feedId: feed.id,
    status: 'published',
    issueId: issue.id,
    slug: 'full-story',
    title: 'A full story',
    summary: 'What happened.',
    relevance: 8,
    datePublished: new Date('2026-10-20T08:00:00Z'),
  })
  await prisma.story.update({
    where: { id: full.id },
    data: {
      titleLabel: 'Climate',
      relevancePre: 7,
      emotionTag: 'uplifting',
      quote: 'A quote.',
      quoteAttribution: 'A researcher',
      marketingBlurb: 'A teaser.',
      relevanceReasons: '- A reason',
      relevanceSummary: 'Why it matters.',
      antifactors: '- A caveat',
    },
  })
  await createStory({ feedId: (await createFeed(issue.id)).id, status: 'published', slug: 'sparse-story' })
  await createStory({ feedId: feed.id, status: 'analyzed', slug: 'draft-story' })
}

/** The issues a strict parse finds (an undocumented key, a missing field, a value of the wrong type); none when it matches. */
function strictIssues(schema: z.ZodTypeAny, body: unknown) {
  return strictSchema(schema).safeParse(body).error?.issues ?? []
}

const nullFields = (value: Record<string, unknown>) => Object.keys(value).filter(key => value[key] === null)

describeDb('public story responses against the documented schema (PostgreSQL)', () => {
  useTestDatabase()

  it('serves the story list with exactly the documented fields and types', async () => {
    await seedStories()
    const res = await request(app).get('/api/stories')
    expect(res.status).toBe(200)
    expect(strictIssues(storyListResponseSchema, res.body)).toEqual([])
    expect(res.body.data.map((story: { slug: string }) => story.slug).sort()).toEqual(['full-story', 'sparse-story'])
  })

  it('serves a single story with exactly the documented fields and types, filled in or sparse', async () => {
    await seedStories()
    const full = await request(app).get('/api/stories/full-story')
    const sparse = await request(app).get('/api/stories/sparse-story')
    expect([full.status, sparse.status]).toEqual([200, 200])
    expect(strictIssues(publicStorySchema, full.body)).toEqual([])
    expect(strictIssues(publicStorySchema, sparse.body)).toEqual([])
    // The full story checks each field's documented type against a real value: seed a new field there too
    expect(nullFields(full.body), 'fields the full story serves as null').toEqual([])
    expect(nullFields(full.body.feed), 'feed fields the full story serves as null').toEqual([])
    expect(sparse.body.issue).toBeNull()
  })
})
