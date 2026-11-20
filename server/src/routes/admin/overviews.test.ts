/**
 * The overview admin endpoints hand each editor's action, with the editor's id, to the lifecycle and
 * answer with the services' results and refusals; what the actions and Undo do is
 * overviewEdits.test.ts's and overviewEdits.db.test.ts's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader } from '../../test/helpers.js'

const mockPrisma = vi.hoisted(() => ({ $disconnect: vi.fn() }))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))
const mockViews = vi.hoisted(() => ({ overviewsAdminState: vi.fn(), adminOverviewList: vi.fn(), adminOverview: vi.fn(), storyOverview: vi.fn() }))
vi.mock('../../services/overviewViews.js', () => mockViews)
const mockLifecycle = vi.hoisted(() => ({ editorAction: vi.fn(), undoDecision: vi.fn() }))
vi.mock('../../services/overviewLifecycle.js', () => mockLifecycle)

const { default: app } = await import('../../app.js')
const { ConflictError, NotFoundError } = await import('../../utils/errors.js')

const O = '00000000-0000-4000-8000-0000000000a1'
const STORY = '00000000-0000-4000-8000-000000000001'
const base = '/api/admin/overviews'
const EDITOR = 'test-admin-id'

beforeEach(() => {
  vi.clearAllMocks()
  mockLifecycle.editorAction.mockResolvedValue({ decisionId: 'd1' })
  mockLifecycle.undoDecision.mockResolvedValue({ decisionId: 'd2' })
})

describe('admin overview routes', () => {
  it('lists overviews by the filters given, as booleans and enums', async () => {
    mockViews.adminOverviewList.mockResolvedValue([])
    const res = await request(app).get(`${base}?scope=ongoing&frozen=true&hidden=false`).set(authHeader())
    expect(res.status).toBe(200)
    expect(mockViews.adminOverviewList).toHaveBeenCalledWith({ scope: 'ongoing', frozen: true, hidden: false })
    expect((await request(app).get(`${base}?scope=big`).set(authHeader())).status).toBe(400)
  })

  it('answers one overview and a story’s block, and 404 for an unknown one', async () => {
    mockViews.adminOverview.mockResolvedValue({ id: O })
    expect((await request(app).get(`${base}/${O}`).set(authHeader())).body).toEqual({ id: O })
    mockViews.storyOverview.mockResolvedValue({ on: false, count: 0 })
    expect((await request(app).get(`${base}/stories/${STORY}`).set(authHeader())).body).toEqual({ on: false, count: 0 })
    mockViews.adminOverview.mockRejectedValue(new NotFoundError('Overview not found'))
    const missing = await request(app).get(`${base}/${O}`).set(authHeader())
    expect([missing.status, missing.body.error]).toEqual([404, 'Overview not found'])
  })

  it("hands each editor's action to the lifecycle with the editor's id", async () => {
    const send = [
      request(app).post(`${base}/${O}/entries`).send({ storyId: STORY }),
      request(app).post(`${base}/${O}/entries/e1/detach`),
      request(app).put(`${base}/${O}/entries/e1/role`).send({ role: 'turning_point', roleKind: 'response' }),
      request(app).put(`${base}/${O}/title`).send({ title: '  Ebola in Ituri  ' }),
      request(app).put(`${base}/${O}/frozen`).send({ frozen: false }),
      request(app).put(`${base}/${O}/hidden`).send({ hidden: true }),
      request(app).put(`${base}/${O}/closed`).send({ closed: true }),
    ]
    const statuses = []
    for (const r of send) statuses.push((await r.set(authHeader())).status)
    expect(statuses).toEqual([201, 200, 200, 200, 200, 200, 200])
    expect(mockLifecycle.editorAction.mock.calls).toEqual([
      [{ kind: 'attach', overviewId: O, storyId: STORY, role: { role: 'routine', roleKind: null } }, EDITOR],
      [{ kind: 'detach', overviewId: O, entryId: 'e1' }, EDITOR],
      [{ kind: 'role', overviewId: O, entryId: 'e1', role: { role: 'turning_point', roleKind: 'response' } }, EDITOR],
      [{ kind: 'retitle', overviewId: O, title: 'Ebola in Ituri' }, EDITOR],
      [{ kind: 'freeze', overviewId: O, frozen: false }, EDITOR],
      [{ kind: 'hide', overviewId: O, hidden: true }, EDITOR],
      [{ kind: 'close', overviewId: O, closed: true }, EDITOR],
    ])
  })

  it('refuses a turning point without its kind, a blank title, and drops the kind of a routine entry', async () => {
    expect((await request(app).put(`${base}/${O}/entries/e1/role`).set(authHeader()).send({ role: 'turning_point' })).status).toBe(400)
    expect((await request(app).put(`${base}/${O}/title`).set(authHeader()).send({ title: '   ' })).status).toBe(400)
    await request(app).put(`${base}/${O}/entries/e1/role`).set(authHeader()).send({ role: 'routine', roleKind: 'spread' })
    expect(mockLifecycle.editorAction).toHaveBeenCalledWith({ kind: 'role', overviewId: O, entryId: 'e1', role: { role: 'routine', roleKind: null } }, EDITOR)
  })

  it("hands an editor's re-center on with the charter trimmed, none for no end event, and refuses one past the limits", async () => {
    const put = (body: object) => request(app).put(`${base}/${O}/charter`).set(authHeader()).send(body)
    const body = { title: ' Ebola in eastern Congo ', in: ' The outbreak. ', out: [' Mpox '], endEvent: null, anchorConfirmed: true }
    expect((await put(body)).status).toBe(200)
    expect(mockLifecycle.editorAction).toHaveBeenCalledWith(
      {
        kind: 'recenter',
        overviewId: O,
        title: 'Ebola in eastern Congo',
        charter: { in: 'The outbreak.', out: ['Mpox'], endEvent: null },
        anchorConfirmed: true,
      },
      EDITOR,
    )
    const refused = [
      { ...body, in: '  ' },
      { ...body, title: '' },
      { ...body, endEvent: '  ' },
      { ...body, out: ['x'.repeat(121)] },
      { ...body, out: Array.from({ length: 13 }, (_, i) => `o${i}`) },
      { ...body, anchorConfirmed: undefined },
      { title: 'T', in: 'I', out: [] },
    ]
    for (const b of refused) expect((await put(b)).status).toBe(400)
    mockLifecycle.editorAction.mockRejectedValue(new ConflictError('Confirm the anchor first'))
    const conflict = await put({ ...body, anchorConfirmed: false })
    expect([conflict.status, conflict.body.error]).toEqual([409, 'Confirm the anchor first'])
  })

  it('undoes a decision, and answers a refusal with its reason', async () => {
    const res = await request(app).post(`${base}/decisions/d1/undo`).set(authHeader())
    expect([res.status, res.body]).toEqual([200, { decisionId: 'd2' }])
    expect(mockLifecycle.undoDecision).toHaveBeenCalledWith('d1', EDITOR)
    mockLifecycle.undoDecision.mockRejectedValue(new ConflictError('This decision is already undone'))
    const refused = await request(app).post(`${base}/decisions/d1/undo`).set(authHeader())
    expect([refused.status, refused.body.error]).toEqual([409, 'This decision is already undone'])
  })

  it('needs a signed-in editor', async () => {
    expect((await request(app).get(base)).status).toBe(401)
  })
})
