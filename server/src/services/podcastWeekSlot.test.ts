import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  jobRun: { findUnique: vi.fn() },
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { fridayWindow, slotWindow, getWeekSlot, fridayWindowEnd } = await import('./podcastWeekSlot.js')
const { config } = await import('../config.js')

// 2026-10-16 is a Friday, in 2026-W42.
const WEDNESDAY = new Date('2026-10-14T10:00:00Z')

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pod-1',
    title: 'W42: Water',
    status: 'draft',
    stage: 'scripted',
    mode: 'automated',
    weekKey: '2026-W42',
    kind: 'weekly',
    edition: 'full',
    storyIds: [],
    attempts: 0,
    blockedAt: null,
    lastError: null,
    dryRun: false,
    leaseUntil: null,
    publishedAt: null,
    createdAt: WEDNESDAY,
    updatedAt: WEDNESDAY,
    ...overrides,
  }
}

describe('fridayWindow', () => {
  it.each([
    ['2026-10-12T00:00:00Z', 'ahead'], // Monday
    ['2026-10-15T23:59:00Z', 'ahead'], // Thursday
    ['2026-10-16T00:00:00Z', 'open'],
    ['2026-10-16T18:00:00Z', 'open'], // the last slot
    ['2026-10-16T19:59:00Z', 'open'],
    ['2026-10-16T20:00:00Z', 'passed'],
    ['2026-10-17T06:00:00Z', 'passed'], // Saturday
    ['2026-10-18T23:59:00Z', 'passed'], // Sunday, still the same ISO week
    ['2026-10-19T00:00:00Z', 'ahead'], // the next Monday
  ] as const)('%s is %s', (iso, expected) => {
    expect(fridayWindow(new Date(iso))).toBe(expected)
  })
})

describe('slotWindow', () => {
  it.each([
    ['2026-10-15T23:59:00Z', 'ahead'],
    ['2026-10-16T18:30:00Z', 'open'], // the last slot's hour, its run may still be going
    ['2026-10-16T19:00:00Z', 'passed'], // gate still open, but no slot fires again this week
    ['2026-10-16T20:00:00Z', 'passed'],
    ['2026-10-17T06:00:00Z', 'passed'],
  ] as const)('%s is %s', (iso, expected) => {
    expect(slotWindow(new Date(iso))).toBe(expected)
  })

  it('leaves the cron gate open at Friday 19:00', () => {
    expect(fridayWindow(new Date('2026-10-16T19:00:00Z'))).toBe('open')
  })
})

describe('getWeekSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.podcast.findUnique.mockResolvedValue(null)
    mockPrisma.jobRun.findUnique.mockResolvedValue({ enabled: true })
  })

  it('reports a free week as one Friday will create, without creating a row', async () => {
    const slot = await getWeekSlot(WEDNESDAY, 'full')
    expect(slot).toEqual({
      edition: 'full',
      weekKey: '2026-W42',
      episode: null,
      fridayRun: 'create',
      fridayWindow: 'ahead',
      automaticRunEnabled: true,
      showProblem: null,
    })
    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { edition_weekKey: { edition: 'full', weekKey: '2026-W42' } } }),
    )
    expect(mockPrisma.podcast.create).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.upsert).not.toHaveBeenCalled()
  })

  it('reports the claimed episode with what the Friday run will do with it', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: 'interactive' }))
    const slot = await getWeekSlot(WEDNESDAY, 'full')
    expect(slot.episode).toMatchObject({ id: 'pod-1', inProgress: false })
    expect(slot.fridayRun).toBe('waiting-for-person')
  })

  it('takes the window from the given time', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'ready' }))
    const slot = await getWeekSlot(new Date('2026-10-17T06:00:00Z'), 'full')
    expect(slot).toMatchObject({ weekKey: '2026-W42', fridayRun: 'finished', fridayWindow: 'passed' })
  })

  it('reports Friday 19:00 UTC as passed, once the last generation slot has gone by', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: 'automated', stage: 'scripted' }))
    const slot = await getWeekSlot(new Date('2026-10-16T19:00:00Z'), 'full')
    expect(slot).toMatchObject({ fridayRun: 'advance', fridayWindow: 'passed' })
  })

  it('reports the automatic run as off when the job row is disabled or missing', async () => {
    mockPrisma.jobRun.findUnique.mockResolvedValueOnce({ enabled: false })
    expect((await getWeekSlot(WEDNESDAY, 'full')).automaticRunEnabled).toBe(false)
    mockPrisma.jobRun.findUnique.mockResolvedValueOnce(null)
    expect((await getWeekSlot(WEDNESDAY, 'full')).automaticRunEnabled).toBe(false)
    expect(mockPrisma.jobRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { jobName: 'generate_podcast' } }))
  })

  it("reads the Actually Uplifting show's own row and job, and names what keeps it closed", async () => {
    const slot = await getWeekSlot(WEDNESDAY, 'uplifting')
    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { edition_weekKey: { edition: 'uplifting', weekKey: '2026-W42' } } }),
    )
    expect(mockPrisma.jobRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { jobName: 'generate_uplifting_podcast' } }))
    expect(slot).toMatchObject({ edition: 'uplifting', showProblem: expect.stringContaining('PODCAST_UPLIFTING_ENABLED') })
  })
})

describe('fridayWindowEnd', () => {
  it.each([
    ['2026-10-12T00:00:00Z'], // Monday
    ['2026-10-16T19:00:00Z'], // Friday
    ['2026-10-17T07:00:00+02:00'], // Saturday morning in Berlin
    ['2026-10-18T23:59:00Z'], // Sunday, still the same ISO week
  ] as const)("is this ISO week's Friday at the window's end hour (%s)", iso => {
    expect(fridayWindowEnd(new Date(iso)).toISOString()).toBe(`2026-10-16T${String(config.podcast.generateWindowEndHourUtc).padStart(2, '0')}:00:00.000Z`)
  })
})
