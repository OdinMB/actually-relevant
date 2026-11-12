/**
 * Applying a research run to its story and reverting it, on PostgreSQL: the swapped columns, both
 * versions, the snapshot rules, the status fence and what the public story serves afterwards. The
 * embedding call and the favicon fetch are mocked; every refusal's order is researchApply.test.ts's.
 */
import { randomUUID } from 'node:crypto'
import { it, expect, vi, beforeEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, embeddingHash, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import type { StoredResearch } from './researchRuns.js'
import type { ResearchSource } from './researchPipeline.js'

const mockGenerate = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerate,
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))
const mockFavicons = vi.hoisted(() => vi.fn())
vi.mock('./sourceFavicons.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./sourceFavicons.js')>()),
  fetchSourceFaviconsInBackground: mockFavicons,
}))
const mockForget = vi.hoisted(() => vi.fn())
vi.mock('./relatedStories.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./relatedStories.js')>()),
  forgetRelatedStories: mockForget,
}))

const { applyResearchRun, revertResearch } = await import('./researchApply.js')
const { getPublishedStoryBySlug, updateStoryStatus } = await import('./story.js')

const SINGLE_SOURCE = {
  title: 'Single-source headline',
  titleLabel: 'Single label',
  summary: 'Single-source summary.',
  quote: 'Single quote',
  quoteAttribution: 'Original article',
  marketingBlurb: 'Outlet reports a development.',
  relevanceReasons: '- **Reason:** single',
  relevanceSummary: 'Why it matters, from one source.',
  antifactors: '- **Limit:** single',
  relevance: 6,
  relevanceCalculation: '- **Scale:** 6',
}

function source(id: string, origin: ResearchSource['origin'] = 'search'): ResearchSource {
  return {
    id,
    origin,
    url: `https://outlet-${id.toLowerCase()}.example/a`,
    title: `Headline ${id}`,
    outlet: `Outlet ${id}`,
    date: '2026-11-10',
    favicon: null,
    usedRawContent: false,
    kind: 'news-report',
    country: 'Kenya',
    relation: 'same-development',
    facts: [{ id: `${id}F1`, statement: `Fact of ${id}.`, supportingSentence: `Sentence of ${id}.`, measures: '', found: true }],
    voices: [],
  }
}

function result(storyId: string, n: number, over: Partial<StoredResearch> = {}): StoredResearch {
  return {
    storyId,
    calls: [],
    credits: 2,
    searches: [],
    candidates: 2,
    drops: {},
    sources: [source('S0', 'original'), source('S1')],
    earlier: [],
    draft: {
      titleLabel: `Researched label ${n}`,
      title: `Researched headline ${n}`,
      story: [{ sentences: [{ text: `Researched sentence ${n}.`, factIds: ['S0F1', 'S1F1'] }] }],
      summary: `Researched summary ${n}.`,
      whyThisMatters: [{ text: 'It matters.', factIds: ['S1F1'] }],
      caveats: [{ text: 'A caveat.', factIds: [] }],
      quote: 'Researched quote',
      quoteAttribution: 'A minister',
      quoteSourceId: 'S1',
      marketingBlurb: `Researched blurb ${n}.`,
      relevanceCalculation: ['- **Scale:** 5'],
      rating: 5,
      oldNews: { isOld: false, firstHappened: 'unknown' },
      contradicted: { isContradicted: false, factIds: [] },
    },
    rewritten: false,
    problems: [],
    support: { facts: 2, found: 2 },
    optOutChecked: true,
    verdict: { kind: 'keep' },
    models: {} as StoredResearch['models'],
    prices: { models: {}, cacheWriteFactor: 1.25, tavilyUsdPerCredit: 0.008 },
    ...over,
  }
}

let feedId = ''

async function story(status: 'analyzed' | 'selected' | 'published' | 'rejected' | 'trashed' = 'published') {
  const s = await createStory({
    feedId,
    status,
    slug: status === 'published' ? `story-${randomUUID()}` : null,
    datePublished: status === 'published' ? new Date() : null,
  })
  await prisma.story.update({ where: { id: s.id }, data: SINGLE_SOURCE })
  return s
}

async function run(storyId: string, n = 1, over: { status?: 'running' | 'completed' | 'failed'; result?: StoredResearch | null } = {}) {
  const r = over.result === undefined ? result(storyId, n) : over.result
  const row = await prisma.storyResearchRun.create({
    data: {
      storyId,
      status: over.status ?? 'completed',
      verdict: r?.verdict.kind ?? null,
      costUsd: 0.03,
      result: (r ?? undefined) as unknown as Prisma.InputJsonObject | undefined,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })
  return row.id
}

const stored = (id: string) => prisma.story.findUniqueOrThrow({ where: { id } })

describeDb('applying and reverting research (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    // Research switched on: an apply refuses while it is off
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(7), hash: 'researched' })
    mockFavicons.mockReset().mockResolvedValue(undefined)
    mockForget.mockReset()
    feedId = (await createFeed((await createIssue()).id)).id
  })

  it('writes the researched texts, the cited version and the snapshot; the relevance summary is null after it and kept in the snapshot', async () => {
    const s = await story()
    await setEmbedding(s.id, 1)

    expect(await applyResearchRun(s.id, await run(s.id))).toBe('applied')

    const after = await stored(s.id)
    expect(after).toMatchObject({
      status: 'published',
      title: 'Researched headline 1',
      summary: 'Researched summary 1.',
      marketingBlurb: 'Researched blurb 1.',
      relevanceReasons: '- It matters.',
      relevanceSummary: null,
      relevance: 5,
    })
    expect(after.preResearch).toEqual(SINGLE_SOURCE)
    expect(after.research).toMatchObject({ paragraphs: [{ sentences: [{ text: 'Researched sentence 1.' }] }], quoteSourceId: 'S1' })
    expect(await embeddingHash(s.id)).toBe('researched')
    expect(mockFavicons).toHaveBeenCalled()
  })

  it('keeps the first snapshot when a second run is applied', async () => {
    const s = await story()
    await applyResearchRun(s.id, await run(s.id, 1))
    await applyResearchRun(s.id, await run(s.id, 2))

    const after = await stored(s.id)
    expect(after.title).toBe('Researched headline 2')
    expect(after.preResearch).toEqual(SINGLE_SOURCE)
  })

  it('a revert restores every snapshot field, clears both versions, regenerates the embedding and forgets the related stories', async () => {
    const s = await story()
    await applyResearchRun(s.id, await run(s.id))
    mockGenerate.mockResolvedValue({ embedding: axisVector(3), hash: 'restored' })
    mockForget.mockClear()

    await revertResearch(s.id)

    const after = await stored(s.id)
    expect(after).toMatchObject({ ...SINGLE_SOURCE, status: 'published', research: null, preResearch: null })
    expect(await embeddingHash(s.id)).toBe('restored')
    expect(mockForget).toHaveBeenCalledWith([s.id])
  })

  it('the public story serves the researched version and the flag after an apply, and neither after a revert', async () => {
    const s = await story()
    await applyResearchRun(s.id, await run(s.id))
    const researched = await getPublishedStoryBySlug(s.slug!)
    expect(researched).toMatchObject({ researched: true, title: 'Researched headline 1', relevanceSummary: null })
    expect(researched?.research?.sources.map(src => src.id)).toEqual(['S0', 'S1'])

    await revertResearch(s.id)
    expect(await getPublishedStoryBySlug(s.slug!)).toMatchObject({ researched: false, research: null, title: SINGLE_SOURCE.title })
  })

  it("an editor's apply is written against the status now: a run made while the story was selected applies after it was published", async () => {
    const s = await story('selected')
    const runId = await run(s.id)
    await updateStoryStatus(s.id, 'published')

    expect(await applyResearchRun(s.id, runId)).toBe('applied')
    expect(await stored(s.id)).toMatchObject({ status: 'published', title: 'Researched headline 1' })
  })

  it.each(['published', 'rejected'] as const)(
    "a pipeline apply whose story an editor moved to %s during the run is skipped, and the editor's move stands",
    async moved => {
      const s = await story('selected')
      const runId = await run(s.id)
      await updateStoryStatus(s.id, moved)

      expect(await applyResearchRun(s.id, runId, 'pipeline', 'selected')).toBe('skipped')
      const after = await stored(s.id)
      expect(after).toMatchObject({ status: moved, title: SINGLE_SOURCE.title, research: null, preResearch: null })
    },
  )

  it('an editor applies research to a rejected story, which stays rejected', async () => {
    const s = await story('rejected')
    await applyResearchRun(s.id, await run(s.id))
    expect(await stored(s.id)).toMatchObject({ status: 'rejected', title: 'Researched headline 1' })
  })

  it('apply and revert on a trashed story give 409 and change nothing', async () => {
    const s = await story()
    await applyResearchRun(s.id, await run(s.id))
    const runId = await run(s.id, 2)
    await updateStoryStatus(s.id, 'trashed')

    await expect(applyResearchRun(s.id, runId)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/restore it first/) })
    await expect(revertResearch(s.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/restore it first/) })
    expect(await stored(s.id)).toMatchObject({ status: 'trashed', title: 'Researched headline 1', preResearch: SINGLE_SOURCE })
  })

  it.each([
    [
      "a run that fell back to today's format",
      async (id: string) => run(id, 1, { result: result(id, 1, { verdict: { kind: 'fallback', reason: 'budget' } }) }),
      /fell back/,
    ],
    ['a run of another story', async () => run((await story()).id), /another story/],
    ['a run still running', async (id: string) => run(id, 1, { status: 'running', result: null }), /this one is running/],
    ['a failed run', async (id: string) => run(id, 1, { status: 'failed', result: null }), /this one is failed/],
  ])('refuses %s with 409 and leaves the story as it was', async (_name, makeRun, message) => {
    const s = await story()
    const runId = await makeRun(s.id)

    await expect(applyResearchRun(s.id, runId)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(message) })
    expect(await stored(s.id)).toMatchObject({ ...SINGLE_SOURCE, research: null, preResearch: null })
  })

  it('refuses a revert of a story without a researched version', async () => {
    const s = await story()
    await expect(revertResearch(s.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/no researched version/) })
  })
})
