import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import type { StoryResearch } from './researchPipeline.js'

// The pipeline itself is researchPipeline.test.ts's; here it is a fake whose result and timing the
// test controls, so these tests are about the run's row: the reservation, the cap, the finish.
const mockPipeline = vi.hoisted(() => ({ researchStory: vi.fn() }))
vi.mock('./researchPipeline.js', async importOriginal => ({ ...(await importOriginal<typeof import('./researchPipeline.js')>()), ...mockPipeline }))

const { listResearchRuns, recordSkippedRun, researchUsage, runPipelineResearch, startResearchRun } = await import('./researchRuns.js')

const RESERVATION = config.research.maxRunUsd
const CAP = config.research.monthlyCapUsd
const MINUTE_MS = 60_000

function research(storyId: string, over: Partial<StoryResearch> = {}): StoryResearch {
  return {
    storyId,
    calls: [
      { step: 'queries', outcome: 'ok', usage: { input: 100, cached: 0, output: 10, reasoning: 0 }, costUsd: 0.01, model: 'gpt-6-luna' },
      { step: 'write', outcome: 'ok', usage: { input: 900, cached: 0, output: 90, reasoning: 0 }, costUsd: 0.03, model: 'gpt-6-luna' },
    ],
    credits: 2,
    searches: [],
    candidates: 0,
    drops: {},
    sources: [],
    earlier: [],
    draft: null,
    rewritten: false,
    problems: [],
    support: { facts: 0, found: 0 },
    optOutChecked: false,
    verdict: { kind: 'keep' },
    ...over,
  }
}
const MEASURED = 0.01 + 0.03 + 2 * config.research.tavilyUsdPerCredit

async function researchable(status: 'analyzed' | 'selected' | 'published' = 'analyzed') {
  const issue = await createIssue()
  const feed = await createFeed(issue.id)
  return createStory({ feedId: feed.id, status, title: 'Title', summary: 'Summary', relevance: 6, datePublished: status === 'published' ? new Date() : null })
}

const runOf = (id: string) => prisma.storyResearchRun.findUniqueOrThrow({ where: { id } })
const settled = (id: string) => vi.waitFor(async () => expect((await runOf(id)).status).not.toBe('running'), { timeout: 5000, interval: 20 })

/** Whether the story's pipeline run started (reserved, still researching) or was refused (a $0 failed run), once it has a row. */
const startOutcome = (storyId: string) =>
  vi.waitFor(
    async () => {
      const run = await prisma.storyResearchRun.findFirstOrThrow({ where: { storyId }, select: { status: true } })
      return run.status === 'running' ? 'started' : 'refused'
    },
    { timeout: 5000, interval: 20 },
  )

async function pastRun(data: { storyId?: string | null; status: 'running' | 'completed' | 'failed'; costUsd: number; startedAt?: Date }) {
  return prisma.storyResearchRun.create({
    data: { storyId: data.storyId ?? null, status: data.status, costUsd: data.costUsd, startedAt: data.startedAt ?? new Date() },
  })
}

function lastMonth(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 2 * 24 * 60 * MINUTE_MS)
}

describeDb('story research runs', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    mockPipeline.researchStory.mockReset()
    mockPipeline.researchStory.mockImplementation(async (s: { id: string }) => research(s.id))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    taskRegistry.clear()
  })

  it('reserves the ceiling while the run runs, then replaces it with the measured cost', async () => {
    let release: () => void = () => {}
    mockPipeline.researchStory.mockImplementation(async (s: { id: string }) => {
      await new Promise<void>(resolve => (release = resolve))
      return research(s.id)
    })
    const story = await researchable()
    const { runId, taskId } = await startResearchRun(story.id)
    expect(await runOf(runId)).toMatchObject({ storyId: story.id, status: 'running', costUsd: RESERVATION, verdict: null })
    expect(taskRegistry.get(taskId)).toMatchObject({ type: 'research', status: 'running', storyIds: [story.id] })

    release()
    await settled(runId)
    const run = await runOf(runId)
    expect(run).toMatchObject({ status: 'completed', verdict: 'keep', tavilyCredits: 2, error: null })
    expect(run.costUsd).toBeCloseTo(MEASURED, 10)
    expect(run.finishedAt).not.toBeNull()
    expect(run.result).toMatchObject({ storyId: story.id, optOutChecked: false, prices: { tavilyUsdPerCredit: config.research.tavilyUsdPerCredit } })
    expect(taskRegistry.get(taskId)).toMatchObject({ status: 'completed', completed: 1, failed: 0 })
  })

  it('counts a run that ends as fallback as completed, and stores its category with its result', async () => {
    const verdict = { kind: 'fallback', reason: 'no usable source', category: 'no_other_coverage' } as const
    mockPipeline.researchStory.mockImplementation(async (s: { id: string }) => research(s.id, { verdict }))
    const story = await researchable('published')
    const { runId, taskId } = await startResearchRun(story.id)
    await settled(runId)
    expect(await runOf(runId)).toMatchObject({ status: 'completed', verdict: 'fallback', result: expect.objectContaining({ verdict }) })
    expect(taskRegistry.get(taskId)).toMatchObject({ completed: 1, failed: 0 })
    expect((await listResearchRuns(story.id))[0]?.result?.verdict).toEqual(verdict)
  })

  it("counts this month's fallbacks by category, a run stored before categories as unrecorded, and nothing else", async () => {
    const fallback = (category?: string) => ({ kind: 'fallback', reason: 'r', ...(category ? { category } : {}) })
    const ran = (verdict: { kind: string }, startedAt = new Date()) =>
      prisma.storyResearchRun.create({ data: { status: 'completed', costUsd: 0.05, verdict: verdict.kind, result: { verdict }, startedAt } })
    await ran(fallback('no_other_coverage'))
    await ran(fallback('no_other_coverage'))
    await ran(fallback('not_confirmed'))
    await ran(fallback('technical'))
    await ran(fallback())
    await ran({ kind: 'keep' })
    await ran(fallback('draft_failed_check'), lastMonth())

    expect((await researchUsage()).fallbacksThisMonth).toEqual({
      no_other_coverage: 2,
      not_confirmed: 1,
      draft_failed_check: 0,
      technical: 1,
      unrecorded: 1,
    })
  })

  it('keeps the cap under concurrent reservations of different stories: only those the room allows start, the rest are refused at $0', async () => {
    mockPipeline.researchStory.mockImplementation(() => new Promise(() => {}))
    // Room for two reservations, not three
    await pastRun({ status: 'completed', costUsd: CAP - 2 * RESERVATION - 0.01 })
    const stories = await Promise.all([1, 2, 3, 4].map(() => researchable('selected')))

    // As the research step starts them, several at once; a started run researches until the test ends
    const outcomes = await Promise.all(
      stories.map(s => {
        void runPipelineResearch(s.id, vi.fn())
        return startOutcome(s.id)
      }),
    )

    expect(outcomes.sort()).toEqual(['refused', 'refused', 'started', 'started'])
    expect(await prisma.storyResearchRun.count({ where: { status: 'running' } })).toBe(2)
    expect(await prisma.storyResearchRun.count({ where: { status: 'failed', costUsd: 0, error: 'skipped: monthly cap reached' } })).toBe(2)
    expect((await researchUsage()).monthToDateUsd).toBeCloseTo(CAP - 0.01, 10)
  })

  it('marks a run that threw failed, keeping its reservation and a sanitized error', async () => {
    mockPipeline.researchStory.mockRejectedValue(new Error('boom with fetched text: <script>'))
    const story = await researchable()
    const { runId, taskId } = await startResearchRun(story.id)
    await settled(runId)
    const run = await runOf(runId)
    expect(run).toMatchObject({ status: 'failed', costUsd: RESERVATION, verdict: null })
    expect(run.error).not.toContain('fetched text')
    expect(taskRegistry.get(taskId)).toMatchObject({ status: 'failed', failed: 1 })
  })

  it('leaves the story row as it was', async () => {
    const story = await researchable('selected')
    const before = await prisma.story.findUniqueOrThrow({ where: { id: story.id } })
    const { runId } = await startResearchRun(story.id)
    await settled(runId)
    expect(await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).toEqual(before)
  })

  it("refuses a run when the month's spend plus the reservation would pass the cap", async () => {
    const story = await researchable()
    await pastRun({ status: 'completed', costUsd: CAP - RESERVATION + 0.01 })
    await expect(startResearchRun(story.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/cap/) })
    expect(await prisma.storyResearchRun.count()).toBe(1)
  })

  it("ignores last month's runs", async () => {
    const story = await researchable()
    await pastRun({ status: 'completed', costUsd: CAP, startedAt: lastMonth() })
    const { runId } = await startResearchRun(story.id)
    await settled(runId)
    expect((await researchUsage()).monthToDateUsd).toBeCloseTo(MEASURED, 10)
  })

  it('counts a running run at its reservation', async () => {
    const story = await researchable()
    await pastRun({ status: 'completed', costUsd: CAP - 2 * RESERVATION + 0.01 })
    await pastRun({ status: 'running', costUsd: RESERVATION })
    await expect(startResearchRun(story.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/cap/) })
  })

  it('refuses a second run of a story while one runs, and lets concurrent starts pass only one', async () => {
    mockPipeline.researchStory.mockImplementation(() => new Promise(() => {}))
    const story = await researchable()
    await startResearchRun(story.id)
    await expect(startResearchRun(story.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/in progress/) })

    const other = await researchable()
    const results = await Promise.allSettled([startResearchRun(other.id), startResearchRun(other.id), startResearchRun(other.id)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.storyResearchRun.count({ where: { storyId: other.id } })).toBe(1)
  })

  it('marks a running row older than the stale limit failed, keeping its reservation, and lets the story run again', async () => {
    const story = await researchable()
    const stale = await pastRun({
      storyId: story.id,
      status: 'running',
      costUsd: RESERVATION,
      startedAt: new Date(Date.now() - (config.research.staleRunMinutes + 1) * MINUTE_MS),
    })
    const [listed] = await listResearchRuns(story.id)
    expect(listed).toMatchObject({ id: stale.id, status: 'failed', costUsd: RESERVATION, error: expect.stringMatching(/interrupted/) })
    const { runId } = await startResearchRun(story.id)
    await settled(runId)
    expect((await runOf(runId)).status).toBe('completed')
  })

  it('does not overwrite a run marked interrupted before it finished', async () => {
    let release: () => void = () => {}
    mockPipeline.researchStory.mockImplementation(async (s: { id: string }) => {
      await new Promise<void>(resolve => (release = resolve))
      return research(s.id)
    })
    const story = await researchable()
    const { runId, taskId } = await startResearchRun(story.id)
    await prisma.storyResearchRun.update({
      where: { id: runId },
      data: { startedAt: new Date(Date.now() - (config.research.staleRunMinutes + 1) * MINUTE_MS) },
    })
    await listResearchRuns(story.id)
    release()
    await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).not.toBe('running'), { timeout: 5000, interval: 20 })
    expect(await runOf(runId)).toMatchObject({ status: 'failed', costUsd: RESERVATION, verdict: null })
  })

  it("keeps a deleted story's runs with no story, still in the month's spend", async () => {
    const story = await researchable()
    const { runId } = await startResearchRun(story.id)
    await settled(runId)
    await prisma.story.delete({ where: { id: story.id } })
    expect(await runOf(runId)).toMatchObject({ storyId: null, status: 'completed' })
    expect((await researchUsage()).monthToDateUsd).toBeCloseTo(MEASURED, 10)
  })

  it('refuses a story the loader cannot research before writing any row', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const untitled = await createStory({ feedId: feed.id, status: 'analyzed', title: null, summary: 'Summary', relevance: 6 })
    await expect(startResearchRun(untitled.id)).rejects.toMatchObject({ status: 409, message: 'This story lacks the analysis research needs' })
    expect(await prisma.storyResearchRun.count()).toBe(0)
  })

  it('lists a story’s runs newest first, at most the configured number, with their cost summaries', async () => {
    const story = await researchable()
    for (let i = 0; i < config.research.runsListed + 2; i++) {
      await pastRun({ storyId: story.id, status: 'failed', costUsd: RESERVATION, startedAt: new Date(Date.now() - (i + 1) * MINUTE_MS) })
    }
    const { runId } = await startResearchRun(story.id)
    await settled(runId)
    const runs = await listResearchRuns(story.id)
    expect(runs).toHaveLength(config.research.runsListed)
    expect(runs[0]?.id).toBe(runId)
    expect(runs[0]?.cost?.totalUsd).toBeCloseTo(MEASURED, 10)
    expect(runs[1]?.cost).toBeNull()
    expect(runs.map(r => Date.parse(r.startedAt))).toEqual([...runs.map(r => Date.parse(r.startedAt))].sort((a, b) => b - a))
  })

  it("marks an editor's run as the editor's", async () => {
    const story = await researchable()
    const { runId } = await startResearchRun(story.id)
    await settled(runId)
    expect(await runOf(runId)).toMatchObject({ trigger: 'editor' })
    expect((await listResearchRuns(story.id))[0]).toMatchObject({ trigger: 'editor' })
  })

  it("runs the research step's run in the call, marked as the pipeline's, with its hook after the result is stored and before the finish write", async () => {
    const story = await researchable('selected')
    const seen: { status: string; verdict: string | null; stored: boolean; costUsd: number; runId: string }[] = []
    const beforeFinish = vi.fn(async (result: StoryResearch, runId: string) => {
      expect(result.storyId).toBe(story.id)
      const row = await runOf(runId)
      seen.push({ status: row.status, verdict: row.verdict, stored: row.result !== null, costUsd: row.costUsd, runId })
    })

    const outcome = await runPipelineResearch(story.id, beforeFinish)

    expect(outcome).toMatchObject({ outcome: 'researched', end: { ended: 'completed', verdict: 'keep' } })
    const runId = outcome.outcome === 'researched' ? outcome.runId : ''
    // Still running, so the publish gate keeps waiting; the result already durable, at its measured cost
    expect(seen).toEqual([{ status: 'running', verdict: 'keep', stored: true, costUsd: expect.closeTo(MEASURED, 10), runId }])
    expect(await runOf(runId)).toMatchObject({ trigger: 'pipeline', status: 'completed', verdict: 'keep' })
    expect((await runOf(runId)).finishedAt).not.toBeNull()
  })

  it("fails the research step's run when its hook throws, keeping its stored result and its measured cost", async () => {
    const story = await researchable('selected')
    const outcome = await runPipelineResearch(story.id, async () => {
      throw new Error('embedding down, with fetched text')
    })
    expect(outcome).toMatchObject({ outcome: 'researched', end: { ended: 'failed' } })
    const runId = outcome.outcome === 'researched' ? outcome.runId : ''
    const run = await runOf(runId)
    expect(run).toMatchObject({ trigger: 'pipeline', status: 'failed', verdict: 'keep', result: expect.objectContaining({ storyId: story.id }) })
    expect(run.costUsd).toBeCloseTo(MEASURED, 10)
    expect(run.error).not.toContain('fetched text')
  })

  it('records a $0 skipped pipeline run, for a failure outside any run, so the story settles', async () => {
    const story = await researchable('selected')
    const runId = await recordSkippedRun(story.id, 'unexpected error (Error)')
    expect(await runOf(runId)).toMatchObject({
      storyId: story.id,
      trigger: 'pipeline',
      status: 'failed',
      costUsd: 0,
      error: 'skipped: unexpected error (Error)',
    })
  })

  it('records a $0 failed pipeline run at the cap, without researching, so the story is no longer waited on', async () => {
    const story = await researchable('selected')
    await pastRun({ status: 'completed', costUsd: CAP - RESERVATION + 0.01 })
    const beforeFinish = vi.fn()

    const outcome = await runPipelineResearch(story.id, beforeFinish)

    expect(outcome).toMatchObject({ outcome: 'refused', reason: 'monthly cap reached' })
    const runId = outcome.outcome === 'refused' ? outcome.runId : ''
    expect(await runOf(runId)).toMatchObject({ storyId: story.id, trigger: 'pipeline', status: 'failed', costUsd: 0, error: 'skipped: monthly cap reached' })
    expect(mockPipeline.researchStory).not.toHaveBeenCalled()
    expect(beforeFinish).not.toHaveBeenCalled()
    expect((await researchUsage()).monthToDateUsd).toBeCloseTo(CAP - RESERVATION + 0.01, 10)
  })

  it('records a $0 failed pipeline run for a story the loader cannot research', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const untitled = await createStory({ feedId: feed.id, status: 'selected', title: null, summary: 'Summary', relevance: 6 })

    const outcome = await runPipelineResearch(untitled.id, vi.fn())

    expect(outcome).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/lacks the analysis/) })
    expect(await prisma.storyResearchRun.findMany({ where: { storyId: untitled.id } })).toEqual([
      expect.objectContaining({ trigger: 'pipeline', status: 'failed', costUsd: 0 }),
    ])
  })

  it('writes no row while another run of the story is in progress, so the step tries it again later', async () => {
    mockPipeline.researchStory.mockImplementation(() => new Promise(() => {}))
    const story = await researchable('selected')
    await startResearchRun(story.id)

    expect(await runPipelineResearch(story.id, vi.fn())).toEqual({ outcome: 'busy' })
    expect(await prisma.storyResearchRun.count({ where: { storyId: story.id } })).toBe(1)
  })
})
