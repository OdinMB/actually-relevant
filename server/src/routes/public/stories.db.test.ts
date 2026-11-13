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
const { publicStoryDetailSchema, storyListResponseSchema } = await import('../../lib/openapi.js')
const { buildResearchedStory } = await import('../../services/researchedStory.js')

/** A researched version citing the original, a search result and two earlier stories of ours. */
function researchedVersion(earlierPublishedId: string, earlierUnpublishedId: string) {
  const fact = (id: string) => ({ id, statement: `Fact ${id}.`, supportingSentence: `Sentence ${id}.`, measures: '', found: true })
  const source = (id: string, origin: 'original' | 'search') => ({
    id,
    origin,
    url: `https://www.outlet-${id.toLowerCase()}.example/a`,
    title: `Headline ${id}`,
    outlet: `Outlet ${id}`,
    date: '2026-10-19',
    favicon: null,
    usedRawContent: false,
    kind: 'news-report' as const,
    country: 'Kenya',
    relation: 'same-development' as const,
    facts: [fact(`${id}F1`)],
    voices: [],
  })
  const earlier = (id: string, storyId: string) => ({
    id,
    storyId,
    slug: 'slug-when-researched',
    title: `Earlier ${id}`,
    date: '2026-03-01',
    relation: 'background' as const,
    facts: [fact(`${id}F1`)],
  })
  const cited = (text: string, factIds: string[]) => ({ text, factIds })
  return buildResearchedStory({
    sources: [source('S0', 'original'), source('S1', 'search')],
    earlier: [earlier('E1', earlierPublishedId), earlier('E2', earlierUnpublishedId)],
    draft: {
      story: [cited('It happened.', ['S0F1', 'S1F1']), cited('Before that.', ['E1F1', 'E2F1'])],
      whyThisMatters: [cited('It matters.', ['S1F1'])],
      caveats: [cited('A caveat.', ['E2F1'])],
      quoteSourceId: 'S1',
    },
  })
}

/**
 * Two published stories, one with every public field filled in (researched, so the detail's
 * research fields are set too) and one with every field the document allows to be null left null
 * (and no issue), next to one that is not published.
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
  const draft = await createStory({ feedId: feed.id, status: 'analyzed', slug: 'draft-story' })
  await prisma.story.update({
    where: { id: full.id },
    data: { research: researchedVersion(full.id, draft.id), preResearch: { summary: 'The single-source summary.', relevanceSummary: 'Why it mattered.' } },
  })
  return { fullId: full.id }
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
    // The researched version is the single story's alone (the strict parse above refuses it too)
    for (const story of res.body.data) {
      expect(story).not.toHaveProperty('research')
      expect(story).not.toHaveProperty('researched')
    }
  })

  it('serves a single story with exactly the documented fields and types, filled in or sparse', async () => {
    await seedStories()
    const full = await request(app).get('/api/stories/full-story')
    const sparse = await request(app).get('/api/stories/sparse-story')
    expect([full.status, sparse.status]).toEqual([200, 200])
    expect(strictIssues(publicStoryDetailSchema, full.body)).toEqual([])
    expect(strictIssues(publicStoryDetailSchema, sparse.body)).toEqual([])
    // The full story checks each field's documented type against a real value: seed a new field there too
    expect(nullFields(full.body), 'fields the full story serves as null').toEqual([])
    expect(nullFields(full.body.feed), 'feed fields the full story serves as null').toEqual([])
    expect(sparse.body.issue).toBeNull()
    expect(sparse.body).toMatchObject({ research: null, researched: false })
  })

  it('serves the researched version without earlier stories that are not published, and the others under their current slug', async () => {
    await seedStories()
    const res = await request(app).get('/api/stories/full-story')
    expect(res.body.researched).toBe(true)
    expect(res.body.research.sources.map((s: { id: string }) => s.id)).toEqual(['S0', 'S1', 'E1'])
    expect(res.body.research.sources[2].slug).toBe('full-story')
    expect(res.body.research.caveats[0].citations).toEqual([])
    expect(res.body.aiGenerated.fields).toContain('research')
  })

  it('serves a stored version that fails its schema as none, still flagged researched', async () => {
    const { fullId } = await seedStories()
    await prisma.story.update({ where: { id: fullId }, data: { research: { paragraphs: 'not a list' } } })
    const res = await request(app).get('/api/stories/full-story')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ research: null, researched: true })
    expect(strictIssues(publicStoryDetailSchema, res.body)).toEqual([])
  })
})
