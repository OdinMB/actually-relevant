/**
 * The research pass step's loop, with the queue's reads and the passes mocked, and the real state read
 * (`passStepState`, the real eval gate) on a mocked job row unless a test opens it: whether it runs at
 * all, what it takes, how it applies, when it stops, and that one story's failure does not end the
 * run. The queue's rule is researchPassQueue.db.test.ts's, a pass's claim and apply
 * researchPassRuns.db.test.ts's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ jobRun: { findUnique: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
const mockQueue = vi.hoisted(() => ({ nextForPass: vi.fn(), owedPassStory: vi.fn() }))
vi.mock('../services/researchPassQueue.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/researchPassQueue.js')>()
  return { ...actual, ...mockQueue, passStepState: vi.fn(actual.passStepState) }
})
const mockRuns = vi.hoisted(() => ({ markInterruptedPasses: vi.fn(), runPipelinePass: vi.fn(), recordSkippedPass: vi.fn() }))
vi.mock('../services/researchPassRuns.js', () => mockRuns)
const mockNotify = vi.hoisted(() => vi.fn())
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
// How many stories run at once is a constant, so the tests that need another set it here
const switches = vi.hoisted(() => ({ concurrency: undefined as number | undefined }))
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  const { concurrency } = actual.config.research.pass
  Object.defineProperty(actual.config.research.pass, 'concurrency', { get: () => switches.concurrency ?? concurrency })
  return actual
})

const { runResearchPassJob } = await import('./researchPass.js')
const { passStepState } = await import('../services/researchPassQueue.js')
const { createRunScope, runInScope } = await import('../lib/runUsage.js')
const { config } = await import('../config.js')

const readAt = (storyId: string) => new Date(`2026-11-18T0${'abcdef'.indexOf(storyId) + 1}:00:00Z`)
/** A pass that ran and applied as `applied` says, with its item tally. */
const passed = (applied: string, tally = { checked: 4, failed: 1 }) => ({
  outcome: 'passed',
  end: { ended: 'completed', outcome: 'researched', applied, triedTwice: false, tally },
})
const open = (enabled = true) => vi.mocked(passStepState).mockResolvedValue({ works: true, enabled })
const passedIds = () => mockRuns.runPipelinePass.mock.calls.map(c => c[0] as string)

async function inScope() {
  const scope = createRunScope({ jobName: 'research_pass', flex: false })
  await runInScope(scope, () => runResearchPassJob())
  return scope
}

beforeEach(() => {
  vi.clearAllMocks()
  // Back to the real state read (mockReset restores the implementation vi.fn was given)
  vi.mocked(passStepState).mockReset()
  switches.concurrency = undefined
  mockPrisma.jobRun.findUnique.mockResolvedValue({ enabled: true })
  mockQueue.nextForPass.mockResolvedValue(['a', 'b', 'c'])
  mockQueue.owedPassStory.mockImplementation(async (id: string) => ({ updatedAt: readAt(id) }))
  mockRuns.markInterruptedPasses.mockResolvedValue(0)
  mockRuns.runPipelinePass.mockResolvedValue(passed('applied'))
  mockRuns.recordSkippedPass.mockResolvedValue('pass-skipped')
  mockNotify.mockResolvedValue(undefined)
})

describe('runResearchPassJob', () => {
  it('runs no pass while the eval gate is closed, even with its job enabled: it marks cut-off passes and says why', async () => {
    const scope = await inScope()

    expect(mockRuns.markInterruptedPasses).toHaveBeenCalled()
    expect(mockQueue.nextForPass).not.toHaveBeenCalled()
    expect(mockRuns.runPipelinePass).not.toHaveBeenCalled()
    expect(scope.summary).toMatch(/^Research passes are switched off: their evals have not yet met the plan's bars.*; nothing researched$/)
  })

  it('runs no pass while its job is disabled, so a run by hand of the disabled job does nothing', async () => {
    open(false)
    const scope = await inScope()

    expect(mockRuns.runPipelinePass).not.toHaveBeenCalled()
    expect(scope.summary).toBe('Research passes are switched off: the research_pass job is disabled on the Jobs page; nothing researched')
  })

  it('takes the queue at the per-run limit and gives each story its pass, fenced on the story as read before it', async () => {
    open()
    mockRuns.runPipelinePass.mockImplementation(async (id: string) => passed(id === 'b' ? 'rejected' : 'applied'))
    const scope = await inScope()

    expect(mockQueue.nextForPass).toHaveBeenCalledWith(config.research.pass.perRun)
    expect(mockRuns.runPipelinePass.mock.calls.map(c => c.slice(0, 2))).toEqual(['a', 'b', 'c'].map(id => [id, { status: 'selected', updatedAt: readAt(id) }]))
    expect(scope.summary).toBe('Researched 3 stories: 2 applied, 1 rejected, 0 failed')
    // The cards' and the article's checked items, for the failure share
    expect(scope.usage).toMatchObject({ itemsChecked: 12, itemsFailed: 3 })
  })

  it("re-reads the step's state when a pass ends, so a pass that ends after the switch-off is not applied", async () => {
    open()
    mockQueue.nextForPass.mockResolvedValue(['a'])
    let applies: boolean | null = null
    mockRuns.runPipelinePass.mockImplementation(async (_id: string, _read: unknown, check: () => Promise<boolean>) => {
      vi.mocked(passStepState).mockResolvedValue({ works: true, enabled: false })
      applies = await check()
      return passed('stored')
    })
    await inScope()

    expect(applies).toBe(false)
  })

  it('starts no other story once the step is switched off, and says how many are left', async () => {
    open()
    switches.concurrency = 1
    mockRuns.runPipelinePass.mockImplementation(async () => {
      vi.mocked(passStepState).mockResolvedValue({ works: true, enabled: false })
      return passed('applied')
    })
    const scope = await inScope()

    expect(passedIds()).toEqual(['a'])
    expect(scope.summary).toBe('Researched 1 story: 1 applied, 0 rejected, 0 failed, 2 left for the next run')
  })

  it('skips a story no longer owed (an editor published or researched it meanwhile)', async () => {
    open()
    mockQueue.owedPassStory.mockImplementation(async (id: string) => (id === 'b' ? null : { updatedAt: readAt(id) }))
    await inScope()

    expect(passedIds()).toEqual(['a', 'c'])
  })

  it('records a $0 skipped pass for a story whose turn failed outside its pass, and goes on with the next', async () => {
    open()
    mockRuns.runPipelinePass.mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('database gone')
      return passed('applied')
    })
    const scope = await inScope()

    // Its reason sanitized, as research's are (no message text that might carry a key)
    expect(mockRuns.recordSkippedPass).toHaveBeenCalledWith('b', expect.any(String))
    expect(passedIds()).toEqual(['a', 'b', 'c'])
    expect(scope.summary).toBe('Researched 3 stories: 2 applied, 0 rejected, 1 failed')
  })

  it('says nothing was there to research on an empty queue', async () => {
    open()
    mockQueue.nextForPass.mockResolvedValue([])
    const scope = await inScope()

    expect(scope.summary).toBe('Nothing to research')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('records the failed-stories notice when more than the failure share of enough stories failed technically, and none below it', async () => {
    open()
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, config.research.pass.failedStoriesMin + 1)
    mockQueue.nextForPass.mockResolvedValue(ids)
    const failing = new Set(ids.slice(0, Math.floor(ids.length * config.jobs.failureShare.share) + 1))
    mockRuns.runPipelinePass.mockImplementation(async (id: string) =>
      failing.has(id) ? { outcome: 'passed', end: { ended: 'error', error: 'model down' } } : passed('applied'),
    )
    await inScope()

    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'jobs', severity: 'warning', link: '/admin/jobs', dedupeKey: 'stories-failing:research_pass' }),
    )

    mockNotify.mockClear()
    mockRuns.runPipelinePass.mockResolvedValue(passed('applied'))
    await inScope()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('counts a refused story (the cap, a story it cannot research) and a busy one apart from the failures', async () => {
    open()
    mockQueue.nextForPass.mockResolvedValue(['a', 'b', 'c', 'd'])
    mockRuns.runPipelinePass.mockImplementation(async (id: string) =>
      id === 'a'
        ? { outcome: 'refused', reason: 'monthly cap reached' }
        : id === 'b'
          ? { outcome: 'busy' }
          : id === 'c'
            ? { outcome: 'passed', end: { ended: 'skipped', reason: 'the story lacks the analysis research needs' } }
            : passed('applied'),
    )
    const scope = await inScope()

    expect(scope.summary).toBe('Researched 4 stories: 1 applied, 0 rejected, 0 failed, 2 skipped, 1 already being researched')
  })

  it('counts the passes that stored their rows without changing the story (a fallback, an unchanged later pass) as not applied', async () => {
    open()
    mockRuns.runPipelinePass.mockImplementation(async (id: string) => passed(id === 'a' ? 'stored' : id === 'b' ? 'skipped' : 'applied'))
    const scope = await inScope()

    expect(scope.summary).toBe('Researched 3 stories: 1 applied, 0 rejected, 0 failed, 2 not applied')
  })
})
