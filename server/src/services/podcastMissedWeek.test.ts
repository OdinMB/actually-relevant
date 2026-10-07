import { describe, it, expect, vi, beforeEach } from 'vitest'
import { samplePodcast } from '../test/helpers.js'

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  podcast: { findUnique: vi.fn() },
}))
const mockNotify = vi.hoisted(() => ({ notifyEvent: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', () => mockNotify)

const { alertMissedWeek, missedWeekReason } = await import('./podcastMissedWeek.js')
const { config } = await import('../config.js')

// Saturday 07:00 in Berlin (CEST): the publish slot, ISO week 2026-W42.
const SATURDAY = new Date('2026-10-17T05:00:00Z')
const HOUR = 60 * 60 * 1000

const weekly = (overrides: Record<string, unknown> = {}) => samplePodcast({ weekKey: '2026-W42', mode: 'automated', ...overrides })
const readyEpisode = (overrides: Record<string, unknown> = {}) => weekly({
  stage: 'ready', audioUrl: 'https://audio.example/e.mp3', audioBytes: 5_000_000,
  readyAt: new Date(SATURDAY.getTime() - (config.podcast.autoPublishMinAgeHours + 1) * HOUR), ...overrides,
})

describe('missedWeekReason', () => {
  it('says none was generated when the week has no episode, or one nobody started', () => {
    expect(missedWeekReason(null, SATURDAY)).toMatch(/no episode was generated/)
    expect(missedWeekReason(weekly({ mode: null }), SATURDAY)).toMatch(/no episode was generated/)
  })

  it('gives the block reason of a blocked episode', () => {
    expect(missedWeekReason(weekly({ stage: 'selected', blockedAt: SATURDAY, blockedReason: 'TTS credit too low' }), SATURDAY)).toMatch(/blocked: TTS credit too low/)
  })

  it('names an interactive episode that waits for a person, at the step the page shows', () => {
    const reason = missedWeekReason(weekly({ mode: 'interactive', stage: 'selected' }), SATURDAY)
    expect(reason).toMatch(/interactive/)
    expect(reason).toMatch(/Script step/)
  })

  it('names an unfinished automated episode at its step, with its last error', () => {
    const reason = missedWeekReason(weekly({ stage: 'scripted', lastError: 'ElevenLabs 503' }), SATURDAY)
    expect(reason).toMatch(/Audio step/)
    expect(reason).toMatch(/ElevenLabs 503/)
  })

  it('says a dry-run episode is never published', () => {
    expect(missedWeekReason(readyEpisode({ dryRun: true }), SATURDAY)).toMatch(/dry run/)
  })

  it('says a ready episode has not been ready long enough', () => {
    const fresh = readyEpisode({ readyAt: new Date(SATURDAY.getTime() - HOUR) })
    expect(missedWeekReason(fresh, SATURDAY)).toMatch(new RegExp(`${config.podcast.autoPublishMinAgeHours} hours`))
  })

  it('says why a ready episode is refused, such as missing audio', () => {
    expect(missedWeekReason(readyEpisode({ audioUrl: null }), SATURDAY)).toMatch(/no uploaded audio/)
  })

  it('says a taken-down episode is never republished by the job', () => {
    expect(missedWeekReason(readyEpisode({ publishedAt: new Date('2026-10-16'), unpublishedAt: new Date('2026-10-16T20:00:00Z') }), SATURDAY)).toMatch(/unpublished/)
  })

  it('is null when the week\'s episode is already listed: nothing was missed', () => {
    expect(missedWeekReason(readyEpisode({ status: 'published', publishedAt: SATURDAY }), SATURDAY)).toBeNull()
  })
})

describe('alertMissedWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockResolvedValue(1)
  })

  it('claims the ISO week and sends one notice with the reason', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    await alertMissedWeek(SATURDAY)
    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith({ where: { weekKey: '2026-W42' } })
    expect(mockPrisma.$executeRaw.mock.calls[0].slice(1)).toContain('2026-W42')
    expect(mockNotify.notifyEvent).toHaveBeenCalledOnce()
    expect(mockNotify.notifyEvent.mock.calls[0][1]).toMatch(/no episode was generated/)
  })

  it('sends nothing when the week was already claimed (a retry or a boot catch-up the same week)', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await alertMissedWeek(SATURDAY)
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('neither claims the week nor sends anything when the episode is already listed', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(readyEpisode({ status: 'published', publishedAt: SATURDAY }))
    await alertMissedWeek(SATURDAY)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })
})
