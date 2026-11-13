import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { authHeader } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// The reservation's SQL guarantees (cap, one run per story, finishing) are researchRuns.db.test.ts's;
// here the database is a mock, to check what each request answers.
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  storyResearchRun: { updateMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
}))
const mockPrisma = vi.hoisted(() => ({
  story: { findUnique: vi.fn() },
  storyResearchRun: { updateMany: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
}))
const mockInput = vi.hoisted(() => ({ researchStoriesByIds: vi.fn() }))
const mockPipeline = vi.hoisted(() => ({ researchStory: vi.fn() }))
const mockApply = vi.hoisted(() => ({ applyResearchRun: vi.fn(), revertResearch: vi.fn(), applyRefusal: vi.fn() }))

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))
vi.mock('../../services/researchInput.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/researchInput.js')>()),
  ...mockInput,
}))
vi.mock('../../services/researchPipeline.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/researchPipeline.js')>()),
  ...mockPipeline,
}))
vi.mock('../../services/researchApply.js', () => mockApply)

const { default: app } = await import('../../app.js')
const { ConflictError } = await import('../../utils/errors.js')
const { taskRegistry } = await import('../../lib/taskRegistry.js')
const { config } = await import('../../config.js')

const STORY = 'story-1'
const start = () => request(app).post(`/api/admin/research/stories/${STORY}/runs`).set(authHeader())

const flagged = {
  label: 'Story paragraph 2',
  text: 'A paragraph.',
  problem: 'renders S1F2 closely',
  kind: 'copying',
  by: 'judge',
  sourceId: 'S1',
  copiedSentence: 'S1F2',
}
const storedResult = {
  storyId: STORY,
  calls: [{ step: 'write', outcome: 'ok', usage: { input: 1000, cached: 0, output: 100, reasoning: 0 }, costUsd: 0.02, model: 'gpt-6-luna' }],
  credits: 2,
  problems: [flagged],
  checks: [
    { problems: [flagged], longestRuns: [{ label: 'Story paragraph 2', sourceId: 'S1', against: 'wording', words: 7 }] },
    { problems: [flagged], longestRuns: [] },
  ],
  failedOn: null,
  verdict: { kind: 'keep' },
  prices: { models: {}, cacheWriteFactor: 1.25, tavilyUsdPerCredit: 0.008 },
}
const row = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  storyId: STORY,
  status: 'completed',
  verdict: 'keep',
  costUsd: 0.036,
  tavilyCredits: 2,
  result: storedResult,
  error: null,
  startedAt: new Date('2026-11-12T10:00:00Z'),
  finishedAt: new Date('2026-11-12T10:01:00Z'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  taskRegistry.clear()
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
  mockPrisma.story.findUnique.mockResolvedValue({ status: 'analyzed' })
  mockInput.researchStoriesByIds.mockResolvedValue([{ id: STORY }])
  mockPipeline.researchStory.mockReturnValue(new Promise(() => {}))
  mockPrisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  tx.storyResearchRun.count.mockResolvedValue(0)
  tx.storyResearchRun.aggregate.mockResolvedValue({ _sum: { costUsd: 1 } })
  tx.storyResearchRun.create.mockResolvedValue({ id: 'run-1' })
  mockPrisma.storyResearchRun.aggregate.mockResolvedValue({ _sum: { costUsd: 1.5 } })
  mockPrisma.$queryRaw.mockResolvedValue([])
  mockApply.applyResearchRun.mockResolvedValue('applied')
  mockApply.revertResearch.mockResolvedValue(undefined)
  mockApply.applyRefusal.mockReturnValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/admin/research/stories/:storyId/runs', () => {
  it('answers 202 with the task and the run, and counts the story as processing', async () => {
    const res = await start()
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ taskId: expect.any(String), runId: 'run-1' })
    expect(taskRegistry.get(res.body.taskId)).toMatchObject({ type: 'research', total: 1, storyIds: [STORY] })
    expect(taskRegistry.getProcessingStoryIds()).toEqual([STORY])
  })

  it('answers 404 for an unknown story', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(null)
    const res = await start()
    expect(res.status).toBe(404)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['an ineligible status', () => mockPrisma.story.findUnique.mockResolvedValue({ status: 'rejected' }), /analyzed, selected or published/],
    ['research switched off', () => vi.stubEnv('TAVILY_API_KEY', ''), /switched off/],
    ['a story without the analysis research needs', () => mockInput.researchStoriesByIds.mockResolvedValue([]), /lacks the analysis/],
    ['the cap', () => tx.storyResearchRun.aggregate.mockResolvedValue({ _sum: { costUsd: config.research.monthlyCapUsd } }), /cap is reached/],
    ['a run already in progress', () => tx.storyResearchRun.count.mockResolvedValue(1), /already in progress/],
  ])('answers 409 for %s, starting nothing', async (_name, arrange, message) => {
    arrange()
    const res = await start()
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(message)
    expect(tx.storyResearchRun.create).not.toHaveBeenCalled()
    expect(mockPipeline.researchStory).not.toHaveBeenCalled()
  })

  it('reserves nothing for a story refused before the transaction', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ status: 'fetched' })
    await start()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/research/stories/:storyId/runs', () => {
  it('lists the runs with a cost summary for each that has a result', async () => {
    mockPrisma.storyResearchRun.findMany.mockResolvedValue([
      row(),
      row({ id: 'run-0', status: 'failed', verdict: null, result: null, costUsd: 0.25, error: 'unexpected error (Error)' }),
    ])
    const res = await request(app).get(`/api/admin/research/stories/${STORY}/runs`).set(authHeader())
    expect(res.status).toBe(200)
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(['run-1', 'run-0'])
    expect(res.body[0]).toMatchObject({
      status: 'completed',
      startedAt: '2026-11-12T10:00:00.000Z',
      cost: { totalUsd: expect.closeTo(0.036, 10), tavily: { credits: 2, usd: expect.closeTo(0.016, 10) } },
    })
    expect(res.body[1]).toMatchObject({ status: 'failed', cost: null, result: null })
    expect(mockPrisma.storyResearchRun.updateMany).toHaveBeenCalled()
  })

  // The client's mirror (`ResearchResult` in shared/types) reads these: each check pass, the item a fallback failed on, each problem's cause
  it("serves the run's check passes, the item a fallback failed on and each problem's cause", async () => {
    mockPrisma.storyResearchRun.findMany.mockResolvedValue([row()])
    const res = await request(app).get(`/api/admin/research/stories/${STORY}/runs`).set(authHeader())
    expect(res.body[0].result).toMatchObject({
      problems: [{ label: 'Story paragraph 2', kind: 'copying', by: 'judge', sourceId: 'S1', copiedSentence: 'S1F2' }],
      checks: [
        { problems: [{ kind: 'copying', by: 'judge' }], longestRuns: [{ label: 'Story paragraph 2', sourceId: 'S1', against: 'wording', words: 7 }] },
        {},
      ],
      failedOn: null,
    })
  })
})

// What applying and reverting write is researchApply's tests'; here, what each request answers
describe('POST /api/admin/research/stories/:storyId/runs/:runId/apply and /revert', () => {
  const apply = () => request(app).post(`/api/admin/research/stories/${STORY}/runs/run-1/apply`).set(authHeader())
  const revert = () => request(app).post(`/api/admin/research/stories/${STORY}/revert`).set(authHeader())

  it("puts the run's researched version on the story as the editor, answering 204", async () => {
    const res = await apply()
    expect(res.status).toBe(204)
    expect(mockApply.applyResearchRun).toHaveBeenCalledWith(STORY, 'run-1')
  })

  it('reverts the story to single-source, answering 204', async () => {
    const res = await revert()
    expect(res.status).toBe(204)
    expect(mockApply.revertResearch).toHaveBeenCalledWith(STORY)
  })

  it.each([
    ['apply', apply, mockApply.applyResearchRun],
    ['revert', revert, mockApply.revertResearch],
  ])('answers a refusal of %s with its status and reason', async (_name, send, service) => {
    service.mockRejectedValue(new ConflictError('A trashed story cannot be reverted: restore it first'))
    const res = await send()
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A trashed story cannot be reverted: restore it first' })
  })

  it('answers 500 with its own text when the embedding fails', async () => {
    mockApply.applyResearchRun.mockRejectedValue(new Error('openai down'))
    const res = await apply()
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to apply the research')
  })

  it('needs a signed-in editor or admin', async () => {
    expect((await request(app).post(`/api/admin/research/stories/${STORY}/revert`)).status).toBe(401)
    expect(mockApply.revertResearch).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/research/usage', () => {
  it("reports the month to date, the cap, the reservation, the month's fallbacks by category and why no run can be applied now", async () => {
    mockApply.applyRefusal.mockReturnValue('Applying research is off')
    // As the database groups them; a category the code does not know counts as unrecorded
    mockPrisma.$queryRaw.mockResolvedValue([
      { category: 'not_confirmed', runs: 3 },
      { category: null, runs: 1 },
      { category: 'something-else', runs: 1 },
    ])
    const res = await request(app).get('/api/admin/research/usage').set(authHeader())
    expect(res.body).toEqual({
      enabled: true,
      refusal: null,
      applyRefusal: 'Applying research is off',
      monthToDateUsd: 1.5,
      monthlyCapUsd: config.research.monthlyCapUsd,
      reservationUsd: config.research.maxRunUsd,
      fallbacksThisMonth: { no_other_coverage: 0, not_confirmed: 3, draft_failed_check: 0, technical: 0, unrecorded: 2 },
    })
  })

  it('reports research switched off without the key', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    const res = await request(app).get('/api/admin/research/usage').set(authHeader())
    expect(res.body).toMatchObject({ enabled: false, refusal: expect.stringMatching(/switched off/) })
  })

  it('reports the cap as the refusal once a run would pass it', async () => {
    mockPrisma.storyResearchRun.aggregate.mockResolvedValue({ _sum: { costUsd: config.research.monthlyCapUsd - 0.1 } })
    const res = await request(app).get('/api/admin/research/usage').set(authHeader())
    expect(res.body).toMatchObject({ enabled: true, refusal: expect.stringMatching(/cap is reached/) })
  })

  it('needs a signed-in editor or admin', async () => {
    expect((await request(app).get('/api/admin/research/usage')).status).toBe(401)
  })
})
