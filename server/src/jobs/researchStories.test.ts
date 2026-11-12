/**
 * The research step's loop, with the queue, the runs and the apply mocked: what it researches, in
 * which order, when it stops, and that one story's failure does not end the run. The queue's rule is
 * researchQueue.db.test.ts's, a run's row and its hook researchRuns.db.test.ts's, each verdict's
 * effect researchApply's tests'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoryResearch } from '../services/researchPipeline.js'

const mockPrisma = vi.hoisted(() => ({}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
const mockQueue = vi.hoisted(() => ({ nextToResearch: vi.fn(), researchPipelineOn: vi.fn(), stillOwed: vi.fn() }))
vi.mock('../services/researchQueue.js', () => mockQueue)
const mockRuns = vi.hoisted(() => ({ markInterruptedRuns: vi.fn(), runPipelineResearch: vi.fn() }))
vi.mock('../services/researchRuns.js', () => mockRuns)
const mockApply = vi.hoisted(() => ({ applyVerdict: vi.fn(), pipelineMode: vi.fn() }))
vi.mock('../services/researchApply.js', () => mockApply)

const { runResearchStories } = await import('./researchStories.js')
const { config } = await import('../config.js')

const RESULT = { storyId: 'a', verdict: { kind: 'keep' } } as StoryResearch

/** A run that calls its hook, as the real one does before its finish write, then completes. */
async function researchedRun(storyId: string, beforeFinish: (result: StoryResearch, runId: string) => Promise<void>) {
  await beforeFinish({ ...RESULT, storyId }, `run-${storyId}`)
  return { outcome: 'researched', runId: `run-${storyId}`, end: { ended: 'completed', verdict: 'keep' } }
}

const researchedIds = () => mockRuns.runPipelineResearch.mock.calls.map(c => c[0])

beforeEach(() => {
  vi.clearAllMocks()
  mockQueue.researchPipelineOn.mockResolvedValue(true)
  mockQueue.stillOwed.mockResolvedValue(true)
  mockQueue.nextToResearch.mockResolvedValue(['a', 'b', 'c'])
  mockRuns.markInterruptedRuns.mockResolvedValue(undefined)
  mockRuns.runPipelineResearch.mockImplementation(researchedRun)
  mockApply.pipelineMode.mockReturnValue({ mode: 'apply' })
  mockApply.applyVerdict.mockResolvedValue('applied')
})

describe('runResearchStories', () => {
  it('sweeps stale runs first, then researches the queue in its order, at most the per-run limit', async () => {
    await runResearchStories()

    expect(mockRuns.markInterruptedRuns).toHaveBeenCalledWith(mockPrisma, expect.any(Date))
    expect(mockRuns.markInterruptedRuns.mock.invocationCallOrder[0]).toBeLessThan(mockQueue.nextToResearch.mock.invocationCallOrder[0]!)
    expect(mockQueue.nextToResearch).toHaveBeenCalledWith(config.research.pipeline.perRun)
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
  })

  it("applies each verdict from the run's hook, against the selected status, before the run is finished", async () => {
    await runResearchStories()

    expect(mockApply.applyVerdict.mock.calls).toEqual([
      ['a', 'run-a', 'selected', { ...RESULT, storyId: 'a' }],
      ['b', 'run-b', 'selected', { ...RESULT, storyId: 'b' }],
      ['c', 'run-c', 'selected', { ...RESULT, storyId: 'c' }],
    ])
  })

  it('researches nothing, after the sweep, while the step is off', async () => {
    mockQueue.researchPipelineOn.mockResolvedValue(false)
    await runResearchStories()
    expect(mockRuns.markInterruptedRuns).toHaveBeenCalled()
    expect(mockQueue.nextToResearch).not.toHaveBeenCalled()
    expect(mockRuns.runPipelineResearch).not.toHaveBeenCalled()
  })

  it('stops before the next story once the job is disabled or research is switched off', async () => {
    // On at the start and before the first story; off before the second
    mockQueue.researchPipelineOn.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false)
    await runResearchStories()
    expect(researchedIds()).toEqual(['a'])
  })

  it('skips a story an editor moved or researched since the queue was read', async () => {
    mockQueue.stillOwed.mockImplementation(async (id: string) => id !== 'b')
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'c'])
  })

  it('goes on after a story refused at the cap, one busy with an editor’s run, or one whose run failed', async () => {
    mockRuns.runPipelineResearch
      .mockResolvedValueOnce({ outcome: 'refused', runId: 'run-a', reason: 'monthly cap reached' })
      .mockResolvedValueOnce({ outcome: 'busy' })
      .mockResolvedValueOnce({ outcome: 'researched', runId: 'run-c', end: { ended: 'failed', error: 'unexpected error (Error)' } })
    await expect(runResearchStories()).resolves.toBeUndefined()
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
  })

  it("goes on with the next story after an unexpected error outside a story's run", async () => {
    mockQueue.stillOwed.mockRejectedValueOnce(new Error('connection reset'))
    mockRuns.runPipelineResearch.mockImplementation(async (id: string, hook: Parameters<typeof researchedRun>[1]) => {
      if (id === 'b') throw new Error('database down')
      return researchedRun(id, hook)
    })
    await expect(runResearchStories()).resolves.toBeUndefined()
    expect(researchedIds()).toEqual(['b', 'c'])
  })

  it('still researches in shadow mode, which the apply turns into no change', async () => {
    mockApply.pipelineMode.mockReturnValue({ mode: 'shadow', heldBack: 'Applying research is not open yet: RESEARCH_APPLY_ENABLED is not "true"' })
    mockApply.applyVerdict.mockResolvedValue('shadow')
    await runResearchStories()
    expect(researchedIds()).toEqual(['a', 'b', 'c'])
    expect(mockApply.applyVerdict).toHaveBeenCalledTimes(3)
  })
})
