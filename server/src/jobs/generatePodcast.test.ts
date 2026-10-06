import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWeekly = vi.hoisted(() => ({ runWeeklyEpisode: vi.fn() }))
const mockNotify = vi.hoisted(() => ({ notifyEvent: vi.fn() }))
const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
}))

vi.mock('../services/podcastWeekly.js', () => mockWeekly)
vi.mock('../lib/notify.js', () => mockNotify)
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { runGeneratePodcast, inWeekendWindow } = await import('./generatePodcast.js')

const SATURDAY_0600 = new Date('2026-10-10T06:00:00Z')
const SUNDAY_0600 = new Date('2026-10-11T06:00:00Z')
const SUNDAY_1000 = new Date('2026-10-11T10:00:00Z')

function waiting(overrides: Record<string, unknown> = {}) {
  return { outcome: 'skipped', podcastId: 'pod-1', reason: 'interactive: the owner is reviewing it', waitingForPerson: true, ...overrides }
}

function episode(overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', title: 'W41: Water', stage: 'scripted', blockedReason: null, lastError: null, leaseUntil: null, ...overrides }
}

describe('inWeekendWindow', () => {
  it('opens Saturday at the configured UTC hour and closes at the end of Sunday (UTC)', () => {
    expect(inWeekendWindow(new Date('2026-10-10T04:59:00Z'))).toBe(false)
    expect(inWeekendWindow(new Date('2026-10-10T05:00:00Z'))).toBe(true)
    expect(inWeekendWindow(new Date('2026-10-11T23:59:00Z'))).toBe(true)
    expect(inWeekendWindow(new Date('2026-10-12T00:00:00Z'))).toBe(false)
    expect(inWeekendWindow(new Date('2026-10-14T10:00:00Z'))).toBe(false) // a Wednesday boot catch-up
  })
})

describe('runGeneratePodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWeekly.runWeeklyEpisode.mockResolvedValue({ outcome: 'done', podcastId: 'pod-1' })
    mockPrisma.podcast.findUnique.mockResolvedValue(episode())
    mockPrisma.$executeRaw.mockResolvedValue(1)
  })

  it('does nothing outside the weekend window', async () => {
    await runGeneratePodcast(new Date('2026-10-14T10:00:00Z'))
    expect(mockWeekly.runWeeklyEpisode).not.toHaveBeenCalled()
  })

  it('runs the week\'s episode on the cron trigger inside the window', async () => {
    await runGeneratePodcast(SATURDAY_0600)
    expect(mockWeekly.runWeeklyEpisode).toHaveBeenCalledWith({ trigger: 'cron', now: SATURDAY_0600 })
  })

  it('throws on a block, so the scheduler alerts once', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce({ outcome: 'blocked', podcastId: 'pod-1', reason: 'monthly TTS cap reached' })
    await expect(runGeneratePodcast(SATURDAY_0600)).rejects.toThrow(/monthly TTS cap reached/)
  })

  it('returns quietly when stopped, retrying later or skipping a blocked episode', async () => {
    for (const outcome of ['stopped', 'retry-later', 'skipped']) {
      mockWeekly.runWeeklyEpisode.mockResolvedValueOnce({ outcome, podcastId: 'pod-1', reason: 'blocked' })
      await expect(runGeneratePodcast(SUNDAY_0600)).resolves.toBeUndefined()
    }
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('does not remind on Saturday about an episode waiting for its person', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    await runGeneratePodcast(SATURDAY_0600)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('reminds once on Sunday, naming the episode, its stage and the admin link', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    await runGeneratePodcast(SUNDAY_0600)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1)
    const [title, message] = mockNotify.notifyEvent.mock.calls[0]
    expect(title).toMatch(/waiting/i)
    expect(message).toContain('W41: Water')
    expect(message).toContain('scripted')
    expect(message).toContain('/admin/podcasts/pod-1')
  })

  it('sends no second reminder once the claim was taken by an earlier slot or process', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await runGeneratePodcast(SUNDAY_1000)
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('waits for a later slot while a person\'s run is in progress', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(episode({ leaseUntil: new Date(SUNDAY_0600.getTime() + 60_000) }))
    await runGeneratePodcast(SUNDAY_0600)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('names a block in the reminder', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(episode({ blockedReason: 'dialogue invalid' }))
    await runGeneratePodcast(SUNDAY_0600)
    expect(mockNotify.notifyEvent.mock.calls[0][1]).toContain('dialogue invalid')
  })
})
