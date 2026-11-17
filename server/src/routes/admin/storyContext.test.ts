import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// What the services do is storyContextAdmin.db.test.ts's; here they are mocks, to check what each request answers
const mocks = vi.hoisted(() => ({ getContextAdmin: vi.fn(), setContextHidden: vi.fn(), updateContextBox: vi.fn() }))
vi.mock('../../services/storyContextAdmin.js', () => mocks)
vi.mock('../../lib/prisma.js', () => ({ default: { $disconnect: vi.fn() } }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))

const { default: app } = await import('../../app.js')
const { BadRequestError, NotFoundError } = await import('../../utils/errors.js')

beforeEach(() => vi.clearAllMocks())

describe('GET /api/admin/stories/:id/context', () => {
  it("answers the story's context", async () => {
    mocks.getContextAdmin.mockResolvedValue({ run: null, boxes: [], places: [], placement: 'model' })
    const res = await request(app).get('/api/admin/stories/story-1/context').set(authHeader())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ run: null, boxes: [], places: [], placement: 'model' })
    expect(mocks.getContextAdmin).toHaveBeenCalledWith('story-1')
  })

  it('answers 404 for an unknown story, and needs a signed-in editor', async () => {
    mocks.getContextAdmin.mockRejectedValue(new NotFoundError('Story not found'))
    expect((await request(app).get('/api/admin/stories/nope/context').set(authHeader())).status).toBe(404)
    expect((await request(app).get('/api/admin/stories/nope/context')).status).toBe(401)
  })
})

describe('PUT /api/admin/stories/:id/context', () => {
  it('hides or shows all of it', async () => {
    const res = await request(app).put('/api/admin/stories/story-1/context').set(authHeader()).send({ hidden: true })
    expect(res.status).toBe(204)
    expect(mocks.setContextHidden).toHaveBeenCalledWith('story-1', true)
  })

  it('refuses a body without a boolean hidden', async () => {
    expect((await request(app).put('/api/admin/stories/story-1/context').set(authHeader()).send({ hidden: 'yes' })).status).toBe(400)
    expect(mocks.setContextHidden).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/stories/:id/context/boxes/:boxId', () => {
  const patch = (body: unknown) => request(app).patch('/api/admin/stories/story-1/context/boxes/box-1').set(authHeader()).send(body)

  it('hides, shows or moves one box', async () => {
    expect((await patch({ hidden: false, place: 'W2' })).status).toBe(204)
    expect(mocks.updateContextBox).toHaveBeenCalledWith('story-1', 'box-1', { hidden: false, place: 'W2' })
  })

  it('refuses an empty change and a place that is no paragraph, point or section', async () => {
    expect((await patch({})).status).toBe(400)
    expect((await patch({ place: 'P0' })).status).toBe(400)
    expect((await patch({ place: 'margin' })).status).toBe(400)
    expect(mocks.updateContextBox).not.toHaveBeenCalled()
  })

  it("answers the service's 400 for a place the story lacks and 404 for an unknown box", async () => {
    mocks.updateContextBox.mockRejectedValueOnce(new BadRequestError('The story has no P4')).mockRejectedValueOnce(new NotFoundError('Context box not found'))
    expect((await patch({ place: 'P4' })).status).toBe(400)
    expect((await patch({ hidden: true })).status).toBe(404)
  })
})
