import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { authHeader } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// The sums, the levels and the notices are spending.db.test.ts's; here the database is a mock, to check what each request answers
const mockPrisma = vi.hoisted(() => ({
  jobMonthSpend: { findMany: vi.fn() },
  storyResearchRun: { findMany: vi.fn() },
  spendWarning: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  podcastTtsUsage: { aggregate: vi.fn() },
  jobRun: { count: vi.fn() },
  $disconnect: vi.fn(),
}))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))

const { default: app } = await import('../../app.js')

const putLevel = (scope: string, body: unknown) => request(app).put(`/api/admin/spending/warnings/${scope}`).set(authHeader()).send(body)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'))
  mockPrisma.jobMonthSpend.findMany.mockResolvedValue([
    { jobName: 'research_stories', month: new Date('2026-11-01T00:00:00Z'), costUsd: 14.2, standardCostUsd: 20, searchUsd: 8.6, searchCredits: 1075, runs: 16 },
    { jobName: 'research_stories', month: new Date('2026-10-01T00:00:00Z'), costUsd: 22.4, standardCostUsd: 30, searchUsd: 9, searchCredits: 1125, runs: 31 },
  ])
  mockPrisma.storyResearchRun.findMany.mockResolvedValue([])
  mockPrisma.spendWarning.findMany.mockResolvedValue([{ scope: 'research_stories', levelUsd: 25 }])
  mockPrisma.podcastTtsUsage.aggregate.mockResolvedValue({ _sum: { chars: 18_400 } })
  mockPrisma.jobRun.count.mockResolvedValue(0)
})
afterEach(() => vi.useRealTimers())

describe('GET /api/admin/spending', () => {
  it("answers this month's overview: the days, the grouped rows with pace and levels, the total and the voices", async () => {
    const res = await request(app).get('/api/admin/spending').set(authHeader())

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      month: '2026-11',
      previousMonths: ['2026-10', '2026-09'],
      day: 16,
      daysInMonth: 30,
      voices: { usedChars: 18_400 },
      total: { scope: 'all', thisMonth: { totalUsd: 14.2 }, previousUsd: [22.4, 0], levelUsd: null, warning: null },
    })
    const daily = res.body.groups.find((g: { chain: string | null }) => g.chain === 'daily_edition_chain')
    expect(daily.rows).toContainEqual({
      scope: 'research_stories',
      thisMonth: { aiUsd: expect.closeTo(5.6, 6), searchUsd: 8.6, totalUsd: 14.2 },
      paceUsd: expect.closeTo(26.625, 6),
      previousUsd: [22.4, 0],
      levelUsd: 25,
      warning: 'on_pace',
    })
  })

  it('needs a signed-in editor or admin', async () => {
    expect((await request(app).get('/api/admin/spending')).status).toBe(401)
  })
})

describe('PUT /api/admin/spending/warnings/:scope', () => {
  it('sets a level in whole dollars', async () => {
    const res = await putLevel('research_stories', { levelUsd: 30 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ scope: 'research_stories', levelUsd: 30 })
    expect(mockPrisma.spendWarning.upsert).toHaveBeenCalledWith({
      where: { scope: 'research_stories' },
      create: { scope: 'research_stories', levelUsd: 30 },
      update: { levelUsd: 30 },
    })
  })

  it('clears a level with null', async () => {
    const res = await putLevel('all', { levelUsd: null })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ scope: 'all', levelUsd: null })
    expect(mockPrisma.spendWarning.deleteMany).toHaveBeenCalledWith({ where: { scope: 'all' } })
  })

  it.each([
    ['zero', { levelUsd: 0 }],
    ['a fraction', { levelUsd: 12.5 }],
    ['a string', { levelUsd: '12' }],
    ['no level', {}],
  ])('answers 400 for %s, saving nothing', async (_name, body) => {
    expect((await putLevel('research_stories', body)).status).toBe(400)
    expect(mockPrisma.spendWarning.upsert).not.toHaveBeenCalled()
  })

  it('answers 400 for a scope that is no job, and for a chain, saving nothing', async () => {
    for (const scope of ['no_such_job', 'daily_edition_chain']) {
      const res = await putLevel(scope, { levelUsd: 5 })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(new RegExp(scope))
    }
    expect(mockPrisma.spendWarning.upsert).not.toHaveBeenCalled()
  })

  it('needs a signed-in editor or admin', async () => {
    expect((await request(app).put('/api/admin/spending/warnings/all').send({ levelUsd: 5 })).status).toBe(401)
  })
})
