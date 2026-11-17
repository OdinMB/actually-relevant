import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import prisma from '../lib/prisma.js'
import { recordOtherCost } from '../lib/runUsage.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { citingContextDeps, fakeContextDeps } from '../test/contextDeps.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextRun, createResearchRun } from '../test/db/storyContext.js'
import type { ContextDeps } from './storyContextPipeline.js'
import { gatherState, startContextGathering } from './storyContextOnDemand.js'
import { _setProcessStartedAt } from './storyContextStale.js'

const UNKNOWN = '00000000-0000-0000-0000-000000000000'

/** A search that costs what a Tavily search costs inside a run (`recordOtherCost`), and finds nothing. */
function paidSearch(deps: ContextDeps): ContextDeps {
  return {
    ...deps,
    search: async () => {
      recordOtherCost(0.008, 1)
      return { results: [], credits: 1, cached: false }
    },
  }
}

/** As `fakeContextDeps()`, with a gap list that wants one search, so the run searches once. */
function searchingDeps(base: ContextDeps = fakeContextDeps()): ContextDeps {
  return paidSearch({
    ...base,
    async call(step, schema, prompt) {
      if (step !== 'gap-list') return base.call(step, schema, prompt)
      const parsed = {
        slots: [
          { slot: 'response', needed: true, covered: 'yes' },
          { slot: 'compared', needed: true, covered: 'no' },
        ],
        responseInStory: '',
        responseSearches: { action: '', elsewhere: '' },
        searches: [{ slot: 'compared', query: 'fires record years', wanted: 'earlier fire seasons', recent: false }],
      }
      return { parsed: parsed as never, outcome: 'ok', usage: ZERO_USAGE, costUsd: 0.002, model: 'model-gap-list' }
    },
  })
}

const finished = (taskId: string) =>
  vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).not.toBe('running'), { timeout: 5000, interval: 20 }).then(() => taskRegistry.get(taskId)!)

describeDb('story context on demand', () => {
  useTestDatabase()

  beforeEach(() => vi.stubEnv('TAVILY_API_KEY', 'tvly-test'))
  afterEach(() => {
    vi.unstubAllEnvs()
    taskRegistry.clear()
    _setProcessStartedAt(null)
  })

  const story = async (data: { status?: 'published' | 'selected'; datePublished?: Date | null } = {}) => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    return createStory({
      feedId: feed.id,
      status: data.status ?? 'published',
      datePublished: data.datePublished === undefined ? new Date('2026-01-10T08:00:00Z') : data.datePublished,
      title: 'Fires',
      summary: 'Fires burned.',
    })
  }
  const researched = async (data: Parameters<typeof story>[0] = {}) => {
    const s = await story(data)
    await createResearchRun(s.id, [{ id: 'S0', facts: [{ id: 'S0F1' }, { id: 'S0F2' }] }])
    return s
  }

  it('refuses, in this order: web search off, an unknown story, one not published, one without research facts, one whose run is running', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    await expect(startContextGathering(UNKNOWN, fakeContextDeps())).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/web search is off/i) })
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    await expect(startContextGathering(UNKNOWN, fakeContextDeps())).rejects.toMatchObject({ status: 404, message: 'Story not found' })

    const draft = await researched({ status: 'selected', datePublished: null })
    await expect(startContextGathering(draft.id, fakeContextDeps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/only for a published story/i),
    })
    const bare = await story()
    await createResearchRun(bare.id, [{ id: 'S0', facts: [] }])
    await expect(startContextGathering(bare.id, fakeContextDeps())).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/research/i) })

    const busy = await researched()
    await createContextRun(busy.id, { status: 'running', outcome: null, finishedAt: null })
    await expect(startContextGathering(busy.id, fakeContextDeps())).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already being gathered/i),
    })
    expect(await prisma.storyContextRun.count()).toBe(1)
  })

  it('starts at once on a story whose run a restart cut off, marking that run interrupted, as the admin’s view does', async () => {
    const s = await researched()
    _setProcessStartedAt(new Date(Date.now() - 60_000))
    const cutOff = await createContextRun(s.id, { status: 'running', outcome: null, finishedAt: null, startedAt: new Date(Date.now() - 5 * 60_000) })

    const { taskId, runId } = await startContextGathering(s.id, fakeContextDeps())
    expect(await finished(taskId)).toMatchObject({ status: 'completed', completed: 1 })
    expect(runId).not.toBe(cutOff.id)
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: cutOff.id } })).toMatchObject({
      status: 'failed',
      outcome: 'technical',
      error: expect.stringMatching(/interrupted/),
    })
  })

  it("runs on a story outside the step's lookback, that already has a run, and builds on that run", async () => {
    const s = await researched()
    const first = await startContextGathering(s.id, citingContextDeps())
    expect(taskRegistry.get(first.taskId)).toMatchObject({ type: 'context', total: 1, storyIds: [s.id] })
    expect(await finished(first.taskId)).toMatchObject({ status: 'completed', completed: 1, failed: 0 })

    const steps: string[] = []
    const second = await startContextGathering(s.id, citingContextDeps(steps))
    expect(await finished(second.taskId)).toMatchObject({ status: 'completed', completed: 1 })
    expect(second.runId).not.toBe(first.runId)
    expect(steps).not.toContain('structure')
    const run = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: second.runId } })
    expect(run).toMatchObject({ status: 'completed', outcome: 'built', boxes: 2 })
    expect(run.result).toMatchObject({ facts: { research: 0, carried: 2 } })
  })

  it("counts the run's spend as the step's month, not as an editor's research, and checks the step's warning level", async () => {
    await prisma.spendWarning.create({ data: { scope: 'build_story_context', levelUsd: 0 } })
    const s = await researched()
    const { taskId } = await startContextGathering(s.id, searchingDeps())
    await finished(taskId)
    await vi.waitFor(async () => expect(await prisma.jobMonthSpend.count()).toBe(1), { timeout: 5000, interval: 20 })

    const [row] = await prisma.jobMonthSpend.findMany()
    expect(row).toMatchObject({ jobName: 'build_story_context', searchCredits: 1, runs: 1 })
    expect(row!.searchUsd).toBeCloseTo(0.008, 10)
    expect(row!.costUsd).toBeCloseTo(0.008, 10)
    await vi.waitFor(async () => expect(await prisma.adminNotice.count({ where: { dedupeKey: { startsWith: 'spend-warn:build_story_context:' } } })).toBe(1), {
      timeout: 5000,
      interval: 20,
    })
  })

  it('tries a failure that may pass once more on the same run row, and fails the task on a second failure', async () => {
    const s = await researched()
    let writes = 0
    const flaky = fakeContextDeps()
    const transient = fakeContextDeps({ writeError: 'transient' })
    const once: ContextDeps = { ...flaky, call: (step, schema, prompt) => (step === 'write' && writes++ === 0 ? transient : flaky).call(step, schema, prompt) }
    const { taskId, runId } = await startContextGathering(s.id, once)
    expect(await finished(taskId)).toMatchObject({ status: 'completed', completed: 1 })
    expect(writes).toBe(2)
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: 'completed', outcome: 'built' })
    expect(await prisma.storyContextRun.count({ where: { storyId: s.id } })).toBe(1)

    const again = await startContextGathering(s.id, fakeContextDeps({ writeError: 'transient' }))
    const task = await finished(again.taskId)
    expect(task).toMatchObject({ status: 'failed', failed: 1 })
    expect(task.errors[0]).toMatch(/technical problem/)
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: again.runId } })).toMatchObject({ status: 'failed', outcome: 'technical' })
  })

  it('fails the task on a failure that would fail the same way, without a second attempt', async () => {
    const s = await researched()
    const calls: string[] = []
    const lasting = fakeContextDeps({ writeError: 'lasting' })
    const { taskId } = await startContextGathering(s.id, { ...lasting, call: (step, schema, prompt) => (calls.push(step), lasting.call(step, schema, prompt)) })
    expect(await finished(taskId)).toMatchObject({ status: 'failed', failed: 1 })
    expect(calls.filter(c => c === 'write')).toHaveLength(1)
  })

  it('says whether the story can have context gathered, and why not now: web search off, not eligible, a run running', async () => {
    const s = await researched()
    expect(await gatherState(s.id)).toEqual({ eligible: true, refusal: null })
    const bare = await story()
    expect(await gatherState(bare.id)).toEqual({ eligible: false, refusal: expect.stringMatching(/research/i) })
    const draft = await researched({ status: 'selected', datePublished: null })
    expect(await gatherState(draft.id)).toEqual({ eligible: false, refusal: expect.stringMatching(/only for a published story/i) })

    const running = await createContextRun(s.id, { status: 'running', outcome: null, finishedAt: null })
    expect(await gatherState(s.id)).toEqual({ eligible: true, refusal: expect.stringMatching(/already being gathered/i) })
    await prisma.storyContextRun.update({ where: { id: running.id }, data: { status: 'completed' } })

    vi.stubEnv('TAVILY_API_KEY', '')
    expect(await gatherState(s.id)).toEqual({ eligible: true, refusal: expect.stringMatching(/web search is off/i) })
    await expect(gatherState(UNKNOWN)).rejects.toMatchObject({ status: 404 })
  })
})
