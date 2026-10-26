import { describe, it, expect, vi, afterEach } from 'vitest'

// The spend reservation, the month-to-date sums and the job-row check run against PostgreSQL in
// podcastGuards.db.test.ts; this file covers the checks that never touch the database.
const mockElevenLabs = vi.hoisted(() => ({
  getRemainingCharacters: vi.fn(),
  isElevenLabsConfigured: vi.fn(() => true),
  ElevenLabsQuotaError: class ElevenLabsQuotaError extends Error {},
}))

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('../lib/elevenlabs.js', () => mockElevenLabs)

const guards = await import('./podcastGuards.js')
const { config } = await import('../config.js')
const { PodcastBlockedError } = guards

describe('utcMonthStart', () => {
  it('starts at midnight UTC on the first, whatever the server zone', () => {
    expect(guards.utcMonthStart(new Date('2026-11-01T00:30:00+02:00'))).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(guards.utcMonthStart(new Date('2026-11-01T00:00:00Z'))).toEqual(new Date('2026-11-01T00:00:00Z'))
  })
})

describe('assertPodcastRunnable', () => {
  const saved = { ...config.bunny }
  const savedWebhook = process.env.WEBHOOK_URL
  afterEach(() => {
    Object.assign(config.bunny, saved)
    config.podcast.voiceIdB = 'OZ0L6eISlOejga3XjDFt'
    mockElevenLabs.isElevenLabsConfigured.mockReturnValue(true)
    if (savedWebhook === undefined) delete process.env.WEBHOOK_URL
    else process.env.WEBHOOK_URL = savedWebhook
  })

  it('does not need an alert channel: a run without WEBHOOK_URL is not blocked', () => {
    Object.assign(config.bunny, { storageZone: 'zone', storagePassword: 'secret' })
    delete process.env.WEBHOOK_URL
    expect(missingOf({ dryRun: false })).toBe('')
  })

  function missingOf(ctx: Parameters<typeof guards.assertPodcastRunnable>[0]): string {
    try {
      guards.assertPodcastRunnable(ctx)
      return ''
    } catch (err) {
      expect(err).toBeInstanceOf(PodcastBlockedError)
      return (err as Error).message
    }
  }

  it('names each missing credential on a live run', () => {
    mockElevenLabs.isElevenLabsConfigured.mockReturnValue(false)
    Object.assign(config.bunny, { storageZone: '', storagePassword: '' })
    delete process.env.WEBHOOK_URL
    const message = missingOf({ dryRun: false })
    for (const name of ['ELEVENLABS_API_KEY', 'BUNNY_STORAGE_ZONE', 'BUNNY_STORAGE_PASSWORD']) expect(message).toContain(name)
    expect(message).not.toContain('WEBHOOK_URL')
  })

  it('needs no credentials for a dry run', () => {
    mockElevenLabs.isElevenLabsConfigured.mockReturnValue(false)
    Object.assign(config.bunny, { storageZone: '', storagePassword: '' })
    expect(missingOf({ dryRun: true })).toBe('')
  })

  it('names an empty voice id', () => {
    config.podcast.voiceIdB = ''
    expect(missingOf({ dryRun: true })).toContain('config.podcast.voiceIdB')
  })
})

describe('assertBalanceCovers', () => {
  it('blocks when the subscription has fewer credits than the remaining chunks need', async () => {
    mockElevenLabs.getRemainingCharacters.mockResolvedValueOnce(4000)
    await expect(guards.assertBalanceCovers(5500)).rejects.toBeInstanceOf(PodcastBlockedError)
    mockElevenLabs.getRemainingCharacters.mockResolvedValueOnce(6000)
    await expect(guards.assertBalanceCovers(5500)).resolves.toBeUndefined()
  })

  it('blocks when ElevenLabs refuses the balance read (no user-read permission, account refused)', async () => {
    mockElevenLabs.getRemainingCharacters.mockRejectedValueOnce(new mockElevenLabs.ElevenLabsQuotaError('HTTP 401'))
    await expect(guards.assertBalanceCovers(5500)).rejects.toBeInstanceOf(PodcastBlockedError)
    mockElevenLabs.getRemainingCharacters.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(guards.assertBalanceCovers(5500)).rejects.not.toBeInstanceOf(PodcastBlockedError)
  })
})

describe('editedAiLineRefusal', () => {
  it("refuses an edited episode while the edited AI line awaits the owner's confirmation", () => {
    expect(guards.editedAiLineRefusal(true, false)).toMatch(/Edited by a person/)
  })

  it('allows an unedited episode, and an edited one once the line is confirmed', () => {
    expect(guards.editedAiLineRefusal(false, false)).toBeNull()
    expect(guards.editedAiLineRefusal(true, true)).toBeNull()
  })
})
