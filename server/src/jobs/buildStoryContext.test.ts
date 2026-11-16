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
vi.mock('../services/storyContextInput.js', () => ({ nextForContext: mocks.nextForContext }))
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
})

const inScope = async () => {
  const scope = createRunScope({ jobName: 'build_story_context', flex: false })
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
  it("adds every story's item tally to the run's usage, and records no notice at or under the share", async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext.mockResolvedValueOnce(run(10, 1)).mockResolvedValueOnce(run(15, 4))
    const scope = await inScope()
    expect(scope.usage).toMatchObject({ itemsChecked: 25, itemsFailed: 5 })
    expect(scope.summary).toBe('Built the context of 2 stories: 4 cards kept, 5 of 25 checked items failed')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('records one warning notice when the failure share passes', async () => {
    mocks.nextForContext.mockResolvedValue(['a', 'b'])
    mocks.runStoryContext.mockResolvedValueOnce(run(20, 5)).mockResolvedValueOnce(run(25, 9))
    await inScope()
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify.mock.calls[0]![0]).toMatchObject({
      source: 'jobs',
      severity: 'warning',
      title: 'Story context: 14 of 45 checked items failed in the last run',
      link: '/admin/jobs',
      dedupeKey: 'step-failing:build_story_context',
    })
  })

  it('records no notice under the minimum count of items, however many failed', async () => {
    mocks.nextForContext.mockResolvedValue(['a'])
    mocks.runStoryContext.mockResolvedValue(run(19, 19))
    await inScope()
    expect(mocks.notify).not.toHaveBeenCalled()
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

  it('prunes the search cache and asks for at most perRun stories', async () => {
    mocks.nextForContext.mockResolvedValue([])
    const scope = await inScope()
    expect(mocks.pruneSearchCache).toHaveBeenCalled()
    expect(mocks.nextForContext).toHaveBeenCalledWith({}, 20)
    expect(scope.summary).toBe('No story owed its context')
  })
})
