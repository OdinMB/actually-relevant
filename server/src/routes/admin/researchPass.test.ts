/**
 * The research pass endpoints answer with the services' results and refusals; what the services do
 * (the claim, the cap, the apply, the undo) is researchPassRuns.db.test.ts's and articleVersions'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const mockPrisma = vi.hoisted(() => ({ $disconnect: vi.fn() }))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))
const mockViews = vi.hoisted(() => ({ passUsage: vi.fn(), storyPasses: vi.fn() }))
vi.mock('../../services/researchPassViews.js', () => mockViews)
const mockRuns = vi.hoisted(() => ({ startEditorPass: vi.fn(), startEditorPassBatch: vi.fn() }))
vi.mock('../../services/researchPassRuns.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/researchPassRuns.js')>()),
  ...mockRuns,
}))
const mockApply = vi.hoisted(() => ({ undoUpdate: vi.fn() }))
vi.mock('../../services/researchApply.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/researchApply.js')>()),
  ...mockApply,
}))

const { default: app } = await import('../../app.js')
const { ConflictError, NotFoundError } = await import('../../utils/errors.js')
const { config } = await import('../../config.js')

const STORY = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const base = '/api/admin/research-passes'

beforeEach(() => vi.clearAllMocks())

describe('admin research pass routes', () => {
  it("answers the month's spend under the cap and why no pass can start", async () => {
    const usage = { spentUsd: 3.2, capUsd: 30, firstPassUsd: 0.4, laterPassUsd: 0.25, refusal: 'Research passes are switched off: …' }
    mockViews.passUsage.mockResolvedValue(usage)

    const res = await request(app).get(`${base}/usage`).set(authHeader())
    expect(res.status).toBe(200)
    expect(res.body).toEqual(usage)
  })

  it("answers a story's passes, versions, pool and legacy runs, and 404 for an unknown story", async () => {
    const view = { passes: [], versions: [], pool: { sources: [], facts: [], searches: [], dropped: [] }, legacyRuns: [] }
    mockViews.storyPasses.mockResolvedValue(view)
    const res = await request(app).get(`${base}/stories/${STORY}`).set(authHeader())
    expect(res.status).toBe(200)
    expect(res.body).toEqual(view)
    expect(mockViews.storyPasses).toHaveBeenCalledWith(STORY)

    mockViews.storyPasses.mockRejectedValue(new NotFoundError('Story not found'))
    expect((await request(app).get(`${base}/stories/${STORY}`).set(authHeader())).status).toBe(404)
  })

  it("starts an editor's pass in the background (202 with its task), or answers the refusal", async () => {
    mockRuns.startEditorPass.mockResolvedValue({ taskId: 'task-1', passId: 'pass-1' })
    const started = await request(app).post(`${base}/stories/${STORY}/passes`).set(authHeader())
    expect(started.status).toBe(202)
    expect(started.body).toEqual({ taskId: 'task-1', passId: 'pass-1' })

    mockRuns.startEditorPass.mockRejectedValue(new ConflictError('Research passes are switched off: their evals have not yet met the bars'))
    const refused = await request(app).post(`${base}/stories/${STORY}/passes`).set(authHeader())
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(/switched off/)
  })

  it('starts a bulk pass over the chosen stories as one task, and refuses more than the bulk limit', async () => {
    mockRuns.startEditorPassBatch.mockResolvedValue({ taskId: 'task-2' })
    const started = await request(app)
      .post(`${base}/passes`)
      .set(authHeader())
      .send({ storyIds: [STORY, OTHER] })
    expect(started.status).toBe(202)
    expect(started.body).toEqual({ taskId: 'task-2' })
    expect(mockRuns.startEditorPassBatch).toHaveBeenCalledWith([STORY, OTHER])

    const tooMany = Array.from({ length: config.research.bulkMaxStories + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const refused = await request(app).post(`${base}/passes`).set(authHeader()).send({ storyIds: tooMany })
    expect(refused.status).toBe(400)
    expect(mockRuns.startEditorPassBatch).toHaveBeenCalledTimes(1)
  })

  it('undoes the current update (204), or answers why there is none to undo', async () => {
    mockApply.undoUpdate.mockResolvedValue(undefined)
    const undone = await request(app).post(`${base}/stories/${STORY}/undo`).set(authHeader())
    expect(undone.status).toBe(204)
    expect(mockApply.undoUpdate).toHaveBeenCalledWith(STORY)

    mockApply.undoUpdate.mockRejectedValue(new ConflictError('Only an update can be undone; the current version is the first researched one'))
    expect((await request(app).post(`${base}/stories/${STORY}/undo`).set(authHeader())).status).toBe(409)
  })

  it('requires a signed-in editor', async () => {
    expect((await request(app).get(`${base}/usage`)).status).toBe(401)
  })
})
