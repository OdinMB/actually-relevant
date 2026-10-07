import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
}))
const mockPipeline = vi.hoisted(() => ({
  advanceEpisode: vi.fn(),
  rewindEpisode: vi.fn(),
  claimEpisode: vi.fn(),
  releaseEpisode: vi.fn(),
  defaultEpisodeTitle: (row: { weekKey: string | null }) => `Actually Relevant, ${row.weekKey}`,
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

const { isoWeekKey, runWeeklyEpisode, resumeEpisode, startAdminRun, findOrCreateWeekEpisode } = await import('./podcastWeekly.js')
const { PodcastBlockedError, PodcastStoppedError, PodcastRefusedError } = await import('./podcastGuards.js')

const NOW = new Date('2026-10-10T06:00:00Z') // Saturday of 2026-W41

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', weekKey: '2026-W41', kind: 'weekly', stage: 'created', status: 'draft', mode: 'automated', dryRun: false, blockedAt: null, attempts: 0, ...overrides }
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
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({ data: expect.objectContaining({ weekKey: '2026-W41', dryRun: false, title: 'Actually Relevant, 2026-W41' }) })
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
    expect(mockPipeline.advanceEpisode).toHaveBeenCalledWith('pod-1', { trigger: 'cron', leaseHeld: false })
  })

  it('on the cron trigger runs an episode nobody started in automated mode', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: null }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).outcome).toBe('done')
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-1' }, data: { mode: 'automated' } })
    expect(mockPipeline.advanceEpisode.mock.invocationCallOrder[0]).toBeGreaterThan(mockPrisma.podcast.update.mock.invocationCallOrder[0])
  })

  it('on the cron trigger skips an interactive episode a person is reviewing', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: 'interactive', stage: 'scripted' }))
    expect(await runWeeklyEpisode({ trigger: 'cron', now: NOW })).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/interactive/), waitingForPerson: true })
    expect(mockPipeline.advanceEpisode).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.update).not.toHaveBeenCalled()
  })

  it('reports a blocked interactive episode as waiting for its person, not as merely blocked', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: 'interactive', stage: 'selected', blockedAt: new Date() }))
    expect(await runWeeklyEpisode({ trigger: 'cron', now: NOW })).toMatchObject({ outcome: 'skipped', waitingForPerson: true })
  })

  it('does not mark other skips as waiting for a person', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ blockedAt: new Date() }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).waitingForPerson).toBeUndefined()
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: 'interactive', stage: 'ready' }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: NOW })).waitingForPerson).toBeUndefined()
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
    expect(mockPipeline.rewindEpisode).toHaveBeenCalledWith('pod-1', 'created', { dryRun: false, leaseHeld: false })
    expect(mockPipeline.advanceEpisode).toHaveBeenCalled()
  })
})

describe('resumeEpisode on a dry-run standalone row with a live config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.advanceEpisode.mockResolvedValue({ status: 'done', stage: 'scripted' })
    mockPrisma.podcast.update.mockResolvedValue(row())
  })
  const standalone = (stage: string) => row({ kind: 'standalone', weekKey: null, mode: 'interactive', dryRun: true, stage })

  it('rewinds to selected, keeping the stories a person chose', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone('scripted'))
    await resumeEpisode('pod-1')
    expect(mockPipeline.rewindEpisode).toHaveBeenCalledWith('pod-1', 'selected', { dryRun: false, leaseHeld: true })
  })

  it('at selected only clears the flag', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone('selected'))
    await resumeEpisode('pod-1')
    expect(mockPipeline.rewindEpisode).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-1' }, data: { dryRun: false } })
    expect(mockPipeline.advanceEpisode).toHaveBeenCalled()
  })
})

describe('startAdminRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.claimEpisode.mockResolvedValue(true)
    mockPrisma.podcast.update.mockResolvedValue(row())
  })

  it('claims the lease, stores the given mode and clears a block, leaving the lease held', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ mode: null, blockedAt: new Date(), attempts: 3 }))
    await startAdminRun('pod-1', { mode: 'interactive' })
    expect(mockPipeline.claimEpisode).toHaveBeenCalledWith('pod-1')
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({ where: { id: 'pod-1' }, data: { mode: 'interactive', blockedAt: null, blockedReason: null, attempts: 0 } })
    expect(mockPipeline.releaseEpisode).not.toHaveBeenCalled()
  })

  it('refuses an episode without a mode when none is given, before claiming', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ mode: null }))
    await expect(startAdminRun('pod-1')).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockPipeline.claimEpisode).not.toHaveBeenCalled()
  })

  it('refuses while a run holds the lease, and a legacy or finished episode', async () => {
    mockPipeline.claimEpisode.mockResolvedValueOnce(false)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row())
    await expect(startAdminRun('pod-1')).rejects.toThrow(/in progress/)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ stage: 'legacy' }))
    await expect(startAdminRun('pod-1')).rejects.toBeInstanceOf(PodcastRefusedError)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ stage: 'ready' }))
    await expect(startAdminRun('pod-1')).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockPrisma.podcast.update).not.toHaveBeenCalled()
  })

  it('rewinds under the held lease and makes the episode interactive when no mode is given', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ stage: 'ready', mode: 'automated' }))
    await startAdminRun('pod-1', { rewindTo: 'selected' })
    expect(mockPipeline.rewindEpisode).toHaveBeenCalledWith('pod-1', 'selected', { dryRun: false, leaseHeld: true })
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mode: 'interactive' }) }))
  })

  it('refuses a standalone episode whose run would start at created, before claiming', async () => {
    const standalone = (overrides: Record<string, unknown> = {}) => row({ kind: 'standalone', weekKey: null, mode: 'interactive', ...overrides })
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone())
    await expect(startAdminRun('pod-1', { mode: 'automated' })).rejects.toThrow(/choose the episode's stories first/)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone({ stage: 'scripted' }))
    await expect(startAdminRun('pod-1', { rewindTo: 'created' })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockPipeline.claimEpisode).not.toHaveBeenCalled()
    expect(mockPipeline.rewindEpisode).not.toHaveBeenCalled()
  })

  it('runs a standalone episode from selected, and a rewind to selected', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ kind: 'standalone', weekKey: null, stage: 'selected', mode: 'interactive' }))
    await startAdminRun('pod-1')
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ kind: 'standalone', weekKey: null, stage: 'ready' }))
    await startAdminRun('pod-1', { rewindTo: 'selected' })
    expect(mockPipeline.claimEpisode).toHaveBeenCalledTimes(2)
  })

  it('releases the lease when the rewind is refused', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ stage: 'scripted' }))
    mockPipeline.rewindEpisode.mockRejectedValueOnce(new PodcastRefusedError('a published episode cannot be changed'))
    await expect(startAdminRun('pod-1', { rewindTo: 'selected' })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockPipeline.releaseEpisode).toHaveBeenCalledWith('pod-1')
  })
})

describe('resumeEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.advanceEpisode.mockResolvedValue({ status: 'done', stage: 'scripted' })
    mockPrisma.podcast.update.mockResolvedValue(row())
  })

  it('advances the episode under the held lease and releases it', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ id: 'pod-7', mode: 'interactive', stage: 'selected' }))
    expect((await resumeEpisode('pod-7')).outcome).toBe('done')
    expect(mockPipeline.advanceEpisode).toHaveBeenCalledWith('pod-7', { trigger: 'admin', leaseHeld: true })
    expect(mockPipeline.releaseEpisode).toHaveBeenCalledWith('pod-7')
  })

  it('releases the lease on an early return', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ id: 'pod-7', stage: 'ready' }))
    expect((await resumeEpisode('pod-7')).outcome).toBe('skipped')
    expect(mockPipeline.releaseEpisode).toHaveBeenCalledWith('pod-7')
  })
})
