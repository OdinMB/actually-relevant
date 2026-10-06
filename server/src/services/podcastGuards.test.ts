import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

interface UsageRow { podcastId: string | null; chars: number; createdAt: Date }

/**
 * An in-memory ledger behind a fake `$transaction`. The fake advisory lock is a mutex taken by the
 * transaction's `$executeRaw` and released when the transaction ends, like pg_advisory_xact_lock,
 * so a reservation that skips the lock races and both callers pass.
 */
const db = vi.hoisted(() => {
  const state = { rows: [] as UsageRow[], lock: Promise.resolve(), jobs: new Map<string, { enabled: boolean }>() }
  const sumSince = (since: Date) => state.rows.filter(r => r.createdAt >= since).reduce((n, r) => n + r.chars, 0)
  const aggregate = async ({ where }: { where: { createdAt: { gte: Date } } }) => {
    // The sum is read now and returned after a yield, as a real query does: a concurrent
    // transaction can interleave and read the same total.
    const chars = state.rows.length ? sumSince(where.createdAt.gte) : null
    await new Promise(r => setTimeout(r, 5))
    return { _sum: { chars } }
  }
  const prisma = {
    jobRun: { findUnique: vi.fn(async ({ where }: { where: { jobName: string } }) => state.jobs.get(where.jobName) ?? null) },
    podcastTtsUsage: { aggregate: vi.fn(aggregate) },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      let release = () => {}
      const tx = {
        $executeRaw: vi.fn(async () => {
          const previous = state.lock
          state.lock = new Promise<void>(r => { release = r })
          await previous
          return 1
        }),
        podcastTtsUsage: {
          aggregate: vi.fn(aggregate),
          create: vi.fn(async ({ data }: { data: { podcastId: string; chars: number } }) => { state.rows.push({ ...data, createdAt: new Date() }) }),
        },
      }
      try {
        return await work(tx)
      } finally {
        release()
      }
    }),
  }
  return { state, prisma }
})
const mockElevenLabs = vi.hoisted(() => ({
  getRemainingCharacters: vi.fn(),
  isElevenLabsConfigured: vi.fn(() => true),
  ElevenLabsQuotaError: class ElevenLabsQuotaError extends Error {},
}))

vi.mock('../lib/prisma.js', () => ({ default: db.prisma }))
vi.mock('../lib/elevenlabs.js', () => mockElevenLabs)

const guards = await import('./podcastGuards.js')
const { config } = await import('../config.js')
const { PodcastBlockedError, PodcastStoppedError, PodcastRefusedError } = guards

const CAP = config.podcast.monthlyTtsCharCap

describe('reserveTtsChars', () => {
  beforeEach(() => {
    db.state.rows = []
    vi.clearAllMocks()
  })

  it('records the reservation when it stays under the cap', async () => {
    await guards.reserveTtsChars('pod-1', 1500)
    expect(db.state.rows).toEqual([expect.objectContaining({ podcastId: 'pod-1', chars: 1500 })])
  })

  it('refuses a reservation that would pass the cap, as a block', async () => {
    db.state.rows.push({ podcastId: 'old', chars: CAP - 1000, createdAt: new Date() })
    await expect(guards.reserveTtsChars('pod-1', 1500)).rejects.toBeInstanceOf(PodcastBlockedError)
    expect(db.state.rows).toHaveLength(1)
  })

  it('counts usage of deleted episodes (no podcast id)', async () => {
    db.state.rows.push({ podcastId: null, chars: CAP, createdAt: new Date() })
    await expect(guards.reserveTtsChars('pod-1', 1)).rejects.toBeInstanceOf(PodcastBlockedError)
  })

  it('lets only one of two concurrent reservations near the cap through', async () => {
    db.state.rows.push({ podcastId: 'old', chars: CAP - 1500, createdAt: new Date() })
    const results = await Promise.allSettled([guards.reserveTtsChars('pod-1', 1000), guards.reserveTtsChars('pod-2', 1000)])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(db.state.rows.reduce((n, r) => n + r.chars, 0)).toBeLessThanOrEqual(CAP)
  })
})

describe('the UTC month', () => {
  afterEach(() => vi.useRealTimers())

  it('starts at midnight UTC on the first, whatever the server zone', () => {
    expect(guards.utcMonthStart(new Date('2026-11-01T00:30:00+02:00'))).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(guards.utcMonthStart(new Date('2026-11-01T00:00:00Z'))).toEqual(new Date('2026-11-01T00:00:00Z'))
  })

  it('counts only this month\'s usage', async () => {
    db.state.rows = [
      { podcastId: 'a', chars: 900, createdAt: new Date('2026-09-30T23:59:59Z') },
      { podcastId: 'b', chars: 400, createdAt: new Date('2026-10-01T00:00:00Z') },
    ]
    expect(await guards.monthToDateChars(new Date('2026-10-15T12:00:00Z'))).toBe(400)
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

  function missingOf(ctx: Parameters<typeof guards.assertPodcastRunnable>[0]): string {
    try {
      guards.assertPodcastRunnable(ctx)
      return ''
    } catch (err) {
      expect(err).toBeInstanceOf(PodcastBlockedError)
      return (err as Error).message
    }
  }

  it('names each missing credential on a live run, and the webhook on the automatic one', () => {
    mockElevenLabs.isElevenLabsConfigured.mockReturnValue(false)
    Object.assign(config.bunny, { storageZone: '', storagePassword: '' })
    delete process.env.WEBHOOK_URL
    const message = missingOf({ trigger: 'cron', dryRun: false })
    for (const name of ['ELEVENLABS_API_KEY', 'BUNNY_STORAGE_ZONE', 'BUNNY_STORAGE_PASSWORD', 'WEBHOOK_URL']) expect(message).toContain(name)
    expect(missingOf({ trigger: 'admin', dryRun: false })).not.toContain('WEBHOOK_URL')
  })

  it('needs no credentials for a dry run', () => {
    mockElevenLabs.isElevenLabsConfigured.mockReturnValue(false)
    Object.assign(config.bunny, { storageZone: '', storagePassword: '' })
    expect(missingOf({ trigger: 'admin', dryRun: true })).toBe('')
  })

  it('names an empty voice id', () => {
    config.podcast.voiceIdB = ''
    expect(missingOf({ trigger: 'admin', dryRun: true })).toContain('config.podcast.voiceIdB')
  })
})

describe('assertJobEnabled', () => {
  beforeEach(() => db.state.jobs.clear())

  it('passes for an enabled row', async () => {
    db.state.jobs.set('generate_podcast', { enabled: true })
    await expect(guards.assertJobEnabled('generate_podcast')).resolves.toBeUndefined()
  })

  it('stops for a disabled or missing row', async () => {
    db.state.jobs.set('generate_podcast', { enabled: false })
    await expect(guards.assertJobEnabled('generate_podcast')).rejects.toBeInstanceOf(PodcastStoppedError)
    await expect(guards.assertJobEnabled('publish_podcast')).rejects.toBeInstanceOf(PodcastStoppedError)
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

describe('assertChangeable', () => {
  const now = new Date('2026-10-10T08:00:00Z')

  it('refuses a published episode and one in progress', () => {
    expect(() => guards.assertChangeable({ stage: 'ready', status: 'published', leaseUntil: null }, 'deleted', now)).toThrow(PodcastRefusedError)
    expect(() => guards.assertChangeable({ stage: 'voiced', status: 'draft', leaseUntil: new Date('2026-10-10T08:10:00Z') }, 'deleted', now)).toThrow(/in progress/)
  })

  it('allows a draft with an expired lease, and a published legacy row', () => {
    expect(() => guards.assertChangeable({ stage: 'ready', status: 'draft', leaseUntil: new Date('2026-10-10T07:00:00Z') }, 'deleted', now)).not.toThrow()
    expect(() => guards.assertChangeable({ stage: 'legacy', status: 'published', leaseUntil: null }, 'deleted', now)).not.toThrow()
  })
})

describe('editedAiLineRefusal', () => {
  it('refuses an edited episode while the edited AI line awaits the owner\'s confirmation', () => {
    expect(guards.editedAiLineRefusal(true, false)).toMatch(/Edited by a person/)
  })

  it('allows an unedited episode, and an edited one once the line is confirmed', () => {
    expect(guards.editedAiLineRefusal(false, false)).toBeNull()
    expect(guards.editedAiLineRefusal(true, true)).toBeNull()
  })
})
