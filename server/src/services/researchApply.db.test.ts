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

// The owner's gate (RESEARCH_APPLY_ENABLED) and the research step's mode are read at startup, so the
// tests set them through the config
const applyGate = vi.hoisted(() => ({ enabled: true, mode: 'apply' as 'shadow' | 'apply' }))
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  Object.defineProperty(actual.config.research, 'applyEnabled', { get: () => applyGate.enabled })
  Object.defineProperty(actual.config.research.pipeline, 'mode', { get: () => applyGate.mode })
  return actual
})
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

const { applyResearchRun, applyVerdict, revertResearch } = await import('./researchApply.js')
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
}
/** The story's own rating; the drafts rate it 5, and research never writes it. */
const RATING = { relevance: 6, relevanceCalculation: '- **Scale:** 6' }

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
      story: [{ text: `Researched paragraph ${n}.`, factIds: ['S0F1', 'S1F1'] }],
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
    checks: [{ problems: [], longestRuns: [], unjudged: [] }],
    failedOn: null,
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
  await prisma.story.update({ where: { id: s.id }, data: { ...SINGLE_SOURCE, ...RATING } })
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

/**
 * The selected story as the research step reads it before its run. Its last write is set back first,
 * so a write during the run moves `updatedAt` on even within one millisecond.
 */
async function readBeforeRun(id: string) {
  const { updatedAt } = await prisma.story.update({ where: { id }, data: { updatedAt: new Date('2026-01-01T00:00:00Z') }, select: { updatedAt: true } })
  return { status: 'selected' as const, updatedAt }
}

describeDb('applying and reverting research (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    // Research and applying switched on: an apply refuses while either is off
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    applyGate.enabled = true
    applyGate.mode = 'apply'
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(7), hash: 'researched' })
    mockFavicons.mockReset().mockResolvedValue(undefined)
    mockForget.mockReset()
    feedId = (await createFeed((await createIssue()).id)).id
  })

  it('writes the researched texts, the cited version and the snapshot; the relevance summary is null after it and kept in the snapshot; the rating stays the story’s', async () => {
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
      ...RATING,
    })
    expect(after.preResearch).toEqual(SINGLE_SOURCE)
    expect(after.research).toMatchObject({ paragraphs: [{ sentences: [{ text: 'Researched paragraph 1.' }] }], quoteSourceId: 'S1' })
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

  it('a revert restores every snapshot field, clears both versions, regenerates the embedding and forgets the related stories; an edited rating stays', async () => {
    const s = await story()
    await applyResearchRun(s.id, await run(s.id))
    // The rating is no swapped field: an editor may change it on a researched story
    await prisma.story.update({ where: { id: s.id }, data: { relevance: 7 } })
    mockGenerate.mockResolvedValue({ embedding: axisVector(3), hash: 'restored' })
    mockForget.mockClear()

    await revertResearch(s.id)

    const after = await stored(s.id)
    expect(after).toMatchObject({ ...SINGLE_SOURCE, relevance: 7, status: 'published', research: null, preResearch: null })
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

  it('an edit saved while the apply makes its embedding is kept: the apply writes nothing and answers 409', async () => {
    const s = await story()
    const runId = await run(s.id)
    // As read before the edit, so the edit moves updatedAt on even within one millisecond
    await prisma.story.update({ where: { id: s.id }, data: { updatedAt: new Date('2026-01-01T00:00:00Z') } })
    mockGenerate.mockImplementationOnce(async () => {
      await prisma.story.update({ where: { id: s.id }, data: { emotionTag: 'calm', summary: 'Edited during the apply.' } })
      return { embedding: axisVector(7), hash: 'researched' }
    })

    await expect(applyResearchRun(s.id, runId)).rejects.toThrow(/changed while this was written/)

    expect(await stored(s.id)).toMatchObject({
      title: SINGLE_SOURCE.title,
      summary: 'Edited during the apply.',
      emotionTag: 'calm',
      research: null,
      preResearch: null,
    })
    expect(mockFavicons).not.toHaveBeenCalled()
  })

  it('an edit saved while the revert makes its embedding is kept: the story stays researched and the revert answers 409', async () => {
    const s = await story()
    await applyResearchRun(s.id, await run(s.id))
    await prisma.story.update({ where: { id: s.id }, data: { updatedAt: new Date('2026-01-01T00:00:00Z') } })
    mockGenerate.mockImplementationOnce(async () => {
      await prisma.story.update({ where: { id: s.id }, data: { emotionTag: 'calm' } })
      return { embedding: axisVector(3), hash: 'restored' }
    })

    await expect(revertResearch(s.id)).rejects.toThrow(/changed while this was written/)

    const after = await stored(s.id)
    expect(after).toMatchObject({ title: 'Researched headline 1', emotionTag: 'calm' })
    expect(after.preResearch).toEqual(SINGLE_SOURCE)
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
      const read = await readBeforeRun(s.id)
      await updateStoryStatus(s.id, moved)

      expect(await applyVerdict(s.id, 'run-1', read, result(s.id, 1))).toBe('skipped')
      const after = await stored(s.id)
      expect(after).toMatchObject({ status: moved, title: SINGLE_SOURCE.title, research: null, preResearch: null })
    },
  )

  it("a pipeline apply whose story an editor publishes during the embedding call is skipped by the fence, and the editor's move stands", async () => {
    const s = await story('selected')
    const read = await readBeforeRun(s.id)
    mockGenerate.mockImplementationOnce(async () => {
      await updateStoryStatus(s.id, 'published')
      return { embedding: axisVector(7), hash: 'researched' }
    })

    expect(await applyVerdict(s.id, 'run-1', read, result(s.id, 1))).toBe('skipped')
    expect(await stored(s.id)).toMatchObject({ status: 'published', title: SINGLE_SOURCE.title, research: null, preResearch: null })
    expect(mockFavicons).not.toHaveBeenCalled()
  })

  it("an editor's edit during the run is kept: the step neither applies nor rejects, and its completed run can still be applied by hand", async () => {
    const s = await story('selected')
    const runId = await run(s.id)
    const read = await readBeforeRun(s.id)
    await prisma.story.update({ where: { id: s.id }, data: { emotionTag: 'calm', summary: 'Edited during the run.' } })

    expect(await applyVerdict(s.id, runId, read, result(s.id, 1))).toBe('skipped')
    expect(await applyVerdict(s.id, runId, read, result(s.id, 1, { verdict: { kind: 'stale', firstHappened: '2026-09-01' } }))).toBe('skipped')
    expect(await stored(s.id)).toMatchObject({
      status: 'selected',
      rejectionReason: null,
      summary: 'Edited during the run.',
      emotionTag: 'calm',
      research: null,
    })
    expect(mockGenerate).not.toHaveBeenCalled()

    expect(await applyResearchRun(s.id, runId)).toBe('applied')
    expect(await stored(s.id)).toMatchObject({ status: 'selected', title: 'Researched headline 1', emotionTag: 'calm' })
  })

  it("a version an editor applied during the run is kept: the step's own run is not written over it", async () => {
    const s = await story('selected')
    const read = await readBeforeRun(s.id)
    await applyResearchRun(s.id, await run(s.id, 1))

    expect(await applyVerdict(s.id, 'run-2', read, result(s.id, 2))).toBe('skipped')
    expect(await stored(s.id)).toMatchObject({ status: 'selected', title: 'Researched headline 1' })
  })

  it('the research step puts a kept run on its selected story, which stays selected', async () => {
    const s = await story('selected')

    expect(await applyVerdict(s.id, 'run-1', await readBeforeRun(s.id), result(s.id, 1))).toBe('applied')
    const after = await stored(s.id)
    expect(after).toMatchObject({ status: 'selected', title: 'Researched headline 1', relevanceSummary: null })
    expect(after.preResearch).toEqual(SINGLE_SOURCE)
  })

  it('the research step puts a below-the-bar run on its selected story like a kept one: it stays selected, at its own rating', async () => {
    const s = await story('selected')

    const verdict = { kind: 'research-rating', rating: 3 } as const
    expect(await applyVerdict(s.id, 'run-1', await readBeforeRun(s.id), result(s.id, 1, { verdict }))).toBe('applied')
    expect(await stored(s.id)).toMatchObject({ status: 'selected', rejectionReason: null, title: 'Researched headline 1', ...RATING })
  })

  it.each([
    [{ kind: 'stale', firstHappened: '2026-09-01' }, 'stale'],
    [{ kind: 'contradicted', factIds: ['S1F1'] }, 'contradicted'],
  ] as const)('the research step rejects a selected story on a %o verdict with the reason %s, and writes no research', async (verdict, reason) => {
    const s = await story('selected')

    expect(await applyVerdict(s.id, 'run-1', await readBeforeRun(s.id), result(s.id, 1, { verdict }))).toBe('rejected')
    expect(await stored(s.id)).toMatchObject({ status: 'rejected', rejectionReason: reason, title: SINGLE_SOURCE.title, research: null })
  })

  it('a research rejection leaves a story an editor published during the run published', async () => {
    const s = await story('selected')
    const read = await readBeforeRun(s.id)
    await updateStoryStatus(s.id, 'published')

    expect(await applyVerdict(s.id, 'run-1', read, result(s.id, 1, { verdict: { kind: 'stale', firstHappened: '2026-09-01' } }))).toBe('skipped')
    expect(await stored(s.id)).toMatchObject({ status: 'published', rejectionReason: null })
  })

  it('a fallback leaves the story single-source and selected', async () => {
    const s = await story('selected')
    const verdict = { kind: 'fallback', reason: 'budget', category: 'technical' } as const
    expect(await applyVerdict(s.id, 'run-1', await readBeforeRun(s.id), result(s.id, 1, { verdict }))).toBe('single-source')
    expect(await stored(s.id)).toMatchObject({ ...SINGLE_SOURCE, status: 'selected', research: null, preResearch: null })
  })

  it.each([
    ['shadow mode', () => (applyGate.mode = 'shadow')],
    ['apply mode while the owner’s gate is closed', () => (applyGate.enabled = false)],
  ])('in %s the research step changes no story, whatever the verdict', async (_name, arrange) => {
    arrange()
    const kept = await story('selected')
    const low = await story('selected')

    expect(await applyVerdict(kept.id, 'run-1', await readBeforeRun(kept.id), result(kept.id, 1))).toBe('shadow')
    expect(await applyVerdict(low.id, 'run-2', await readBeforeRun(low.id), result(low.id, 1, { verdict: { kind: 'research-rating', rating: 2 } }))).toBe(
      'shadow',
    )
    for (const id of [kept.id, low.id]) {
      expect(await stored(id)).toMatchObject({ ...SINGLE_SOURCE, status: 'selected', rejectionReason: null, research: null, preResearch: null })
    }
  })

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
      async (id: string) => run(id, 1, { result: result(id, 1, { verdict: { kind: 'fallback', reason: 'budget', category: 'technical' } }) }),
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
