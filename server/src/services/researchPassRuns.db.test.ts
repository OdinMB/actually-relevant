/**
 * A research pass's lifecycle on PostgreSQL (`researchPassRuns.ts`, `researchPassApply.ts`,
 * `researchPassViews.ts`): the claim and its reservation under the one cap, the month's sum,
 * interrupted and skipped passes, the fenced apply of a pass's result, an editor's pass and its spend.
 * The pass pipeline is a fake whose result each test gives (`researchPass.test.ts` tests the real
 * one), and so is its input; the embedding call and the favicon fetch are mocked. The eval gate is
 * open in these tests unless one closes it.
 */
import type { Prisma } from '@prisma/client'
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import type { PassRecord, PassResult } from './researchPass.js'
import type { ArticleVersionData } from './researchPool.js'
import type { ResearchedSource } from './researchedStory.js'

const gate = vi.hoisted(() => ({ closed: null as string | null }))
vi.mock('./researchPassGate.js', () => ({
  get PASS_EVAL_GATE() {
    return gate.closed
  },
}))
const mockPass = vi.hoisted(() => ({ runResearchPass: vi.fn() }))
vi.mock('./researchPass.js', async importOriginal => ({ ...(await importOriginal<typeof import('./researchPass.js')>()), ...mockPass }))
// The input only reaches the fake pipeline; null for a story the loader cannot research
const mockInput = vi.hoisted(() => ({ loadPassInput: vi.fn() }))
vi.mock('./researchPassInput.js', async importOriginal => ({ ...(await importOriginal<typeof import('./researchPassInput.js')>()), ...mockInput }))
const mockGenerate = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerate,
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))
vi.mock('./sourceFavicons.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./sourceFavicons.js')>()),
  fetchSourceFaviconsInBackground: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./relatedStories.js', async importOriginal => ({ ...(await importOriginal<typeof import('./relatedStories.js')>()), forgetRelatedStories: vi.fn() }))

const { claimPass, markInterruptedPasses, PASS_INTERRUPTED, recordSkippedPass, runPipelinePass, startEditorPass, startEditorPassBatch } =
  await import('./researchPassRuns.js')
const { monthToDateUsd } = await import('./researchSpend.js')
const { passUsage, storyPasses } = await import('./researchPassViews.js')
const { getPublishedStoryBySlug } = await import('./publicStories.js')
const { recordOtherCost } = await import('../lib/runUsage.js')
const { _setProcessStartedAt } = await import('../lib/runCutOff.js')
const { PASS_EVAL_GATE: realGate } = await vi.importActual<typeof import('./researchPassGate.js')>('./researchPassGate.js')

const FIRST = config.research.pass.firstPassUsd
const LATER = config.research.pass.laterPassUsd
const CAP = config.research.monthlyCapUsd
const MINUTE_MS = 60_000
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS)

let feedId = ''

const SINGLE_SOURCE = { title: 'Single-source headline', summary: 'Single-source summary.' }

async function researchable(status: 'analyzed' | 'selected' | 'published' = 'selected') {
  return createStory({
    feedId,
    status,
    ...SINGLE_SOURCE,
    relevance: 6,
    slug: status === 'published' ? `story-${Math.random().toString(36).slice(2, 8)}` : null,
    datePublished: status === 'published' ? new Date() : null,
  })
}

const source = (id: string, origin: ResearchedSource['origin']): ResearchedSource => ({
  id,
  origin,
  outlet: `Outlet ${id}`,
  host: `outlet-${id.toLowerCase()}.example`,
  url: `https://outlet-${id.toLowerCase()}.example/a`,
  title: `Headline ${id}`,
  date: '2026-11-10',
  country: 'Kenya',
  kind: 'news-report',
  storyId: null,
  slug: null,
})

/** A first pass's version 1: the researched text, citing the original and one search result. */
const firstVersion = (): ArticleVersionData => ({
  id: null,
  number: 1,
  kind: 'first',
  status: 'current',
  passId: null,
  title: 'Researched headline',
  titleLabel: 'Label',
  summary: 'Researched summary.',
  marketingBlurb: 'Blurb.',
  quote: null,
  quoteAttribution: null,
  relevanceReasons: '- It matters.',
  antifactors: '- A caveat.',
  emotionTag: 'calm',
  research: {
    paragraphs: [
      {
        sentences: [
          {
            text: 'Researched paragraph.',
            citations: [
              { sourceId: 'S0', sentence: 'Of S0.' },
              { sourceId: 'S1', sentence: 'Of S1.' },
            ],
          },
        ],
      },
    ],
    whyThisMatters: [{ text: 'It matters.', citations: [{ sourceId: 'S1', sentence: 'Of S1.' }] }],
    caveats: [{ text: 'A caveat.', citations: [] }],
    quoteSourceId: null,
    sources: [source('S0', 'original'), source('S1', 'source')],
  },
  article: {
    titleLabel: 'Label',
    title: 'Researched headline',
    story: [{ text: 'Researched paragraph.', factIds: ['S0F1', 'S1F1'] }],
    summary: 'Researched summary.',
    whyThisMatters: [{ text: 'It matters.', factIds: ['S1F1'] }],
    caveats: [{ text: 'A caveat.', factIds: [] }],
    quote: '',
    quoteAttribution: '',
    quoteSourceId: '',
    marketingBlurb: 'Blurb.',
    emotionTag: 'calm',
  },
  changes: [],
  note: null,
})

const RECORD = { research: { checks: [], problems: [] }, context: { tally: { checked: 3, failed: 1 } }, update: null } as unknown as PassRecord

function passResult(over: Partial<PassResult> = {}): PassResult {
  return {
    kind: 'first',
    status: 'completed',
    outcome: 'written',
    verdict: { kind: 'keep' },
    pool: { sources: [], facts: [], searches: [], dropped: [] },
    changed: [],
    version: firstVersion(),
    boxes: [],
    boxFacts: new Map(),
    writer: null,
    record: RECORD,
    credits: 4,
    modelUsd: 0.06,
    error: null,
    transient: false,
    ...over,
  }
}

const passOf = (id: string) => prisma.researchPass.findUniqueOrThrow({ where: { id } })
const readOf = async (storyId: string) => {
  const s = await prisma.story.findUniqueOrThrow({ where: { id: storyId }, select: { status: true, updatedAt: true } })
  return { status: s.status, updatedAt: s.updatedAt }
}
const always = async () => true

const setJob = (enabled: boolean) =>
  prisma.jobRun.upsert({
    where: { jobName: 'research_pass' },
    update: { enabled },
    create: { jobName: 'research_pass', cronExpression: '30 1 * * *', enabled },
  })

async function spentThisMonth(usd: number) {
  await prisma.storyResearchRun.create({ data: { status: 'completed', trigger: 'editor', costUsd: usd, startedAt: new Date() } })
}

describeDb('research passes (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    gate.closed = null
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    _setProcessStartedAt(ago(24 * 60))
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(5), hash: 'researched' })
    mockPass.runResearchPass.mockReset().mockResolvedValue(passResult())
    mockInput.loadPassInput.mockReset().mockResolvedValue({ fake: 'input' })
    await setJob(true)
    feedId = (await createFeed((await createIssue()).id)).id
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    _setProcessStartedAt(null)
    taskRegistry.clear()
  })

  it('claims a first pass at its ceiling, and a later one for a story with a current version', async () => {
    const story = await researchable()
    const first = await claimPass(story.id, 'pipeline')
    expect(first).toMatchObject({ kind: 'first', ceilingUsd: FIRST })
    if (!('passId' in first)) throw new Error('refused')
    expect(await passOf(first.passId)).toMatchObject({ storyId: story.id, number: 1, trigger: 'pipeline', kind: 'first', status: 'running', costUsd: FIRST })

    expect(await claimPass(story.id, 'editor')).toEqual({ refused: 'in-progress' })

    await prisma.researchPass.update({ where: { id: first.passId }, data: { status: 'completed' } })
    const v = firstVersion()
    await prisma.articleVersion.create({ data: { storyId: story.id, number: 1, kind: 'first', status: 'current', research: v.research } })
    const later = await claimPass(story.id, 'editor')
    expect(later).toMatchObject({ kind: 'later', ceilingUsd: LATER })
    if (!('passId' in later)) throw new Error('refused')
    expect(await passOf(later.passId)).toMatchObject({ number: 2, trigger: 'editor', kind: 'later', costUsd: LATER })
  })

  it('claims a later pass for a story research already researched: the claim imports its legacy runs as version 1, once', async () => {
    const story = await researchable('published')
    const v = firstVersion()
    await prisma.story.update({ where: { id: story.id }, data: { research: v.research as unknown as Prisma.InputJsonObject } })
    const claim = await claimPass(story.id, 'editor')
    expect(claim).toMatchObject({ kind: 'later', ceilingUsd: LATER })
    expect(await prisma.articleVersion.findMany({ where: { storyId: story.id }, select: { number: true, kind: true, status: true } })).toEqual([
      { number: 1, kind: 'legacy', status: 'current' },
    ])
    if (!('passId' in claim)) throw new Error('refused')
    await prisma.researchPass.update({ where: { id: claim.passId }, data: { status: 'completed' } })
    expect(await claimPass(story.id, 'editor')).toMatchObject({ kind: 'later' })
    expect(await prisma.articleVersion.count({ where: { storyId: story.id } })).toBe(1)
  })

  it('never passes the cap, however many claims start at once, research runs counted in the same month', async () => {
    // Room for exactly two first passes beside this month's research run
    await spentThisMonth(CAP - 2 * FIRST - 0.001)
    const stories = await Promise.all([1, 2, 3, 4].map(() => researchable()))

    const claims = await Promise.all(stories.map(s => claimPass(s.id, 'pipeline')))

    expect(claims.filter(c => 'passId' in c)).toHaveLength(2)
    expect(claims.filter(c => 'refused' in c && c.refused === 'cap')).toHaveLength(2)
    expect(await monthToDateUsd(prisma, new Date())).toBeLessThanOrEqual(CAP)
  })

  it("sums this month's research runs and passes once each, deleted stories' included, leaving out the run or pass a meter counts itself", async () => {
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) - 2 * 24 * 60 * MINUTE_MS)
    await prisma.storyResearchRun.create({ data: { status: 'completed', trigger: 'pipeline', costUsd: 1, startedAt: new Date() } })
    const run = await prisma.storyResearchRun.create({ data: { status: 'running', trigger: 'editor', costUsd: 0.25, startedAt: new Date() } })
    await prisma.storyResearchRun.create({ data: { status: 'completed', trigger: 'pipeline', costUsd: 5, startedAt: lastMonth } })
    await prisma.researchPass.create({ data: { number: 1, trigger: 'pipeline', kind: 'first', status: 'completed', costUsd: 0.3, startedAt: new Date() } })
    const pass = await prisma.researchPass.create({
      data: { number: 2, trigger: 'editor', kind: 'later', status: 'running', costUsd: LATER, startedAt: new Date() },
    })
    await prisma.researchPass.create({ data: { number: 1, trigger: 'pipeline', kind: 'first', status: 'completed', costUsd: 5, startedAt: lastMonth } })

    const now = new Date()
    expect(await monthToDateUsd(prisma, now)).toBeCloseTo(1 + 0.25 + 0.3 + LATER, 10)
    expect(await monthToDateUsd(prisma, now, { passId: pass.id })).toBeCloseTo(1 + 0.25 + 0.3, 10)
    expect(await monthToDateUsd(prisma, now, { runId: run.id })).toBeCloseTo(1 + 0.3 + LATER, 10)
    expect(await passUsage(now)).toEqual({
      spentUsd: expect.closeTo(1 + 0.25 + 0.3 + LATER, 10),
      capUsd: CAP,
      firstPassUsd: FIRST,
      laterPassUsd: LATER,
      refusal: null,
      on: true,
    })
  })

  it("marks a pass a restart cut off failed, keeping its reservation, and leaves a live one running, a slow one past context's limit included", async () => {
    const story = await researchable()
    const cutOff = await prisma.researchPass.create({
      data: {
        storyId: story.id,
        number: 1,
        trigger: 'pipeline',
        kind: 'first',
        status: 'running',
        costUsd: FIRST,
        startedAt: ago(config.research.pass.staleRunMinutes + 5),
      },
    })
    const live = await prisma.researchPass.create({
      data: { storyId: story.id, number: 2, trigger: 'editor', kind: 'first', status: 'running', costUsd: FIRST, startedAt: ago(1) },
    })
    // A pass is research's and context's calls in turn, with a second attempt: it outlives a context run's limit
    const slow = await prisma.researchPass.create({
      data: {
        storyId: (await researchable()).id,
        number: 1,
        trigger: 'pipeline',
        kind: 'first',
        status: 'running',
        costUsd: FIRST,
        startedAt: ago(config.storyContext.staleRunMinutes + 5),
      },
    })

    expect(await markInterruptedPasses()).toBe(1)

    expect(await passOf(cutOff.id)).toMatchObject({ status: 'failed', outcome: 'technical', error: PASS_INTERRUPTED, costUsd: FIRST })
    expect((await passOf(cutOff.id)).finishedAt).not.toBeNull()
    expect(await passOf(live.id)).toMatchObject({ status: 'running' })
    expect(await passOf(slow.id)).toMatchObject({ status: 'running' })
  })

  it('records a skipped pass at $0 with its reason, numbered after the story’s others', async () => {
    const story = await researchable()
    await prisma.researchPass.create({ data: { storyId: story.id, number: 1, trigger: 'editor', kind: 'first', status: 'completed', costUsd: 0.2 } })

    const id = await recordSkippedPass(story.id, 'monthly cap reached')

    expect(await passOf(id)).toMatchObject({
      number: 2,
      trigger: 'pipeline',
      status: 'skipped',
      outcome: 'budget',
      costUsd: 0,
      error: 'skipped: monthly cap reached',
    })
  })

  it("applies a pipeline pass's first version to the selected story, fenced on the story as read before it, its cost the larger of the meter's and the result's", async () => {
    const story = await researchable()

    const run = await runPipelinePass(story.id, await readOf(story.id), always)

    expect(run).toMatchObject({ outcome: 'passed', end: { ended: 'completed', outcome: 'written', applied: 'applied', tally: { checked: 3, failed: 1 } } })
    const after = await prisma.story.findUniqueOrThrow({ where: { id: story.id } })
    expect(after).toMatchObject({ status: 'selected', title: 'Researched headline', summary: 'Researched summary.' })
    expect(after.preResearch).toMatchObject({ title: SINGLE_SOURCE.title, summary: SINGLE_SOURCE.summary })
    expect(after.research).toMatchObject({ sources: [{ id: 'S0' }, { id: 'S1' }] })
    const [pass] = await prisma.researchPass.findMany({ where: { storyId: story.id } })
    expect(pass).toMatchObject({ status: 'completed', outcome: 'written', verdict: 'keep', modelUsd: 0.06, tavilyCredits: 4, versionId: expect.any(String) })
    expect(pass!.costUsd).toBeCloseTo(0.06 + 4 * config.research.tavilyUsdPerCredit, 10)
    // A first pass on a story readers do not have yet records no Update
    const [version] = await prisma.articleVersion.findMany({ where: { storyId: story.id } })
    expect(version).toMatchObject({ number: 1, kind: 'first', status: 'current', note: null })
  })

  it('keeps an edit made during the pass: the pass is stored without its version, and the story keeps its text', async () => {
    const story = await researchable()
    const read = await readOf(story.id)
    mockPass.runResearchPass.mockImplementation(async () => {
      await prisma.story.update({ where: { id: story.id }, data: { title: 'Edited during the pass' } })
      return passResult()
    })

    const run = await runPipelinePass(story.id, read, always)

    expect(run).toMatchObject({ outcome: 'passed', end: { applied: 'skipped' } })
    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toMatchObject({ title: 'Edited during the pass', preResearch: null })
    const [pass] = await prisma.researchPass.findMany({ where: { storyId: story.id } })
    expect(pass).toMatchObject({ status: 'completed', versionId: null, error: expect.stringMatching(/^not applied: /) })
    expect(await prisma.articleVersion.count({ where: { storyId: story.id } })).toBe(0)
  })

  it("counts an editor's pass that applied nothing as skipped, with why, not as researched", async () => {
    const story = await researchable('published')
    mockPass.runResearchPass.mockImplementation(async () => {
      await prisma.story.update({ where: { id: story.id }, data: { status: 'selected' } })
      return passResult()
    })

    const { taskId } = await startEditorPass(story.id)
    await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).toBe('completed'), { timeout: 5000, interval: 20 })

    expect(taskRegistry.get(taskId)).toMatchObject({
      completed: 0,
      failed: 0,
      skipped: [{ storyId: story.id, reason: 'Not applied: the story moved to selected during the run' }],
    })
  })

  it('stores a pass that ends after the step was switched off without applying it', async () => {
    const story = await researchable()

    const run = await runPipelinePass(story.id, await readOf(story.id), async () => false)

    expect(run).toMatchObject({ end: { applied: 'skipped' } })
    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toMatchObject({ title: SINGLE_SOURCE.title })
    expect(await prisma.researchPass.findFirstOrThrow({ where: { storyId: story.id } })).toMatchObject({ status: 'completed', versionId: null })
  })

  it('rejects a selected story its first pass finds old news, and only while it is still selected and unwritten', async () => {
    const story = await researchable()
    mockPass.runResearchPass.mockResolvedValue(passResult({ outcome: 'stale', verdict: { kind: 'stale', firstHappened: '2024-03-01' }, version: null }))

    const run = await runPipelinePass(story.id, await readOf(story.id), always)

    expect(run).toMatchObject({ end: { applied: 'rejected' } })
    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toMatchObject({ status: 'rejected', rejectionReason: 'stale' })
    expect(await prisma.researchPass.findFirstOrThrow({ where: { storyId: story.id } })).toMatchObject({ outcome: 'stale', verdict: 'stale' })
  })

  it("never rejects a story on an editor's pass: the verdict is recorded on the pass and the story stays as it is", async () => {
    const story = await researchable()
    mockPass.runResearchPass.mockResolvedValue(passResult({ outcome: 'contradicted', verdict: { kind: 'contradicted', factIds: ['S1F1'] }, version: null }))

    const { taskId, passId } = await startEditorPass(story.id)
    await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).toBe('completed'), { timeout: 5000, interval: 20 })

    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toMatchObject({ status: 'selected', rejectionReason: null })
    expect(await passOf(passId)).toMatchObject({ status: 'completed', outcome: 'contradicted', verdict: 'contradicted', versionId: null, error: null })
    expect(taskRegistry.get(taskId)).toMatchObject({ completed: 1, failed: 0 })
  })

  it('settles a story the loader cannot research with a $0 skipped pass, and one past the cap too', async () => {
    const unreadable = await researchable()
    mockInput.loadPassInput.mockResolvedValueOnce(null)
    const run = await runPipelinePass(unreadable.id, await readOf(unreadable.id), always)
    expect(run).toEqual({ outcome: 'passed', end: { ended: 'skipped', reason: 'the story lacks the analysis research needs' } })
    expect(await prisma.researchPass.findFirstOrThrow({ where: { storyId: unreadable.id } })).toMatchObject({ status: 'skipped', costUsd: 0 })

    await spentThisMonth(CAP)
    const atCap = await researchable()
    expect(await runPipelinePass(atCap.id, await readOf(atCap.id), always)).toEqual({ outcome: 'refused', reason: 'monthly cap reached' })
    expect(await prisma.researchPass.findFirstOrThrow({ where: { storyId: atCap.id } })).toMatchObject({ status: 'skipped', costUsd: 0 })
    expect(mockPass.runResearchPass).toHaveBeenCalledTimes(0)
  })

  it('tries a pass once more in the same pass when it failed on a problem that may pass, and fails it at its cost when the second try fails', async () => {
    const story = await researchable()
    const failed = passResult({
      status: 'failed',
      outcome: 'technical',
      verdict: { kind: 'fallback', reason: 'model down', category: 'technical' },
      version: null,
      transient: true,
      error: 'model down',
    })
    mockPass.runResearchPass.mockResolvedValue(failed)

    const run = await runPipelinePass(story.id, await readOf(story.id), always)

    expect(mockPass.runResearchPass).toHaveBeenCalledTimes(2)
    expect(run).toMatchObject({ end: { ended: 'failed', triedTwice: true, applied: 'stored' } })
    expect(await prisma.researchPass.findFirstOrThrow({ where: { storyId: story.id } })).toMatchObject({
      status: 'failed',
      outcome: 'technical',
      error: 'model down',
    })
  })

  it("records an editor's first pass on a published story as an Update readers see, and adds its spend to the step's month", async () => {
    const story = await researchable('published')
    mockPass.runResearchPass.mockImplementation(async () => {
      recordOtherCost(0.05, 3)
      return passResult()
    })

    const { taskId, passId } = await startEditorPass(story.id)
    await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).toBe('completed'), { timeout: 5000, interval: 20 })

    expect(taskRegistry.get(taskId)).toMatchObject({ completed: 1, failed: 0 })
    expect(await passOf(passId)).toMatchObject({ trigger: 'editor', status: 'completed', versionId: expect.any(String) })
    const served = await getPublishedStoryBySlug(story.slug!)
    expect(served?.title).toBe('Researched headline')
    expect(served?.updates).toEqual([
      expect.objectContaining({
        note: { text: expect.stringMatching(/^Researched with 1 more source on \w{3} \d{1,2}; the story was rewritten from it\.$/), citations: [] },
        changes: expect.arrayContaining([{ section: 'Title', before: { text: SINGLE_SOURCE.title, citations: [] }, removed: false }]),
      }),
    ])
    const month = await prisma.jobMonthSpend.findMany({ where: { jobName: 'research_pass' } })
    expect(month).toEqual([expect.objectContaining({ costUsd: expect.closeTo(0.05, 10), searchCredits: 3, runs: 1 })])

    const view = await storyPasses(story.id)
    expect(view.passes.map(p => p.id)).toEqual([passId])
    expect(view.versions).toHaveLength(1)
  })

  it("refuses an editor's pass while the eval gate is closed or the job disabled, writing nothing", async () => {
    const story = await researchable('published')
    gate.closed = realGate
    await expect(startEditorPass(story.id)).rejects.toThrow(/switched off: their evals have not yet met/)
    // The admin shows nothing of the step while the gate is closed, though the job row is enabled
    expect(await passUsage()).toMatchObject({ refusal: expect.stringMatching(/switched off: their evals/), on: false })

    gate.closed = null
    await setJob(false)
    await expect(startEditorPass(story.id)).rejects.toThrow(/research_pass job is disabled/)
    expect(await passUsage()).toMatchObject({ refusal: expect.stringMatching(/research_pass job is disabled/), on: false })
    expect(await prisma.researchPass.count()).toBe(0)
  })

  it('stays on for the admin with the key unset, the refusal saying why no pass starts', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(await passUsage()).toMatchObject({ refusal: expect.any(String), on: true })
  })

  it('drops the result of a pass a restart marked cut off first, rolling the story write back with it', async () => {
    const story = await researchable()
    mockPass.runResearchPass.mockImplementation(async () => {
      await prisma.researchPass.updateMany({ where: { storyId: story.id }, data: { status: 'failed', error: PASS_INTERRUPTED } })
      return passResult()
    })

    const run = await runPipelinePass(story.id, await readOf(story.id), always)

    expect(run).toMatchObject({ end: { applied: 'dropped' } })
    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toMatchObject({ title: SINGLE_SOURCE.title, preResearch: null, research: null })
    expect(await prisma.articleVersion.count({ where: { storyId: story.id } })).toBe(0)
    expect(await prisma.researchPass.findFirstOrThrow({ where: { storyId: story.id } })).toMatchObject({ status: 'failed', error: PASS_INTERRUPTED })
  })

  it('keeps the article of a later pass that could not fix what it found out of date, and raises one notice for the story', async () => {
    const story = await researchable('published')
    const v = firstVersion()
    await prisma.articleVersion.create({ data: { storyId: story.id, number: 1, kind: 'first', status: 'current', research: v.research } })
    const failed = passResult({
      kind: 'later',
      outcome: 'update_failed',
      version: null,
      record: { ...RECORD, update: { failedOn: 'Story paragraph 1' } } as unknown as PassRecord,
    })
    mockPass.runResearchPass.mockResolvedValue(failed)

    for (const _ of [1, 2]) {
      const { taskId } = await startEditorPass(story.id)
      await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).toBe('completed'), { timeout: 5000, interval: 20 })
    }

    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toMatchObject({ status: 'published', title: SINGLE_SOURCE.title })
    const notices = await prisma.adminNotice.findMany({ where: { dedupeKey: `research-update-failed:${story.id}` } })
    expect(notices).toEqual([expect.objectContaining({ link: `/admin/stories/${story.id}`, message: expect.stringContaining('Story paragraph 1') })])
    expect(await prisma.researchPass.findMany({ where: { storyId: story.id }, select: { outcome: true, verdict: true } })).toEqual([
      { outcome: 'update_failed', verdict: null },
      { outcome: 'update_failed', verdict: null },
    ])
  })

  it('runs a bulk pass as one task, skipping a story it cannot research with the reason', async () => {
    const ok = await researchable('published')
    const trashed = await researchable('analyzed')
    await prisma.story.update({ where: { id: trashed.id }, data: { status: 'trashed' } })

    const { taskId } = await startEditorPassBatch([ok.id, trashed.id, ok.id])
    await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).toBe('completed'), { timeout: 5000, interval: 20 })

    expect(taskRegistry.get(taskId)).toMatchObject({
      total: 2,
      completed: 1,
      skipped: [{ storyId: trashed.id, reason: expect.stringMatching(/^Only analyzed, selected or published stories can be researched/) }],
    })
    expect(await prisma.researchPass.count({ where: { storyId: ok.id, status: 'completed' } })).toBe(1)
  })

  it("answers 404 for a story's passes when the story is unknown", async () => {
    await expect(storyPasses('00000000-0000-4000-8000-000000000000')).rejects.toThrow('Story not found')
  })
})
