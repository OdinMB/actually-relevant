import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWeekly = vi.hoisted(() => ({ runWeeklyEpisode: vi.fn() }))
const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }))
const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
}))

vi.mock('../services/podcastWeekly.js', () => mockWeekly)
vi.mock('../lib/notify.js', () => mockNotify)
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

// The window rule itself is tested in podcastWeekSlot.test.ts; the real one runs here.
const { runGeneratePodcast } = await import('./generatePodcast.js')

// 2026-10-16 is a Friday.
const FRIDAY_0600 = new Date('2026-10-16T06:00:00Z')
const FRIDAY_1400 = new Date('2026-10-16T14:00:00Z')
const FRIDAY_1800 = new Date('2026-10-16T18:00:00Z')

function waiting(overrides: Record<string, unknown> = {}) {
  return { outcome: 'skipped', podcastId: 'pod-1', reason: 'interactive: the owner is reviewing it', waitingForPerson: true, ...overrides }
}

function episode(overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', title: 'W42: Water', stage: 'scripted', blockedReason: null, lastError: null, leaseUntil: null, ...overrides }
}

describe('runGeneratePodcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWeekly.runWeeklyEpisode.mockResolvedValue({ outcome: 'done', podcastId: 'pod-1' })
    mockPrisma.podcast.findUnique.mockResolvedValue(episode())
    mockPrisma.$executeRaw.mockResolvedValue(1)
  })

  it('does nothing outside the Friday window', async () => {
    await runGeneratePodcast(new Date('2026-10-14T10:00:00Z'))
    await runGeneratePodcast(new Date('2026-10-17T06:00:00Z'))
    await runGeneratePodcast(new Date('2026-10-16T20:00:00Z'))
    expect(mockWeekly.runWeeklyEpisode).not.toHaveBeenCalled()
  })

  it('runs the week\'s episode on the cron trigger inside the window', async () => {
    await runGeneratePodcast(FRIDAY_0600)
    expect(mockWeekly.runWeeklyEpisode).toHaveBeenCalledWith({ trigger: 'cron', now: FRIDAY_0600 })
  })

  it('throws on a block, so the scheduler alerts once', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce({ outcome: 'blocked', podcastId: 'pod-1', reason: 'monthly TTS cap reached' })
    await expect(runGeneratePodcast(FRIDAY_0600)).rejects.toThrow(/monthly TTS cap reached/)
  })

  it('returns quietly when stopped, retrying later or skipping a blocked episode', async () => {
    for (const outcome of ['stopped', 'retry-later', 'skipped']) {
      mockWeekly.runWeeklyEpisode.mockResolvedValueOnce({ outcome, podcastId: 'pod-1', reason: 'blocked' })
      await expect(runGeneratePodcast(FRIDAY_1800)).resolves.toBeUndefined()
    }
    expect(mockNotify.notify).not.toHaveBeenCalled()
  })

  it('skips a still-blocked episode on a later slot without throwing: its notice was recorded once', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce({ outcome: 'skipped', podcastId: 'pod-1', reason: 'blocked' })
    await expect(runGeneratePodcast(FRIDAY_1400)).resolves.toBeUndefined()
    expect(mockNotify.notify).not.toHaveBeenCalled()
  })

  it('does not remind before Friday evening about an episode waiting for its person', async () => {
    for (const now of [FRIDAY_0600, FRIDAY_1400, new Date('2026-10-16T17:59:00Z')]) {
      mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
      await runGeneratePodcast(now)
    }
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockNotify.notify).not.toHaveBeenCalled()
  })

  it('reminds once at the Friday evening slot, naming the episode, its stage and the admin link', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    await runGeneratePodcast(FRIDAY_1800)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1)
    const [{ title, message, source, link }] = mockNotify.notify.mock.calls[0]
    expect(title).toMatch(/waiting/i)
    expect({ source, link }).toEqual({ source: 'podcast', link: '/admin/podcasts/pod-1' })
    expect(message).toContain('W42: Water')
    expect(message).toContain('scripted')
  })

  it('sends no second reminder once the claim was taken by an earlier run or process', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await runGeneratePodcast(new Date('2026-10-16T19:00:00Z'))
    expect(mockNotify.notify).not.toHaveBeenCalled()
  })

  it('does not remind while a person\'s run is in progress', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(episode({ leaseUntil: new Date(FRIDAY_1800.getTime() + 60_000) }))
    await runGeneratePodcast(FRIDAY_1800)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockNotify.notify).not.toHaveBeenCalled()
  })

  it('names a block in the reminder', async () => {
    mockWeekly.runWeeklyEpisode.mockResolvedValueOnce(waiting())
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(episode({ blockedReason: 'dialogue invalid' }))
    await runGeneratePodcast(FRIDAY_1800)
    expect(mockNotify.notify.mock.calls[0][0].message).toContain('dialogue invalid')
  })
})
