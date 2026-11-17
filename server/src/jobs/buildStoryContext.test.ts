import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  nextForContext: vi.fn(),
  runStoryContext: vi.fn(),
  recordFailedRun: vi.fn(),
  markInterruptedContextRuns: vi.fn(),
  pruneSearchCache: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('../lib/notify.js', () => ({ notify: mocks.notify }))
vi.mock('../services/storyContextQueue.js', () => ({ nextForContext: mocks.nextForContext, STORY_CONTEXT_JOB: 'build_story_context' }))
vi.mock('../services/storyContextSearch.js', () => ({ pruneSearchCache: mocks.pruneSearchCache }))
vi.mock('../services/storyContextRuns.js', () => ({
  runStoryContext: mocks.runStoryContext,
  recordFailedRun: mocks.recordFailedRun,
  markInterruptedContextRuns: mocks.markInterruptedContextRuns,
}))

import { runBuildStoryContext } from './buildStoryContext.js'
import { createRunScope, runInScope } from '../lib/runUsage.js'

const run = (checked: number, failed: number, boxes = 2) => ({
  runId: 'r',
  status: 'completed',
  outcome: 'built',
  boxes,
  tally: { checked, failed },
  written: true,
  transient: false,
})

/** A technical failure of the story's run, which may pass on a second attempt or not. */
const failed = (runId: string, transient: boolean) => ({
  runId,
  status: 'failed',
  outcome: 'technical',
  boxes: 0,
  tally: { checked: 0, failed: 0 },
  written: true,
  transient,
})

const inScope = async (scope = createRunScope({ jobName: 'build_story_context', flex: false })) => {
  await runInScope(scope, () => runBuildStoryContext())
  return scope
}

let savedKey: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedKey = process.env.TAVILY_API_KEY
  process.env.TAVILY_API_KEY = 'tvly-test'
  mocks.pruneSearchCache.mockResolvedValue(0)
  mocks.markInterruptedContextRuns.mockResolvedValue(0)
  mocks.recordFailedRun.mockResolvedValue('failed-run')
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.TAVILY_API_KEY
  else process.env.TAVILY_API_KEY = savedKey
})

describe('runBuildStoryContext', () => {
  it("adds every story's item tally to the run's usage, for the finish's failure-share notice, and records none itself", async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext.mockResolvedValueOnce(run(20, 5)).mockResolvedValueOnce(run(25, 9))
    const scope = await inScope()
    expect(scope.usage).toMatchObject({ itemsChecked: 45, itemsFailed: 14 })
    expect(scope.summary).toBe('Built the context of 2 stories: 4 cards kept, 14 of 45 checked items failed, 0 stories failed')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('tries a story whose run failed on a problem that may pass once more, after the others, on its own run', async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext
      .mockResolvedValueOnce(failed('run-a', true))
      .mockResolvedValueOnce(run(10, 1))
      .mockResolvedValueOnce(run(5, 0, 1))
    const scope = await inScope()
    expect(mocks.runStoryContext.mock.calls).toEqual([
      ['a', undefined, null],
      ['b', undefined, null],
      ['a', undefined, { runId: 'run-a' }],
    ])
    expect(scope.usage).toMatchObject({ itemsChecked: 15, itemsFailed: 1 })
    expect(scope.summary).toBe('Built the context of 2 stories: 3 cards kept, 1 of 15 checked items failed, 0 stories failed (1 tried twice)')
  })

  it("leaves a story to an editor's run that holds it: no failed run recorded, nothing tried again", async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext.mockResolvedValueOnce(null).mockResolvedValueOnce(run(10, 1))
    const scope = await inScope()
    expect(mocks.runStoryContext).toHaveBeenCalledTimes(2)
    expect(mocks.recordFailedRun).not.toHaveBeenCalled()
    expect(scope.usage).toMatchObject({ itemsChecked: 10, itemsFailed: 1 })
    expect(scope.summary).toMatch(/, 0 stories failed$/)
  })

  it('settles a story that fails its second attempt too, and counts it failed', async () => {
    mocks.nextForContext.mockResolvedValue(['a'])
    mocks.runStoryContext.mockResolvedValueOnce(failed('run-a', true)).mockResolvedValueOnce(failed('run-a', true))
    const scope = await inScope()
    expect(mocks.runStoryContext).toHaveBeenCalledTimes(2)
    expect(scope.summary).toBe('Built the context of 1 story: 0 cards kept, 0 of 0 checked items failed, 1 story failed (1 tried twice)')
  })

  it('tries no failure again that would fail the same way, nor an error outside the run, and counts both failed', async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext.mockResolvedValueOnce(failed('run-a', false)).mockRejectedValueOnce(new Error('database gone'))
    const scope = await inScope()
    expect(mocks.runStoryContext).toHaveBeenCalledTimes(2)
    expect(scope.summary).toMatch(/, 2 stories failed$/)
  })

  describe('the failed-stories notice', () => {
    const stories = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)

    it('records one warning notice when more than the share of at least the least number of stories failed', async () => {
      mocks.nextForContext.mockResolvedValue(stories(5))
      mocks.runStoryContext.mockResolvedValueOnce(failed('r0', false)).mockResolvedValueOnce(failed('r1', false)).mockResolvedValue(run(3, 0))
      await inScope()
      expect(mocks.notify).toHaveBeenCalledTimes(1)
      expect(mocks.notify.mock.calls[0]![0]).toMatchObject({
        source: 'jobs',
        severity: 'warning',
        title: 'Build Story Context: 2 of 5 stories failed in the last run',
        link: '/admin/jobs',
        dedupeKey: 'stories-failing:build_story_context',
      })
    })

    it('records none at exactly the share, nor under the least number of stories', async () => {
      mocks.nextForContext.mockResolvedValue(stories(5))
      mocks.runStoryContext.mockResolvedValueOnce(failed('r0', false)).mockResolvedValue(run(3, 0))
      await inScope()
      mocks.nextForContext.mockResolvedValue(stories(4))
      mocks.runStoryContext.mockReset().mockResolvedValue(failed('r', false))
      await inScope()
      expect(mocks.notify).not.toHaveBeenCalled()
    })
  })

  it('records a failed run for an error outside a story run, and goes on with the next story', async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext
      .mockRejectedValueOnce(Object.assign(new Error('connection lost with secret text'), { code: 'P1001' }))
      .mockResolvedValueOnce(run(5, 0))
    const scope = await inScope()
    expect(mocks.recordFailedRun).toHaveBeenCalledWith('a', 'unexpected error (Error P1001)')
    expect(mocks.runStoryContext).toHaveBeenCalledTimes(2)
    expect(scope.usage).toMatchObject({ itemsChecked: 5, itemsFailed: 0 })
  })

  it('builds nothing without the Tavily key, after marking stale runs', async () => {
    delete process.env.TAVILY_API_KEY
    const scope = await inScope()
    expect(mocks.markInterruptedContextRuns).toHaveBeenCalled()
    expect(mocks.nextForContext).not.toHaveBeenCalled()
    expect(scope.summary).toBe('Web search is off, no context built')
  })

  it('prunes the search cache and builds every story it owes, with no limit a run', async () => {
    mocks.nextForContext.mockResolvedValue([])
    const scope = await inScope()
    expect(mocks.pruneSearchCache).toHaveBeenCalled()
    expect(mocks.nextForContext).toHaveBeenCalledWith()
    expect(scope.summary).toBe('No story owed its context')

    const many = Array.from({ length: 45 }, (_, i) => `s${i}`)
    mocks.nextForContext.mockResolvedValue(many)
    mocks.runStoryContext.mockResolvedValue(run(1, 0, 1))
    await inScope()
    expect(mocks.runStoryContext.mock.calls.map(([id]) => id as string).sort()).toEqual([...many].sort())
  })

  it("starts no other story, and no second attempt, once its chain's deadline has passed, and says how many it left", async () => {
    const scope = createRunScope({ jobName: 'build_story_context', flex: false, deadline: new Date(Date.now() + 60_000) })
    mocks.nextForContext.mockResolvedValue(['a', 'b', 'c', 'd', 'e'])
    // Three start at once; the deadline passes while they run
    mocks.runStoryContext
      .mockResolvedValueOnce(failed('run-a', true))
      .mockResolvedValueOnce(run(5, 0))
      .mockImplementationOnce(async () => {
        scope.deadline = new Date(Date.now() - 1)
        return run(5, 0)
      })
      .mockResolvedValue(run(5, 0))
    await inScope(scope)
    expect(mocks.runStoryContext.mock.calls.map(([id]) => id as string)).toEqual(['a', 'b', 'c'])
    expect(scope.summary).toBe('Built the context of 3 stories: 4 cards kept, 0 of 10 checked items failed, 1 story failed, 2 left at the deadline')
  })

  it("starts nothing when its chain's deadline has passed before it began", async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    const scope = await inScope(createRunScope({ jobName: 'build_story_context', flex: false, deadline: new Date(Date.now() - 1) }))
    expect(mocks.runStoryContext).not.toHaveBeenCalled()
    expect(scope.summary).toBe('Built the context of 0 stories: 0 cards kept, 0 of 0 checked items failed, 0 stories failed, 2 left at the deadline')
  })
})
