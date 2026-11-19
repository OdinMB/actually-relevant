import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkStory, OverviewState } from '../services/overviewTypes.js'

const gates = vi.hoisted(() => ({ overview: 'closed' as string | null, pass: 'closed' as string | null }))
const mockJobRun = vi.hoisted(() => ({ findUnique: vi.fn() }))
const mocks = vi.hoisted(() => ({
  owedStories: vi.fn(),
  linkStories: vi.fn(),
  nearestPublished: vi.fn(),
  applyLink: vi.fn(),
  structuredCall: vi.fn(),
  recordItems: vi.fn(),
  reportRunResult: vi.fn(),
  notify: vi.fn(),
  overviewStates: vi.fn(),
  standsCases: vi.fn(),
  applyStatus: vi.fn(),
  applyStands: vi.fn(),
}))

vi.mock('../services/overviewGate.js', () => ({
  get OVERVIEW_EVAL_GATE() {
    return gates.overview
  },
}))
vi.mock('../services/researchPassGate.js', () => ({
  get PASS_EVAL_GATE() {
    return gates.pass
  },
}))
vi.mock('../lib/prisma.js', () => ({ default: { jobRun: mockJobRun } }))
vi.mock('../lib/notify.js', () => ({ notify: mocks.notify }))
vi.mock('../services/overviewQueue.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/overviewQueue.js')>()),
  owedStories: mocks.owedStories,
}))
vi.mock('../services/overviewInput.js', () => ({ linkStories: mocks.linkStories, candidateOverviews: async () => [] }))
vi.mock('../services/overviewCandidates.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/overviewCandidates.js')>()),
  nearestPublished: mocks.nearestPublished,
  membershipsOf: async () => ({ active: new Map(), lockedOut: new Map() }),
}))
vi.mock('../services/overviewLifecycle.js', () => ({
  applyLink: mocks.applyLink,
  applyStatus: mocks.applyStatus,
  applyStands: mocks.applyStands,
  applyClosing: vi.fn(),
  applyBurst: vi.fn(),
  applyReview: vi.fn(),
  applyAudit: vi.fn(),
}))
vi.mock('../services/overviewUpkeepInput.js', () => ({
  pendingClosings: async () => [],
  overviewStates: mocks.overviewStates,
  reviewCase: async () => null,
  auditPicks: async () => [],
  standsCases: mocks.standsCases,
}))
vi.mock('../services/structuredCall.js', () => ({ structuredCall: mocks.structuredCall }))
vi.mock('../lib/runUsage.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/runUsage.js')>()),
  recordItems: mocks.recordItems,
  reportRunResult: mocks.reportRunResult,
}))

const { linkSummary, productionUpkeepDeps, runLinkOverviewsJob, upkeepClock, upkeepSummary } = await import('./linkOverviews.js')

const story = (id: string, day: number): LinkStory => ({
  id,
  title: `Title ${id}`,
  label: 'Label',
  summary: 'Summary.',
  datePublished: new Date(Date.UTC(2026, 5, day)),
  date: `2026-06-${String(day).padStart(2, '0')}`,
  issueId: null,
  facts: [],
})

describe('runLinkOverviewsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gates.overview = 'closed'
    gates.pass = 'closed'
    mockJobRun.findUnique.mockResolvedValue({ enabled: true })
    mocks.nearestPublished.mockResolvedValue([])
    mocks.applyLink.mockImplementation(async (result: { outcome: string }) => ({ kind: 'written', outcome: result.outcome }))
    mocks.overviewStates.mockResolvedValue([])
    mocks.standsCases.mockResolvedValue([])
  })

  it('does nothing while its gate is closed, or research passes’ gate is, or its job is disabled', async () => {
    await runLinkOverviewsJob()
    expect(mocks.reportRunResult).toHaveBeenLastCalledWith(expect.stringMatching(/^Overviews are switched off: closed; nothing linked$/))
    gates.overview = null
    await runLinkOverviewsJob()
    expect(mocks.reportRunResult).toHaveBeenLastCalledWith(expect.stringMatching(/until research passes are on.*nothing linked$/))
    gates.pass = null
    mockJobRun.findUnique.mockResolvedValue({ enabled: false })
    await runLinkOverviewsJob()
    expect(mocks.reportRunResult).toHaveBeenLastCalledWith(expect.stringMatching(/link_overviews job is disabled.*nothing linked$/))
    expect(mocks.owedStories).not.toHaveBeenCalled()
    expect(mockJobRun.findUnique).toHaveBeenCalledWith({ where: { jobName: 'link_overviews' }, select: { enabled: true } })
  })

  it('links the backlog slice first, then the night, and records the tally and the summary', async () => {
    gates.overview = null
    gates.pass = null
    const [b1, b2, n1, partner] = [story('b1', 1), story('b2', 2), story('n1', 9), story('p', 1)]
    mocks.owedStories.mockResolvedValue({ backlog: ['b1', 'b2'], night: ['n1'], backlogTotal: 2 })
    mocks.linkStories.mockImplementation(async (_db: unknown, ids: string[]) => [b1, b2, n1, partner].filter(s => ids.includes(s.id)))
    // b2 has a partner; the model's yes for it quotes nothing the partner says, so code refuses it
    mocks.nearestPublished.mockImplementation(async (_db: unknown, id: string) =>
      id === 'b2' ? [{ id: 'p', distance: 0.1, datePublished: partner.datePublished, via: 'near' }] : [],
    )
    const quote = { story: 'Title', other: 'nothing like it' }
    mocks.structuredCall.mockResolvedValue({
      parsed: {
        candidates: [{ id: 'F1', belongs: 'yes', cause: quote, place: quote, end: quote, reportsEndEvent: false, confidence: 0.7 }],
        role: 'routine',
        roleKind: null,
      },
      costUsd: 0.001,
      model: 'small-model',
      outcome: 'ok',
    })
    await runLinkOverviewsJob(new Date('2026-06-10T02:00:00Z'))
    expect(mocks.linkStories).toHaveBeenCalledWith(expect.anything(), ['b1', 'b2', 'n1'])
    expect(mocks.applyLink.mock.calls.map(([r]) => (r as { story: LinkStory }).story.id)).toEqual(['b1', 'b2', 'n1'])
    expect(mocks.recordItems).toHaveBeenCalledWith(1, 1)
    expect(mocks.reportRunResult).toHaveBeenCalledWith('Linked 3 stories: 0 joined, 0 founded, 3 alone; backfill 2 of 2; 0 overviews refreshed, 0 reviewed')
  })

  it('runs the upkeep when nothing is owed, its status moves in development time and its stands checks in the tally', async () => {
    gates.overview = null
    gates.pass = null
    mocks.owedStories.mockResolvedValue({ backlog: [], night: [], backlogTotal: 0 })
    mocks.linkStories.mockResolvedValue([])
    const quiet: OverviewState = {
      id: 'o1',
      scope: 'ongoing',
      status: 'open',
      closedReason: null,
      frozen: false,
      hidden: false,
      lastEntryAt: new Date('2026-05-01T00:00:00Z'),
      closingSince: null,
      closingStoryId: null,
      activeEntries: 3,
      unpublished: [],
      entriesAtLastReview: 3,
      reviewedAt: new Date('2026-06-01T00:00:00Z'),
      burstJoins: 0,
      burstAt: null,
      closureReviewed: false,
      reopenedAt: null,
      reportAt: null,
    }
    mocks.overviewStates.mockResolvedValue([quiet])
    await runLinkOverviewsJob(new Date('2026-06-10T02:00:00Z'))
    expect(mocks.applyStatus).toHaveBeenCalledWith(quiet, [{ kind: 'status', from: 'open', to: 'quiet', reason: 'quiet' }], new Date('2026-06-10T02:00:00Z'))
    expect(mocks.recordItems).toHaveBeenCalledWith(0, 0)
    expect(mocks.reportRunResult).toHaveBeenCalledWith('Nothing to link; 0 overviews refreshed, 0 reviewed')
  })
})

describe('the upkeep clock and summary', () => {
  const now = new Date('2026-11-18T03:00:00Z')

  it('counts in the newest linked story’s time while a backfill drains, and in now once it is done', () => {
    const linked = [story('a', 1), story('b', 20)]
    expect(upkeepClock({ backlog: ['a', 'b'], backlogTotal: 900 }, linked, now)).toEqual(story('b', 20).datePublished)
    expect(upkeepClock({ backlog: ['a', 'b'], backlogTotal: 2 }, linked, now)).toEqual(now)
    expect(upkeepClock({ backlog: ['a', 'b'], backlogTotal: 900 }, [], now)).toEqual(now)
  })

  it('names refreshes and reviews always, and the rest when they happened', () => {
    const tally = {
      closingsChecked: 1,
      closingsBegun: 1,
      moves: 2,
      detached: 0,
      bursts: 1,
      reviews: 2,
      reviewActions: 3,
      reviewRefusals: 0,
      audits: 5,
      standsRefreshes: 4,
      standsWritten: 3,
      standsChecked: 10,
      standsDropped: 1,
      failed: 1,
      costUsd: 0.4,
      errors: [],
      stopped: false,
    }
    expect(upkeepSummary(tally)).toBe('3 overviews refreshed, 2 reviewed, 1 closing, 1 frozen by a burst, 5 audited, 1 upkeep item failed')
    expect(upkeepSummary({ ...tally, closingsBegun: 0, bursts: 0, audits: 0, failed: 0, standsWritten: 1, reviews: 0 })).toBe(
      '1 overview refreshed, 0 reviewed',
    )
  })

  it("reads the tables, calls each step's tier (the audit at high effort) and writes through the lifecycle", async () => {
    const lifecycle = await import('../services/overviewLifecycle.js')
    mocks.structuredCall.mockResolvedValue({ parsed: null, costUsd: 0, model: 'm' })
    mocks.overviewStates.mockResolvedValue([])
    mocks.standsCases.mockResolvedValue([])
    const deps = productionUpkeepDeps(now)
    expect(await deps.closings()).toEqual([])
    expect(await deps.states()).toEqual([])
    expect(mocks.overviewStates).toHaveBeenCalledWith(expect.anything(), now)
    expect(await deps.reviewCase('o1')).toBeNull()
    expect(await deps.auditPicks(now)).toEqual([])
    expect(await deps.standsCases()).toEqual([])

    const charter = { in: 'In.', out: [], endEvent: 'Declared over.' }
    const entries = [{ ref: 'E1', title: 'T', label: 'L', summary: 'S.', date: '2026-06-01', role: { role: 'routine' as const, roleKind: null } }]
    await deps.close.close({ charter, story: story('a', 1), entries: [] })
    await deps.close.closeCheck({ endEvent: charter.endEvent, story: story('a', 1) })
    await deps.review.review({ title: 'T', charter, frozen: false, entries }, { audit: false })
    await deps.review.review({ title: 'T', charter, frozen: false, entries }, { audit: true })
    await deps.stands.write({ title: 'T', entries: [], facts: [], today: '2026-06-02', maxSentences: 4, maxDoing: 2 })
    await deps.stands.check([], [])
    const { tiers } = (await import('../config.js')).config.overviews
    expect(mocks.structuredCall.mock.calls.map(c => [c[0], c[3]])).toEqual([
      [tiers.close, undefined],
      [tiers.closeCheck, undefined],
      [tiers.review, {}],
      [tiers.review, { effort: 'high' }],
      [tiers.stands, undefined],
      [tiers.standsCheck, undefined],
    ])

    const state = {} as Parameters<typeof deps.applyBurst>[0]
    await deps.applyClosing({} as never, {} as never)
    await deps.applyStatus(state, [], now)
    await deps.applyBurst(state)
    await deps.applyReview({} as never, {} as never, now)
    await deps.applyAudit({} as never, {} as never)
    await deps.applyStands({} as never, {} as never, 'sig', '2026-06-02')
    for (const write of [
      lifecycle.applyClosing,
      lifecycle.applyStatus,
      lifecycle.applyBurst,
      lifecycle.applyReview,
      lifecycle.applyAudit,
      lifecycle.applyStands,
    ])
      expect(write).toHaveBeenCalled()
  })
})

describe('linkSummary', () => {
  it('counts each outcome, those left for the next run after them, and the backfill while one is owed', () => {
    const outcomes = new Map(
      Object.entries({ a: 'joined', b: 'joined', c: 'founded', d: 'none', e: 'rejected', f: 'held', g: 'conflict', h: 'failed' } as const),
    )
    expect(linkSummary(outcomes, { taken: 300, total: 1612 })).toBe(
      'Linked 8 stories: 2 joined, 1 founded, 2 alone, 1 held by a frozen overview, 1 left for the next run, 1 failed; backfill 300 of 1,612',
    )
    expect(linkSummary(new Map([['a', 'none' as const]]), null)).toBe('Linked 1 story: 0 joined, 0 founded, 1 alone')
  })
})
