import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkStory } from '../services/overviewTypes.js'

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
vi.mock('../services/overviewLifecycle.js', () => ({ applyLink: mocks.applyLink }))
vi.mock('../services/structuredCall.js', () => ({ structuredCall: mocks.structuredCall }))
vi.mock('../lib/runUsage.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/runUsage.js')>()),
  recordItems: mocks.recordItems,
  reportRunResult: mocks.reportRunResult,
}))

const { linkSummary, runLinkOverviewsJob } = await import('./linkOverviews.js')

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
    mocks.owedStories.mockResolvedValue({ backlog: ['b1', 'b2'], night: ['n1'], backlogTotal: 40 })
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
    expect(mocks.reportRunResult).toHaveBeenCalledWith('Linked 3 stories: 0 joined, 0 founded, 3 alone; backfill 2 of 40')
  })

  it('says so when nothing is owed', async () => {
    gates.overview = null
    gates.pass = null
    mocks.owedStories.mockResolvedValue({ backlog: [], night: [], backlogTotal: 0 })
    mocks.linkStories.mockResolvedValue([])
    await runLinkOverviewsJob()
    expect(mocks.reportRunResult).toHaveBeenCalledWith('Nothing to link')
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
