import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
}))
const mockPipeline = vi.hoisted(() => ({
  advanceEpisode: vi.fn(),
  resetEpisode: vi.fn(),
  LeaseLostError: class LeaseLostError extends Error {},
}))

const mockGuards = vi.hoisted(() => ({
  assertPodcastRunnable: vi.fn(),
  episodeTtsChars: vi.fn(async () => 5400),
  monthToDateChars: vi.fn(async () => 10_800),
}))
const mockNotify = vi.hoisted(() => ({ notifyEvent: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./podcastPipeline.js', () => mockPipeline)
vi.mock('./podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('./podcastGuards.js')>()), ...mockGuards }))
vi.mock('../lib/notify.js', () => mockNotify)
// Production settings: a row left over from a dry run must not occupy the week.
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, config: { ...actual.config, podcast: { ...actual.config.podcast, dryRun: false } } }
})

const { isoWeekKey, runWeeklyEpisode, resumeEpisode, findOrCreateWeekEpisode } = await import('./podcastWeekly.js')
const { PodcastBlockedError, PodcastStoppedError } = await import('./podcastGuards.js')

const NOW = new Date('2026-10-10T06:00:00Z') // Saturday of 2026-W41

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', weekKey: '2026-W41', stage: 'created', status: 'draft', dryRun: false, blockedAt: null, attempts: 0, ...overrides }
}

describe('isoWeekKey', () => {
  it('uses the ISO week in UTC, across year boundaries', () => {
    expect(isoWeekKey(new Date('2026-10-10T06:00:00Z'))).toBe('2026-W41')
    expect(isoWeekKey(new Date('2025-12-29T00:30:00Z'))).toBe('2026-W01')
    expect(isoWeekKey(new Date('2021-01-03T23:59:00Z'))).toBe('2020-W53')
    // Sunday 23:30 UTC is still the same week, whatever the server's zone
    expect(isoWeekKey(new Date('2026-10-11T23:30:00Z'))).toBe('2026-W41')
    expect(isoWeekKey(new Date('2026-10-12T00:00:00Z'))).toBe('2026-W42')
  })
})

describe('findOrCreateWeekEpisode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the week\'s existing row without creating one', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    expect(await findOrCreateWeekEpisode(NOW)).toEqual(row())
    expect(mockPrisma.podcast.create).not.toHaveBeenCalled()
  })

  it('creates the row with the week key and the dry-run flag', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.podcast.create.mockResolvedValueOnce(row())
    await findOrCreateWeekEpisode(NOW)
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({ data: expect.objectContaining({ weekKey: '2026-W41', dryRun: false }) })
  })

  it('reads the row another process created first (unique week key)', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ id: 'pod-other' }))
    mockPrisma.podcast.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    expect((await findOrCreateWeekEpisode(NOW)).id).toBe('pod-other')
  })
})

describe('runWeeklyEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.advanceEpisode.mockResolvedValue({ status: 'done', stage: 'scripted' })
    mockPrisma.podcast.update.mockResolvedValue(row({ attempts: 1 }))
  })

  it('advances the week\'s episode', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    expect(await runWeeklyEpisode({ trigger: 'cron', now: NOW })).toMatchObject({ outcome: 'done', podcastId: 'pod-1' })
    expect(mockPipeline.advanceEpisode).toHaveBeenCalledWith('pod-1', { trigger: 'cron', now: NOW })
  })

  it('skips an episode that is ready or published', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'ready' }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).outcome).toBe('skipped')
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ status: 'published' }))
    expect((await runWeeklyEpisode({ trigger: 'admin', now: NOW })).outcome).toBe('skipped')
    expect(mockPipeline.advanceEpisode).not.toHaveBeenCalled()
  })

  it('skips a blocked episode on the cron trigger', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ blockedAt: new Date() }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).outcome).toBe('skipped')
    expect(mockPipeline.advanceEpisode).not.toHaveBeenCalled()
  })

  it('skips quietly when another process holds the lease', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    mockPipeline.advanceEpisode.mockResolvedValueOnce({ status: 'busy' })
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).outcome).toBe('skipped')
  })

  it('counts a cron failure below the cap and retries later', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    mockPipeline.advanceEpisode.mockRejectedValueOnce(new Error('timeout'))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).outcome).toBe('retry-later')
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-1' }, data: { attempts: { increment: 1 } } })
    expect(mockPrisma.podcast.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ blockedAt: expect.any(Date) }) }))
  })

  it('blocks the episode when cron failures reach the weekly cap', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ attempts: 2 }))
    mockPipeline.advanceEpisode.mockRejectedValueOnce(new Error('timeout'))
    mockPrisma.podcast.update.mockResolvedValueOnce(row({ attempts: 3 }))
    const result = await runWeeklyEpisode({ trigger: 'cron', now: NOW })
    expect(result.outcome).toBe('blocked')
    expect(mockPrisma.podcast.update).toHaveBeenLastCalledWith({
      where: { id: 'pod-1' },
      data: { blockedAt: expect.any(Date), blockedReason: expect.stringContaining('timeout') },
    })
  })

  it('blocks at once on a non-retryable error, whatever the trigger', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    mockPipeline.advanceEpisode.mockRejectedValueOnce(new PodcastBlockedError('dialogue invalid'))
    expect((await runWeeklyEpisode({ trigger: 'admin', now: NOW })).outcome).toBe('blocked')
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-1' }, data: { blockedAt: expect.any(Date), blockedReason: 'dialogue invalid' } })
  })

  it('on the admin trigger counts no attempt, and clears a block before advancing', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ blockedAt: new Date(), attempts: 3 }))
    mockPipeline.advanceEpisode.mockRejectedValueOnce(new Error('timeout'))
    expect((await runWeeklyEpisode({ trigger: 'admin', now: NOW })).outcome).toBe('retry-later')
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-1' }, data: { blockedAt: null, blockedReason: null, attempts: 0 } })
    expect(mockPrisma.podcast.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { attempts: { increment: 1 } } }))
  })

  it('stops quietly when the job is disabled mid-run: no attempt, no block', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'scripted' }))
    mockPipeline.advanceEpisode.mockRejectedValueOnce(new PodcastStoppedError('generate_podcast'))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).outcome).toBe('stopped')
    expect(mockPrisma.podcast.update).not.toHaveBeenCalled()
  })

  it('blocks before any work when the configuration is incomplete', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    mockGuards.assertPodcastRunnable.mockImplementationOnce(() => { throw new PodcastBlockedError('podcast configuration missing: ELEVENLABS_API_KEY') })
    const result = await runWeeklyEpisode({ trigger: 'cron', now: NOW })
    expect(result).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('ELEVENLABS_API_KEY') })
    expect(mockGuards.assertPodcastRunnable).toHaveBeenCalledWith({ trigger: 'cron', dryRun: false })
    expect(mockPipeline.advanceEpisode).not.toHaveBeenCalled()
  })

  it('sends the ready notice with duration and characters when the episode becomes ready', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'voiced' }))
    mockPipeline.advanceEpisode.mockResolvedValueOnce({ status: 'done', stage: 'ready' })
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ stage: 'ready', title: 'The week in water', durationSec: 342 }))
    await runWeeklyEpisode({ trigger: 'cron', now: NOW })
    const [title, message] = mockNotify.notifyEvent.mock.calls[0]
    expect(title).toBe('Podcast episode ready')
    expect(message).toContain('The week in water')
    expect(message).toContain('5:42')
    expect(message).toContain('5400')
    expect(message).toContain('/admin/podcasts/pod-1')
  })

  it('sends no notice for a run that stops short of ready', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    await runWeeklyEpisode({ trigger: 'admin', now: NOW })
    expect(mockNotify.notifyEvent).not.toHaveBeenCalled()
  })

  it('resets a dry-run row before advancing when the config is live', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ dryRun: true, stage: 'scripted' }))
    await runWeeklyEpisode({ trigger: 'cron', now: NOW })
    expect(mockPipeline.resetEpisode).toHaveBeenCalledWith('pod-1', { dryRun: false })
    expect(mockPipeline.advanceEpisode).toHaveBeenCalled()
  })
})

describe('resumeEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.advanceEpisode.mockResolvedValue({ status: 'done', stage: 'scripted' })
    mockPrisma.podcast.update.mockResolvedValue(row())
  })

  it('clears the block and attempts, then advances that episode', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ id: 'pod-7', blockedAt: new Date(), attempts: 3 }))
    expect((await resumeEpisode('pod-7')).outcome).toBe('done')
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-7' }, data: { blockedAt: null, blockedReason: null, attempts: 0 } })
    expect(mockPipeline.advanceEpisode).toHaveBeenCalledWith('pod-7', expect.objectContaining({ trigger: 'admin' }))
  })
})
