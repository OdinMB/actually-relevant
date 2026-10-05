import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCount = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockCreateNewsletter = vi.hoisted(() => vi.fn())
const mockAssignStories = vi.hoisted(() => vi.fn())
const mockSelectStoriesForNewsletter = vi.hoisted(() => vi.fn())
const mockGenerateContent = vi.hoisted(() => vi.fn())
const mockGenerateHtmlContent = vi.hoisted(() => vi.fn())
const mockSendTest = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({
  default: {
    story: { count: mockCount },
    newsletter: { findFirst: mockFindFirst, delete: mockDelete },
  },
}))

vi.mock('../services/newsletter.js', () => ({
  createNewsletter: mockCreateNewsletter,
  assignStories: mockAssignStories,
  selectStoriesForNewsletter: mockSelectStoriesForNewsletter,
  generateContent: mockGenerateContent,
  generateHtmlContent: mockGenerateHtmlContent,
  sendTest: mockSendTest,
}))

const { runGenerateNewsletter, getWeekTitle, getWeekKey } = await import('./generateNewsletter.js')

// --- A tiny in-memory newsletters table that evaluates the where clauses the job uses ---

interface Row {
  id: string
  title: string
  weekKey: string | null
  html: string
  createdAt: Date
  updatedAt: Date
}

type StringFilter = string | null | { not: string | null }
interface Where {
  weekKey?: StringFilter
  html?: StringFilter
  createdAt?: { gte: Date }
  OR?: Where[]
}

function matchString(value: string | null, filter: StringFilter): boolean {
  if (filter !== null && typeof filter === 'object') return value !== filter.not
  return value === filter
}

function matches(row: Row, where: Where): boolean {
  if (where.weekKey !== undefined && !matchString(row.weekKey, where.weekKey)) return false
  if (where.html !== undefined && !matchString(row.html, where.html)) return false
  if (where.createdAt && row.createdAt < where.createdAt.gte) return false
  if (where.OR && !where.OR.some(w => matches(row, w))) return false
  return true
}

let rows: Row[] = []

function row(partial: Partial<Row> & { createdAt: Date }): Row {
  return { id: 'nl-old', title: 'Week 1, 2026', weekKey: null, html: '<p>built</p>', updatedAt: partial.createdAt, ...partial }
}

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
// Saturday 2026-02-21 04:00 UTC, ISO week 8
const SATURDAY = new Date('2026-02-21T04:00:00Z')

describe('runGenerateNewsletter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(SATURDAY)
    rows = []
    mockFindFirst.mockImplementation(async ({ where }: { where: Where }) => rows.find(r => matches(r, where)) ?? null)
    mockDelete.mockImplementation(async ({ where }: { where: { id: string } }) => {
      rows = rows.filter(r => r.id !== where.id)
    })
    mockCount.mockResolvedValue(5)
    mockCreateNewsletter.mockResolvedValue({ id: 'nl-new' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the full newsletter pipeline in order, sending the test last', async () => {
    const callOrder: string[] = []
    mockCreateNewsletter.mockImplementation(async () => {
      callOrder.push('create')
      return { id: 'nl-1' }
    })
    mockAssignStories.mockImplementation(async () => { callOrder.push('assign') })
    mockSelectStoriesForNewsletter.mockImplementation(async () => { callOrder.push('select') })
    mockGenerateContent.mockImplementation(async () => { callOrder.push('generateContent') })
    mockGenerateHtmlContent.mockImplementation(async () => { callOrder.push('generateHtml') })
    mockSendTest.mockImplementation(async () => { callOrder.push('sendTest') })

    await runGenerateNewsletter()

    expect(callOrder).toEqual([
      'create', 'assign', 'select', 'generateContent', 'generateHtml', 'sendTest',
    ])
  })

  it('creates the issue with this week\'s title and key', async () => {
    await runGenerateNewsletter()

    expect(mockCreateNewsletter).toHaveBeenCalledWith({ title: 'Week 8, 2026', weekKey: '2026-W08' })
  })

  it('passes the newsletter ID through all pipeline steps', async () => {
    mockCreateNewsletter.mockResolvedValue({ id: 'nl-42' })

    await runGenerateNewsletter()

    expect(mockAssignStories).toHaveBeenCalledWith('nl-42')
    expect(mockSelectStoriesForNewsletter).toHaveBeenCalledWith('nl-42')
    expect(mockGenerateContent).toHaveBeenCalledWith('nl-42')
    expect(mockGenerateHtmlContent).toHaveBeenCalledWith('nl-42')
    expect(mockSendTest).toHaveBeenCalledWith('nl-42')
  })

  it('skips silently when no recent published stories', async () => {
    mockCount.mockResolvedValue(0)

    await runGenerateNewsletter()

    expect(mockCreateNewsletter).not.toHaveBeenCalled()
  })

  it('skips when a built issue already has this week\'s key', async () => {
    rows = [row({ weekKey: '2026-W08', createdAt: new Date(SATURDAY.getTime() - 3 * DAY) })]

    await runGenerateNewsletter()

    expect(mockCreateNewsletter).not.toHaveBeenCalled()
  })

  it('skips on the Saturday after a Sunday catch-up (built six days earlier, previous ISO week)', async () => {
    // Sunday 2026-02-15 belongs to ISO week 7
    const sunday = new Date('2026-02-15T10:00:00Z')
    rows = [row({ weekKey: getWeekKey(sunday), createdAt: sunday })]

    await runGenerateNewsletter()

    expect(mockCreateNewsletter).not.toHaveBeenCalled()
  })

  it('proceeds when the last built automatic issue is seven days old', async () => {
    const lastSaturday = new Date(SATURDAY.getTime() - 7 * DAY)
    rows = [row({ weekKey: '2026-W07', createdAt: lastSaturday })]

    await runGenerateNewsletter()

    expect(mockCreateNewsletter).toHaveBeenCalledTimes(1)
  })

  it('ignores newsletters an admin made by hand (no week key)', async () => {
    rows = [row({ weekKey: null, title: 'Week 8, 2026', createdAt: new Date(SATURDAY.getTime() - DAY) })]

    await runGenerateNewsletter()

    expect(mockCreateNewsletter).toHaveBeenCalledTimes(1)
  })

  it('skips when this week\'s unbuilt draft is fresh (another run is building it)', async () => {
    rows = [row({ id: 'nl-draft', weekKey: '2026-W08', html: '', createdAt: new Date(SATURDAY.getTime() - 5 * MIN) })]

    await runGenerateNewsletter()

    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockCreateNewsletter).not.toHaveBeenCalled()
  })

  it('deletes a stale unbuilt draft from a killed run, then rebuilds', async () => {
    rows = [row({ id: 'nl-draft', weekKey: '2026-W08', html: '', createdAt: new Date(SATURDAY.getTime() - 2 * 60 * MIN) })]

    await runGenerateNewsletter()

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'nl-draft' } })
    expect(mockCreateNewsletter).toHaveBeenCalledTimes(1)
    expect(mockSendTest).toHaveBeenCalledTimes(1)
  })

  it('cleans up and re-throws on mid-pipeline failure', async () => {
    mockCreateNewsletter.mockResolvedValue({ id: 'nl-1' })
    mockGenerateContent.mockRejectedValue(new Error('LLM timeout'))

    await expect(runGenerateNewsletter()).rejects.toThrow('LLM timeout')

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'nl-1' } })
    expect(mockGenerateHtmlContent).not.toHaveBeenCalled()
    expect(mockSendTest).not.toHaveBeenCalled()
  })

  it('keeps the built issue and re-throws when the test send fails', async () => {
    mockCreateNewsletter.mockResolvedValue({ id: 'nl-1' })
    mockSendTest.mockRejectedValue(new Error('plunk down'))

    await expect(runGenerateNewsletter()).rejects.toThrow('plunk down')

    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('getWeekTitle', () => {
  it('returns correct week for a known date', () => {
    // 2026-02-14 is a Saturday in ISO week 7
    expect(getWeekTitle(new Date(2026, 1, 14))).toBe('Week 7, 2026')
  })

  it('handles week 1 of a new year', () => {
    // 2026-01-01 is a Thursday — ISO week 1 of 2026
    expect(getWeekTitle(new Date(2026, 0, 1))).toBe('Week 1, 2026')
  })

  it('handles end of year crossing into next year week 1', () => {
    // 2025-12-29 is a Monday — ISO week 1 of 2026
    expect(getWeekTitle(new Date(2025, 11, 29))).toBe('Week 1, 2026')
  })

  it('handles week 53 in long years', () => {
    // 2020-12-31 is a Thursday — ISO week 53 of 2020
    expect(getWeekTitle(new Date(2020, 11, 31))).toBe('Week 53, 2020')
  })
})

describe('getWeekKey', () => {
  it('zero-pads the week', () => {
    expect(getWeekKey(new Date(2026, 1, 14))).toBe('2026-W07')
  })

  it('uses the ISO week-numbering year at a year boundary', () => {
    expect(getWeekKey(new Date(2025, 11, 29))).toBe('2026-W01')
  })

  it('handles week 53 in long years', () => {
    expect(getWeekKey(new Date(2020, 11, 31))).toBe('2020-W53')
  })
})
