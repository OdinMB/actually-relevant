import { isDeepStrictEqual } from 'node:util'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { sampleStory, sampleFeed, sampleIssue } from '../test/helpers.js'
import { assessResultSchema } from '../schemas/llm.js'
import { AI_GENERATED_STORY_FIELDS } from '../lib/aiProvenance.js'

const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  issue: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn((args: any) => (Array.isArray(args) ? Promise.all(args) : args(mockPrisma))),
}))

const mockGetSmallLLM = vi.hoisted(() => vi.fn())
const mockGetMediumLLM = vi.hoisted(() => vi.fn())
const mockGetLargeLLM = vi.hoisted(() => vi.fn())
const mockRateLimitDelay = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGenerateEmbeddingForContent = vi.hoisted(() => vi.fn())
const mockSaveEmbeddingTx = vi.hoisted(() => vi.fn())
const mockDetectAndCluster = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./llm.js', () => ({
  getSmallLLM: mockGetSmallLLM,
  getMediumLLM: mockGetMediumLLM,
  getLargeLLM: mockGetLargeLLM,
  getLLMByTier: vi.fn((tier: string) => {
    switch (tier) {
      case 'small':
        return mockGetSmallLLM()
      case 'medium':
        return mockGetMediumLLM()
      case 'large':
        return mockGetLargeLLM()
    }
  }),
  rateLimitDelay: mockRateLimitDelay,
}))
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerateEmbeddingForContent,
}))
vi.mock('../lib/vectors.js', () => ({
  saveEmbeddingTx: mockSaveEmbeddingTx,
}))
vi.mock('./dedup.js', () => ({
  detectAndCluster: mockDetectAndCluster,
}))
// Status writes go through the lifecycle module, tested on PostgreSQL (storyLifecycle.db.test.ts)
const mockTransition = vi.hoisted(() => vi.fn())
const mockRecordAnalysis = vi.hoisted(() => vi.fn())
vi.mock('./storyLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./storyLifecycle.js')>()),
  transition: mockTransition,
  recordAnalysis: mockRecordAnalysis,
  partition: async (ids: string[]) => ({ eligible: ids, skipped: [], statuses: new Map(ids.map(id => [id, 'fetched'])) }),
}))
/** The rows the last recordAnalysis call wrote. */
const recordedRows = () =>
  mockRecordAnalysis.mock.calls.at(-1)?.[2] as { id: string; data: Record<string, unknown>; where?: Prisma.StoryWhereInput; embedding?: unknown }[]

/** A row's fence while the story had no research snapshot when it was read. */
const NO_SNAPSHOT = { preResearch: { equals: Prisma.AnyNull } }

const { preAssessStories, reclassifyStories, tagEmotionOnly, assessStory, selectStories } = await import('./analysis.js')
const { PUBLIC_STORY_SELECT } = await import('./story.js')

function storyWithRelations(overrides: Record<string, any> = {}) {
  return {
    ...sampleStory(overrides),
    feed: {
      ...sampleFeed(),
      issue: sampleIssue(),
    },
  }
}

describe('preAssessStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls medium LLM with structured output, assigns issues, and updates stories', async () => {
    const issue = sampleIssue()
    const story1 = storyWithRelations({ id: 'story-1' })
    const story2 = storyWithRelations({ id: 'story-2' })
    mockPrisma.story.findMany.mockResolvedValue([story1, story2])
    mockPrisma.story.update.mockResolvedValue({})
    mockPrisma.issue.findMany.mockResolvedValue([issue])

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue({
        articles: [
          { articleId: 'story-1', issueSlug: 'ai-technology', rating: 4, emotionTag: 'calm' },
          { articleId: 'story-2', issueSlug: 'ai-technology', rating: 2, emotionTag: 'calm' },
        ],
      }),
    }
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    const results = await preAssessStories(['story-1', 'story-2'])

    expect(mockGetMediumLLM).toHaveBeenCalled()
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ storyId: 'story-1', rating: 4, emotionTag: 'calm' })
    expect(results[1]).toEqual({ storyId: 'story-2', rating: 2, emotionTag: 'calm' })

    // The status move is the lifecycle module's: these are the fields it writes with it
    expect(mockRecordAnalysis).toHaveBeenCalledWith(
      'preassess',
      'pipeline',
      [
        { id: 'story-1', data: { issueId: issue.id, relevancePre: 4, emotionTag: 'calm' }, where: NO_SNAPSHOT },
        { id: 'story-2', data: { issueId: issue.id, relevancePre: 2, emotionTag: 'calm' }, where: NO_SNAPSHOT },
      ],
      expect.any(Map),
    )
  })

  it("writes a researched story's tag into its snapshot and leaves research's tag in the column, while the snapshot is the one read", async () => {
    const snapshot = { title: 'Single-source headline', emotionTag: 'frustrating' }
    mockPrisma.issue.findMany.mockResolvedValue([sampleIssue()])
    mockPrisma.story.findMany.mockResolvedValue([storyWithRelations({ id: 'story-1', emotionTag: 'uplifting', preResearch: snapshot })])
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({ articles: [{ articleId: 'story-1', issueSlug: 'ai-technology', rating: 6, emotionTag: 'scary' }] }),
      }),
    })

    await preAssessStories(['story-1'])

    expect(recordedRows()).toEqual([
      {
        id: 'story-1',
        data: { issueId: 'issue-1', relevancePre: 6, preResearch: { ...snapshot, emotionTag: 'scary' } },
        where: { preResearch: { equals: snapshot } },
      },
    ])
  })

  it('falls back to feed issueId for invalid slugs', async () => {
    const issues = [sampleIssue({ id: 'issue-1', slug: 'ai-technology', name: 'AI', description: 'AI topics' })]
    mockPrisma.issue.findMany.mockResolvedValue(issues)

    const story = storyWithRelations({ id: 'story-1' })
    mockPrisma.story.findMany.mockResolvedValue([story])
    mockPrisma.story.update.mockResolvedValue({})

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue({
        articles: [{ articleId: 'story-1', issueSlug: 'nonexistent-slug', rating: 5, emotionTag: 'calm' }],
      }),
    }
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    const results = await preAssessStories(['story-1'])

    expect(results).toHaveLength(1)
    // Falls back to feed's issueId
    expect(recordedRows()).toEqual([{ id: 'story-1', data: { issueId: story.feed.issue.id, relevancePre: 5, emotionTag: 'calm' }, where: NO_SNAPSHOT }])
  })
})

describe('reclassifyStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls small LLM and updates only issueId and emotionTag (not rating or status)', async () => {
    const issue = sampleIssue()
    const story = storyWithRelations({ id: 'story-1', relevancePre: 7, status: 'analyzed' })
    mockPrisma.story.findMany.mockResolvedValue([story])
    mockPrisma.story.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.issue.findMany.mockResolvedValue([issue])

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue({
        articles: [{ articleId: 'story-1', issueSlug: 'ai-technology', emotionTag: 'uplifting' }],
      }),
    }
    mockGetSmallLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    const results = await reclassifyStories(['story-1'])

    expect(mockGetSmallLLM).toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ storyId: 'story-1', emotionTag: 'uplifting' })

    // Should update issueId and emotionTag only — no relevancePre, no status
    expect(mockPrisma.story.updateMany).toHaveBeenCalledWith({
      where: { ...NO_SNAPSHOT, id: 'story-1' },
      data: { issueId: issue.id, emotionTag: 'uplifting' },
    })
  })

  it('falls back to feed issueId for invalid slugs', async () => {
    const issues = [sampleIssue({ id: 'issue-1', slug: 'ai-technology', name: 'AI', description: 'AI topics' })]
    mockPrisma.issue.findMany.mockResolvedValue(issues)

    const story = storyWithRelations({ id: 'story-1' })
    mockPrisma.story.findMany.mockResolvedValue([story])
    mockPrisma.story.updateMany.mockResolvedValue({ count: 1 })

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue({
        articles: [{ articleId: 'story-1', issueSlug: 'nonexistent-slug', emotionTag: 'calm' }],
      }),
    }
    mockGetSmallLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    await reclassifyStories(['story-1'])

    expect(mockPrisma.story.updateMany).toHaveBeenCalledWith({
      where: { ...NO_SNAPSHOT, id: 'story-1' },
      data: { issueId: story.feed.issue.id, emotionTag: 'calm' },
    })
  })
})

describe('reclassification and emotion-only tagging', () => {
  const snapshot = { title: 'Single-source headline', emotionTag: 'frustrating' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.issue.findMany.mockResolvedValue([sampleIssue()])
    mockPrisma.story.updateMany.mockResolvedValue({ count: 1 })
    mockGetSmallLLM.mockReturnValue({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({ articles: [{ articleId: 'story-1', issueSlug: 'ai-technology', emotionTag: 'scary' }] }),
      }),
    })
  })

  const runs = [
    ['reclassification', () => reclassifyStories(['story-1']), { issueId: 'issue-1' }],
    ['emotion-only tagging', () => tagEmotionOnly(['story-1']), {}],
  ] as const

  it.each(runs)("%s writes a researched story's tag into its snapshot and leaves research's tag in the column", async (_name, run, fields) => {
    mockPrisma.story.findMany.mockResolvedValue([storyWithRelations({ id: 'story-1', emotionTag: 'uplifting', preResearch: snapshot })])

    await run()

    expect(mockPrisma.story.updateMany).toHaveBeenCalledWith({
      where: { preResearch: { equals: snapshot }, id: 'story-1' },
      data: { ...fields, preResearch: { ...snapshot, emotionTag: 'scary' } },
    })
  })

  it.each(runs)("%s writes a single-source story's tag into its column, while it still has no snapshot", async (_name, run, fields) => {
    mockPrisma.story.findMany.mockResolvedValue([storyWithRelations({ id: 'story-1', emotionTag: 'uplifting', preResearch: null })])

    await run()

    expect(mockPrisma.story.updateMany).toHaveBeenCalledWith({ where: { ...NO_SNAPSHOT, id: 'story-1' }, data: { ...fields, emotionTag: 'scary' } })
  })
})

describe('assessStory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectAndCluster.mockResolvedValue({ clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] })
    mockRecordAnalysis.mockImplementation(async (_stage: string, _actor: string, rows: { id: string }[]) => new Map(rows.map(r => [r.id, 'advanced'])))
  })

  it('generates the embedding from the analysis and hands both to the lifecycle write', async () => {
    const story = storyWithRelations({ id: 'story-1', status: 'pre_analyzed' })
    mockPrisma.story.findUnique.mockResolvedValue(story)
    mockGenerateEmbeddingForContent.mockResolvedValue({ embedding: [0.1, 0.2], hash: 'abc123' })

    const structuredResponse = {
      publicationDate: '2024-01-15 00:00:00',
      quote: '"Test quote" said Expert',
      quoteAttribution: 'Dr. Smith, University of Oxford',
      summary: 'Test summary with key information.',
      factors: ['Factor one: Detailed explanation.', 'Factor two: Detailed explanation.'],
      limitingFactors: ['Limiting factor: Explanation of limitation.'],
      relevanceCalculation: ['Key factor: 5', 'Limitation: -2'],
      conservativeRating: 3,
      relevanceSummary: 'Test relevance summary explaining the rating.',
      titleLabel: 'Test topic',
      relevanceTitle: 'Test title: subtitle here',
      marketingBlurb: 'Publisher reports on test topic with assessment.',
    }

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue(structuredResponse),
    }
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    await assessStory('story-1')

    // Embedding generated from analysis results
    expect(mockGenerateEmbeddingForContent).toHaveBeenCalledWith({
      title: 'Test title: subtitle here',
      titleLabel: 'Test topic',
      summary: 'Test summary with key information.',
      embeddingContentHash: null,
    })

    // One write: the analysis fields and the embedding together
    expect(mockRecordAnalysis).toHaveBeenCalledWith(
      'assess',
      'pipeline',
      [
        {
          id: 'story-1',
          data: expect.objectContaining({ titleLabel: 'Test topic', summary: 'Test summary with key information.' }),
          // Against the research snapshot read too: none here
          where: NO_SNAPSHOT,
          embedding: { embedding: [0.1, 0.2], hash: 'abc123' },
        },
      ],
      expect.any(Map),
    )
    // Written against the status read before the model call
    expect([...mockRecordAnalysis.mock.calls.at(-1)![3]]).toEqual([['story-1', expect.any(String)]])
  })

  it('clears a researched version: the fresh analysis is single-source', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(storyWithRelations({ id: 'story-1', status: 'published' }))
    mockGenerateEmbeddingForContent.mockResolvedValue({ embedding: [0.1], hash: 'h1' })
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          publicationDate: '',
          quote: '',
          quoteAttribution: '',
          summary: 'Summary',
          factors: ['Factor'],
          limitingFactors: [],
          relevanceCalculation: ['calc'],
          conservativeRating: 5,
          relevanceSummary: 'Rel',
          titleLabel: 'Topic',
          relevanceTitle: 'Title',
          marketingBlurb: 'Blurb',
        }),
      }),
    })

    await assessStory('story-1', 'editor')

    expect(recordedRows()[0].data).toMatchObject({ research: Prisma.DbNull, preResearch: Prisma.DbNull })
  })

  describe("a researched story's emotion tag", () => {
    const answer = {
      publicationDate: '',
      quote: '',
      quoteAttribution: '',
      summary: 'Summary',
      factors: ['Factor'],
      limitingFactors: [],
      relevanceCalculation: ['calc'],
      conservativeRating: 5,
      relevanceSummary: 'Rel',
      titleLabel: 'Topic',
      relevanceTitle: 'Title',
      marketingBlurb: 'Blurb',
    }
    const invoke = vi.fn()
    const assessed = async (story: Record<string, unknown>) => {
      mockPrisma.story.findUnique.mockResolvedValue(storyWithRelations({ id: 'story-1', status: 'published', ...story }))
      mockGenerateEmbeddingForContent.mockResolvedValue({ embedding: [0.1], hash: 'h1' })
      invoke.mockResolvedValue(answer)
      mockGetMediumLLM.mockReturnValue({ withStructuredOutput: () => ({ invoke }) })
      await assessStory('story-1', 'editor')
      const [[message]] = invoke.mock.calls.at(-1) as [[{ content: string }]]
      return { data: recordedRows()[0]!.data, prompt: message.content }
    }

    it('gives the fresh single-source analysis the tag its snapshot keeps, in the prompt and in the write', async () => {
      // Research tagged its text uplifting; the single-source analysis was frustrating
      const { data, prompt } = await assessed({ emotionTag: 'uplifting', preResearch: { title: 'Single-source headline', emotionTag: 'frustrating' } })
      expect(data).toMatchObject({ emotionTag: 'frustrating', preResearch: Prisma.DbNull })
      expect(prompt).not.toContain('<TONE>')
    })

    it("keeps the story's own tag without a snapshot, or with one stored before the tag was swapped", async () => {
      for (const preResearch of [null, { title: 'Single-source headline' }]) {
        const { data, prompt } = await assessed({ emotionTag: 'uplifting', preResearch })
        expect(data).not.toHaveProperty('emotionTag')
        expect(prompt).toContain('<TONE>')
      }
    })

    describe('the write is fenced on the snapshot it read', () => {
      // A fake of the lifecycle write's row condition over the one stored row: it writes only while
      // the stored snapshot is still the one the row's `where` names
      const stored = { preResearch: null as unknown }
      const stillMatches = (where: Prisma.StoryWhereInput | undefined) => {
        const fence = (where?.preResearch as { equals?: unknown } | undefined)?.equals
        if (fence === undefined) return true
        return fence === Prisma.AnyNull ? stored.preResearch == null : isDeepStrictEqual(fence, stored.preResearch)
      }
      beforeEach(() => {
        mockRecordAnalysis.mockImplementation(
          async (_stage: string, _actor: string, rows: { id: string; where?: Prisma.StoryWhereInput }[]) =>
            new Map(rows.map(r => [r.id, stillMatches(r.where) ? 'refreshed' : 'skipped'])),
        )
      })

      it("skips when a first apply lands during the model call, so research's version and tag stay", async () => {
        stored.preResearch = null
        mockPrisma.story.findUnique.mockResolvedValue(storyWithRelations({ id: 'story-1', status: 'published', emotionTag: 'frustrating', preResearch: null }))
        mockGenerateEmbeddingForContent.mockResolvedValue({ embedding: [0.1], hash: 'h1' })
        invoke.mockImplementation(async () => {
          stored.preResearch = { title: 'Single-source headline', emotionTag: 'frustrating' }
          return answer
        })
        mockGetMediumLLM.mockReturnValue({ withStructuredOutput: () => ({ invoke }) })

        expect(await assessStory('story-1', 'editor')).toBe('skipped')
        expect(mockDetectAndCluster).not.toHaveBeenCalled()
      })

      it('writes over a researched version whose snapshot is unchanged, and over a single-source story still without one', async () => {
        for (const preResearch of [{ title: 'Single-source headline', emotionTag: 'frustrating' }, null]) {
          stored.preResearch = preResearch
          await assessed({ emotionTag: 'uplifting', preResearch })
          expect(await mockRecordAnalysis.mock.results.at(-1)!.value).toEqual(new Map([['story-1', 'refreshed']]))
        }
      })
    })
  })

  it('throws when story not found', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(null)
    await expect(assessStory('nonexistent')).rejects.toThrow('Story not found')
  })

  it('throws and does not save when embedding generation fails', async () => {
    const story = storyWithRelations({ id: 'story-1' })
    mockPrisma.story.findUnique.mockResolvedValue(story)
    mockGenerateEmbeddingForContent.mockRejectedValue(new Error('OpenAI API error'))

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue({
        publicationDate: '',
        quote: '',
        quoteAttribution: '',
        summary: 'Summary',
        factors: ['Factor'],
        limitingFactors: [],
        relevanceCalculation: ['calc'],
        conservativeRating: 5,
        relevanceSummary: 'Relevance summary',
        titleLabel: 'Topic',
        relevanceTitle: 'Title',
        marketingBlurb: 'Blurb',
      }),
    }
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    await expect(assessStory('story-1')).rejects.toThrow('OpenAI API error')

    expect(mockRecordAnalysis).not.toHaveBeenCalled()
  })

  it('runs dedup after successful assessment', async () => {
    const story = storyWithRelations({ id: 'story-1' })
    mockPrisma.story.findUnique.mockResolvedValue(story)
    mockGenerateEmbeddingForContent.mockResolvedValue({ embedding: [0.1], hash: 'h1' })
    mockDetectAndCluster.mockResolvedValue({ clusterId: 'c1', newCluster: true, memberCount: 2, rejectedIds: [] })

    const mockStructuredLlm = {
      invoke: vi.fn().mockResolvedValue({
        publicationDate: '',
        quote: '',
        quoteAttribution: '',
        summary: 'Summary',
        factors: ['Factor'],
        limitingFactors: [],
        relevanceCalculation: ['calc'],
        conservativeRating: 5,
        relevanceSummary: 'Rel',
        titleLabel: 'Topic',
        relevanceTitle: 'Title',
        marketingBlurb: 'Blurb',
      }),
    }
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => mockStructuredLlm,
    })

    await assessStory('story-1')

    // Wait for fire-and-forget dedup to settle
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mockDetectAndCluster).toHaveBeenCalledWith('story-1')
  })
})

describe('AI-generated field registry', () => {
  const SENTINEL = 'AI-OUTPUT-SENTINEL'

  /** A model response with recognisable text in every field of the live assess schema. */
  function sentinelResponse(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(assessResultSchema.shape).map(([key, field]) => {
        if (field instanceof z.ZodString) return [key, `${SENTINEL} ${key}`]
        if (field instanceof z.ZodArray) return [key, [`${SENTINEL} ${key}`]]
        if (field instanceof z.ZodNumber) return [key, 5]
        throw new Error(`sentinelResponse: add a case for the schema type of "${key}"`)
      }),
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectAndCluster.mockResolvedValue({ clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] })
    mockRecordAnalysis.mockResolvedValue(new Map([['story-1', 'advanced']]))
  })

  it('declares exactly the model-written story fields that the public API serves', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(storyWithRelations({ id: 'story-1' }))
    mockGenerateEmbeddingForContent.mockResolvedValue({ embedding: [0.1], hash: 'h1' })
    mockGetMediumLLM.mockReturnValue({
      withStructuredOutput: () => ({ invoke: vi.fn().mockResolvedValue(sentinelResponse()) }),
    })

    await assessStory('story-1')

    const written = recordedRows()[0].data
    const modelWritten = Object.keys(written).filter(key => typeof written[key] === 'string' && (written[key] as string).includes(SENTINEL))
    const publicFields = new Set(Object.keys(PUBLIC_STORY_SELECT))
    const modelWrittenAndServed = modelWritten.filter(key => publicFields.has(key))

    expect(modelWrittenAndServed.length).toBeGreaterThan(0)
    expect([...modelWrittenAndServed].sort()).toEqual([...AI_GENERATED_STORY_FIELDS].sort())
  })
})

describe('selectStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransition.mockImplementation(async (ids: string[]) => ({ moved: ids, skipped: [] }))
  })

  it('skips every id when none is analyzed, without a model call', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    const result = await selectStories(['nonexistent'])
    expect(result).toEqual({ selected: [], rejected: [], skipped: ['nonexistent'] })
    expect(mockGetLargeLLM).not.toHaveBeenCalled()
  })

  it("shows the model when each candidate's source was published", async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      sampleStory({ id: 'story-1', status: 'analyzed', sourceDatePublished: new Date('2023-05-01T08:00:00Z') }),
      sampleStory({ id: 'story-2', status: 'analyzed', sourceDatePublished: null }),
    ])
    mockPrisma.story.updateMany.mockResolvedValue({ count: 1 })
    const invoke = vi.fn().mockResolvedValue({ selectedIds: ['story-2'] })
    mockGetLargeLLM.mockReturnValue({ withStructuredOutput: () => ({ invoke }) })

    await selectStories(['story-1', 'story-2'])

    const prompt = String(invoke.mock.calls[0][0][0].content)
    const block = (id: string) => prompt.split('<ARTICLE>').find(b => b.includes(`<ID>${id}</ID>`)) ?? ''
    expect(block('story-1')).toContain('<Published>2023-05-01</Published>')
    expect(block('story-2')).toContain('<Published>unknown</Published>')
  })
})
