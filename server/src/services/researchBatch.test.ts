import { describe, it, expect, vi, beforeEach } from 'vitest'

// The run path itself (checks, reservation under the lock, the run) is researchRuns'; here, how a
// batch takes its stories through it: the pool, the skips with their reasons, the task's counts.
const mockRuns = vi.hoisted(() => ({ switchRefusal: vi.fn(), reserveEditorRun: vi.fn(), runInTask: vi.fn(), runPipelineResearch: vi.fn() }))
const mockApply = vi.hoisted(() => ({ applyResearchRun: vi.fn(), applyVerdict: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('./researchRuns.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./researchRuns.js')>()),
  ...mockRuns,
}))
vi.mock('./researchApply.js', () => mockApply)

const { startResearchBatch } = await import('./researchBatch.js')
const { taskRegistry } = await import('../lib/taskRegistry.js')
const { ConflictError, NotFoundError } = await import('../utils/errors.js')
const { config } = await import('../config.js')

/** A run the test ends by hand; `runInTask` counts it in the task as the real one does. */
function controlledRuns() {
  const ends = new Map<string, () => void>()
  mockRuns.runInTask.mockImplementation(
    (taskId: string, runId: string) =>
      new Promise<void>(resolve => {
        ends.set(runId, () => {
          taskRegistry.increment(taskId, 'completed')
          resolve()
        })
      }),
  )
  return ends
}

function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected a refusal')
}

const finished = async (taskId: string) => {
  await vi.waitFor(() => expect(taskRegistry.get(taskId)?.status).not.toBe('running'))
  return taskRegistry.get(taskId)!
}

beforeEach(() => {
  vi.clearAllMocks()
  taskRegistry.clear()
  mockRuns.switchRefusal.mockReturnValue(null)
  mockRuns.reserveEditorRun.mockImplementation(async (storyId: string) => ({ runId: `run-${storyId}`, story: { id: storyId } }))
  mockRuns.runInTask.mockImplementation(async (taskId: string) => taskRegistry.increment(taskId, 'completed'))
})

describe('startResearchBatch', () => {
  it("researches at most the research step's concurrency at once, starting the next in the order chosen as one ends", async () => {
    const ends = controlledRuns()
    const ids = Array.from({ length: config.research.pipeline.concurrency + 2 }, (_, i) => `s${i}`)

    const { taskId } = startResearchBatch(ids)

    await vi.waitFor(() => expect(mockRuns.runInTask).toHaveBeenCalledTimes(config.research.pipeline.concurrency))
    expect(mockRuns.reserveEditorRun.mock.calls.map(([id]) => id)).toEqual(ids.slice(0, config.research.pipeline.concurrency))

    ends.get('run-s0')!()
    await vi.waitFor(() => expect(mockRuns.runInTask).toHaveBeenCalledTimes(config.research.pipeline.concurrency + 1))
    expect(mockRuns.reserveEditorRun).toHaveBeenLastCalledWith(ids[config.research.pipeline.concurrency])

    for (const id of ids.slice(1)) {
      await vi.waitFor(() => expect(ends.has(`run-${id}`)).toBe(true))
      ends.get(`run-${id}`)!()
    }
    expect(await finished(taskId)).toMatchObject({ type: 'research', status: 'completed', total: ids.length, completed: ids.length, skipped: [] })
  })

  it('skips a story its run path refuses, with the refusal as the reason, and researches the rest', async () => {
    mockRuns.reserveEditorRun.mockImplementation(async (storyId: string) => {
      if (storyId === 's2') throw new ConflictError('A research run of this story is already in progress')
      if (storyId === 's3') throw new NotFoundError('Story not found')
      return { runId: `run-${storyId}`, story: { id: storyId } }
    })

    const { taskId } = startResearchBatch(['s1', 's2', 's3', 's4'])

    expect(await finished(taskId)).toMatchObject({
      status: 'completed',
      total: 4,
      completed: 2,
      failed: 0,
      skipped: [
        { storyId: 's2', reason: 'A research run of this story is already in progress' },
        { storyId: 's3', reason: 'Story not found' },
      ],
    })
    expect(mockRuns.runInTask.mock.calls.map(([, runId]) => runId)).toEqual(['run-s1', 'run-s4'])
  })

  it("counts an unexpected error before a story's run as failed, naming no message, and goes on", async () => {
    mockRuns.reserveEditorRun.mockImplementation(async (storyId: string) => {
      if (storyId === 's1') throw new Error('connection to db:5432 lost')
      return { runId: `run-${storyId}`, story: { id: storyId } }
    })

    const { taskId } = startResearchBatch(['s1', 's2'])

    expect(await finished(taskId)).toMatchObject({ completed: 1, failed: 1, errors: ['unexpected error (Error)'], skipped: [] })
  })

  // The guarantee the single-story action gives: a run records itself and applies nothing
  it('runs each story with exactly its task, run and material, passing no hook to the run path, and never reaches an apply', async () => {
    const { taskId } = startResearchBatch(['s1', 's2'])
    await finished(taskId)

    expect(mockRuns.runInTask.mock.calls).toEqual([
      [taskId, 'run-s1', { id: 's1' }],
      [taskId, 'run-s2', { id: 's2' }],
    ])
    expect(mockRuns.runPipelineResearch).not.toHaveBeenCalled()
    expect(mockApply.applyResearchRun).not.toHaveBeenCalled()
    expect(mockApply.applyVerdict).not.toHaveBeenCalled()
  })

  it('takes a story chosen twice once', async () => {
    const { taskId } = startResearchBatch(['s1', 's1', 's2'])

    expect(await finished(taskId)).toMatchObject({ total: 2, completed: 2, storyIds: ['s1', 's2'] })
    expect(mockRuns.reserveEditorRun).toHaveBeenCalledTimes(2)
  })

  it('skips the stories another task is processing, leaving them out of its own', async () => {
    taskRegistry.create('assess', 1, ['s1'])

    const { taskId } = startResearchBatch(['s1', 's2'])

    expect(await finished(taskId)).toMatchObject({
      total: 2,
      completed: 1,
      storyIds: ['s2'],
      skipped: [{ storyId: 's1', reason: expect.stringMatching(/already being processed/i) }],
    })
    expect(mockRuns.reserveEditorRun).toHaveBeenCalledWith('s2')
    expect(mockRuns.reserveEditorRun).not.toHaveBeenCalledWith('s1')
  })

  it('refuses the batch when every story is being processed, creating no task', () => {
    taskRegistry.create('assess', 2, ['s1', 's2'])

    expect(thrown(() => startResearchBatch(['s1', 's2']))).toMatchObject({ status: 409, message: expect.stringMatching(/already being processed/) })
    expect(taskRegistry.getProcessingStoryIds().sort()).toEqual(['s1', 's2'])
    expect(mockRuns.reserveEditorRun).not.toHaveBeenCalled()
  })

  it('refuses the batch while research is switched off, creating no task', () => {
    mockRuns.switchRefusal.mockReturnValue('Research is switched off: TAVILY_API_KEY is not set')

    expect(thrown(() => startResearchBatch(['s1']))).toMatchObject({ status: 409, message: expect.stringMatching(/switched off/) })
    expect(taskRegistry.getProcessingStoryIds()).toEqual([])
    expect(mockRuns.reserveEditorRun).not.toHaveBeenCalled()
  })
})
