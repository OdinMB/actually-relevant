/**
 * The research step's loop, with the queue's reads, the runs and the apply's writes mocked, and the
 * real mode decision (`researchStepState`, `pipelineMode`) on a mocked job row and config: what it
 * researches, in which order, whether it applies, when it stops, and that one story's failure does
 * not end the run. The queue's rule is researchQueue.db.test.ts's, a run's row and its hook
 * researchRuns.db.test.ts's, each verdict's effect researchApply's tests'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StoryResearch } from '../services/researchPipeline.js'

const mockPrisma = vi.hoisted(() => ({ jobRun: { findUnique: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
const mockQueue = vi.hoisted(() => ({ nextToResearch: vi.fn(), owedStory: vi.fn() }))
vi.mock('../services/researchQueue.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/researchQueue.js')>()), ...mockQueue }))
const mockRuns = vi.hoisted(() => ({ markInterruptedRuns: vi.fn(), runPipelineResearch: vi.fn(), recordSkippedRun: vi.fn() }))
vi.mock('../services/researchRuns.js', async importOriginal => ({ ...(await importOriginal<typeof import('../services/researchRuns.js')>()), ...mockRuns }))
const mockApplyVerdict = vi.hoisted(() => vi.fn())
vi.mock('../services/researchApply.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/researchApply.js')>()),
  applyVerdict: mockApplyVerdict,
}))
// The research step's mode, the owner's gate and how many stories run at once are read at startup,
// so the tests set them through the config (concurrency: the config's own value unless a test sets one)
const switches = vi.hoisted(() => ({ mode: 'apply' as 'shadow' | 'apply', applyEnabled: true, concurrency: undefined as number | undefined }))
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  const { concurrency } = actual.config.research.pipeline
  Object.defineProperty(actual.config.research, 'applyEnabled', { get: () => switches.applyEnabled })
  Object.defineProperty(actual.config.research.pipeline, 'mode', { get: () => switches.mode })
  Object.defineProperty(actual.config.research.pipeline, 'concurrency', { get: () => switches.concurrency ?? concurrency })
  return actual
})

const { runResearchStories } = await import('./researchStories.js')
const { config } = await import('../config.js')

const RESULT = { storyId: 'a', verdict: { kind: 'keep' } } as StoryResearch
/** Each story's last write as read before its run. */
const readAt = (storyId: string) => new Date(`2026-11-12T0${'abc'.indexOf(storyId) + 1}:00:00Z`)

/** A run that calls its hook, as the real one does once the result is stored, then completes. */
async function researchedRun(storyId: string, beforeFinish: (result: StoryResearch, runId: string) => Promise<void>) {
  await beforeFinish({ ...RESULT, storyId }, `run-${storyId}`)
  return { outcome: 'researched', runId: `run-${storyId}`, end: { ended: 'completed', verdict: 'keep' } }
}

const researchedIds = () => mockRuns.runPipelineResearch.mock.calls.map(c => c[0])
const jobEnabled = (enabled: boolean) => ({ enabled })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
  switches.mode = 'apply'
  switches.applyEnabled = true
  switches.concurrency = undefined
  mockPrisma.jobRun.findUnique.mockResolvedValue(jobEnabled(true))
  mockQueue.owedStory.mockImplementation(async (id: string) => ({ updatedAt: readAt(id) }))
  mockQueue.nextToResearch.mockResolvedValue(['a', 'b', 'c'])
  mockRuns.markInterruptedRuns.mockResolvedValue(undefined)
  mockRuns.runPipelineResearch.mockImplementation(researchedRun)
  mockRuns.recordSkippedRun.mockResolvedValue('run-skipped')
  mockApplyVerdict.mockResolvedValue('applied')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runResearchStories', () => {
  it('sweeps stale runs first, then researches the queue in its order, at most the per-run limit', async () => {
    await runResearchStories()

    expect(mockRuns.markInterruptedRuns).toHaveBeenCalledWith(mockPrisma, expect.any(Date))
    expect(mockRuns.markInterruptedRuns.mock.invocationCallOrder[0]).toBeLessThan(mockQueue.nextToResearch.mock.invocationCallOrder[0]!)
    expect(mockQueue.nextToResearch).toHaveBeenCalledWith(config.research.pipeline.perRun)
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
  })

  it("in apply mode with the job enabled, applies each verdict from the run's hook, fenced on the story as read before its run", async () => {
    await runResearchStories()

    expect(mockApplyVerdict.mock.calls).toEqual(
      ['a', 'b', 'c'].map(id => [id, `run-${id}`, { status: 'selected', updatedAt: readAt(id) }, { ...RESULT, storyId: id }]),
    )
    // Read before the run started, not after it
    expect(mockQueue.owedStory.mock.invocationCallOrder[0]).toBeLessThan(mockRuns.runPipelineResearch.mock.invocationCallOrder[0]!)
  })

  it.each([
    ['in shadow mode', () => (switches.mode = 'shadow')],
    ['in apply mode while the owner’s gate is closed', () => (switches.applyEnabled = false)],
  ])('researches every story %s and applies no verdict', async (_name, arrange) => {
    arrange()
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
    expect(mockApplyVerdict).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled', jobEnabled(false)],
    ['without a row', null],
  ])('run by hand while the job is %s, researches as a trial in shadow and never applies, even in apply mode', async (_name, row) => {
    mockPrisma.jobRun.findUnique.mockResolvedValue(row)
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
    expect(mockApplyVerdict).not.toHaveBeenCalled()
  })

  it('never applies in a trial run, even once the job is enabled during it', async () => {
    mockPrisma.jobRun.findUnique.mockResolvedValueOnce(jobEnabled(false)).mockResolvedValue(jobEnabled(true))
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
    expect(mockApplyVerdict).not.toHaveBeenCalled()
  })

  it('applies nothing for a story whose run outlasts the job being disabled, and stops before the next one', async () => {
    // One at a time: enabled at the start and before the first story; disabled by the time its hook runs
    switches.concurrency = 1
    mockPrisma.jobRun.findUnique.mockResolvedValueOnce(jobEnabled(true)).mockResolvedValueOnce(jobEnabled(true)).mockResolvedValue(jobEnabled(false))
    await runResearchStories()
    expect(researchedIds()).toEqual(['a'])
    expect(mockApplyVerdict).not.toHaveBeenCalled()
  })

  it('researches nothing, after the sweep, while research is switched off, the job enabled or not', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    await runResearchStories()
    mockPrisma.jobRun.findUnique.mockResolvedValue(jobEnabled(false))
    await runResearchStories()
    expect(mockRuns.markInterruptedRuns).toHaveBeenCalledTimes(2)
    expect(mockQueue.nextToResearch).not.toHaveBeenCalled()
    expect(mockRuns.runPipelineResearch).not.toHaveBeenCalled()
  })

  it('stops before the next story once research is switched off', async () => {
    switches.concurrency = 1
    mockRuns.runPipelineResearch.mockImplementation(async (id: string, hook: Parameters<typeof researchedRun>[1]) => {
      vi.stubEnv('TAVILY_API_KEY', '')
      return researchedRun(id, hook)
    })
    await runResearchStories()
    expect(researchedIds()).toEqual(['a'])
    expect(mockApplyVerdict).not.toHaveBeenCalled()
  })

  it('researches at most `concurrency` stories at once, in queue order, starting the next as one finishes', async () => {
    switches.concurrency = 2
    const ids = ['s1', 's2', 's3', 's4', 's5']
    mockQueue.nextToResearch.mockResolvedValue(ids)
    const finish = new Map<string, () => void>()
    let inFlight = 0
    let most = 0
    mockRuns.runPipelineResearch.mockImplementation(async (id: string, hook: Parameters<typeof researchedRun>[1]) => {
      most = Math.max(most, ++inFlight)
      await new Promise<void>(resolve => finish.set(id, resolve))
      inFlight--
      return researchedRun(id, hook)
    })

    const job = runResearchStories()
    await vi.waitFor(() => expect(researchedIds()).toEqual(['s1', 's2']))
    finish.get('s2')!()
    await vi.waitFor(() => expect(researchedIds()).toEqual(['s1', 's2', 's3']))
    for (const id of ids) {
      await vi.waitFor(() => expect(finish.has(id)).toBe(true))
      finish.get(id)!()
    }
    await job

    expect(most).toBe(2)
    expect(researchedIds()).toEqual(ids)
    expect(mockApplyVerdict).toHaveBeenCalledTimes(ids.length)
  })

  it('runs the stories in flight to the end once research is switched off, and starts no other', async () => {
    switches.concurrency = 2
    mockQueue.nextToResearch.mockResolvedValue(['a', 'b', 'c', 'd'])
    mockRuns.runPipelineResearch.mockImplementation(async (id: string, hook: Parameters<typeof researchedRun>[1]) => {
      if (id === 'a') vi.stubEnv('TAVILY_API_KEY', '')
      return researchedRun(id, hook)
    })
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'b'])
  })

  it('skips a story an editor moved or researched since the queue was read', async () => {
    mockQueue.owedStory.mockImplementation(async (id: string) => (id === 'b' ? null : { updatedAt: readAt(id) }))
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'c'])
    expect(mockRuns.recordSkippedRun).not.toHaveBeenCalled()
  })

  it('goes on after a story refused at the cap, one busy with an editor’s run, or one whose run failed', async () => {
    switches.concurrency = 1
    mockRuns.runPipelineResearch
      .mockResolvedValueOnce({ outcome: 'refused', runId: 'run-a', reason: 'monthly cap reached' })
      .mockResolvedValueOnce({ outcome: 'busy' })
      .mockResolvedValueOnce({ outcome: 'researched', runId: 'run-c', end: { ended: 'failed', error: 'unexpected error (Error)' } })
    await expect(runResearchStories()).resolves.toBeUndefined()
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
    expect(mockRuns.recordSkippedRun).not.toHaveBeenCalled()
  })

  it('records a $0 run for a story hit by an error outside its run, so it settles, and goes on with the next', async () => {
    switches.concurrency = 1
    mockQueue.owedStory.mockRejectedValueOnce(new Error('connection reset, with a query'))
    mockRuns.runPipelineResearch.mockImplementation(async (id: string, hook: Parameters<typeof researchedRun>[1]) => {
      if (id === 'b') throw new Error('database down')
      return researchedRun(id, hook)
    })
    await expect(runResearchStories()).resolves.toBeUndefined()
    expect(researchedIds()).toEqual(['b', 'c'])
    expect(mockRuns.recordSkippedRun.mock.calls).toEqual([
      ['a', 'unexpected error (Error)'],
      ['b', 'unexpected error (Error)'],
    ])
  })

  it('goes on when even the $0 run cannot be recorded', async () => {
    switches.concurrency = 1
    mockQueue.owedStory.mockRejectedValueOnce(new Error('connection reset'))
    mockRuns.recordSkippedRun.mockRejectedValueOnce(new Error('still down'))
    await expect(runResearchStories()).resolves.toBeUndefined()
    expect(researchedIds()).toEqual(['b', 'c'])
  })
})
