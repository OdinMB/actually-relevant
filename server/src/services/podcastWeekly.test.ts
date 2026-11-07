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
const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }))
const mockScript = vi.hoisted(() => ({ episodePoolSize: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./podcastPipeline.js', () => mockPipeline)
vi.mock('./podcastScript.js', () => mockScript)
vi.mock('./podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('./podcastGuards.js')>()), ...mockGuards }))
vi.mock('../lib/notify.js', () => mockNotify)
// Production settings: a row left over from a dry run must not occupy the week.
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, config: { ...actual.config, podcast: { ...actual.config.podcast, dryRun: false } } }
})

const { isoWeekKey, runWeeklyEpisode, resumeEpisode, startAdminRun, findOrCreateWeekEpisode, weeklyCronAction } = await import('./podcastWeekly.js')
const { PodcastBlockedError, PodcastStoppedError, PodcastRefusedError } = await import('./podcastGuards.js')

const NOW = new Date('2026-10-10T06:00:00Z') // Saturday of 2026-W41

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pod-1',
    weekKey: '2026-W41',
    kind: 'weekly',
    edition: 'full',
    stage: 'created',
    status: 'draft',
    mode: 'automated',
    dryRun: false,
    blockedAt: null,
    attempts: 0,
    ...overrides,
  }
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

describe('weeklyCronAction', () => {
  const BLOCKED = new Date('2026-10-09T10:00:00Z')
  it.each([
    ['a published episode', { status: 'published', stage: 'ready', mode: 'automated', blockedAt: null }, 'finished'],
    ['a ready episode', { status: 'draft', stage: 'ready', mode: 'automated', blockedAt: null }, 'finished'],
    ['a ready interactive episode', { status: 'draft', stage: 'ready', mode: 'interactive', blockedAt: null }, 'finished'],
    ['an interactive episode', { status: 'draft', stage: 'selected', mode: 'interactive', blockedAt: null }, 'waiting-for-person'],
    ['a blocked interactive episode', { status: 'draft', stage: 'scripted', mode: 'interactive', blockedAt: BLOCKED }, 'waiting-for-person'],
    ['a blocked automated episode', { status: 'draft', stage: 'scripted', mode: 'automated', blockedAt: BLOCKED }, 'blocked'],
    ['an episode nobody started', { status: 'draft', stage: 'created', mode: null, blockedAt: null }, 'advance'],
    ['an automated episode in progress', { status: 'draft', stage: 'voiced', mode: 'automated', blockedAt: null }, 'advance'],
  ] as const)('%s', (_label, episode, expected) => {
    expect(weeklyCronAction(episode)).toBe(expected)
  })
})

describe('findOrCreateWeekEpisode', () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the week's existing row without creating one", async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    expect(await findOrCreateWeekEpisode(NOW, 'full')).toEqual(row())
    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith({ where: { edition_weekKey: { edition: 'full', weekKey: '2026-W41' } } })
    expect(mockPrisma.podcast.create).not.toHaveBeenCalled()
  })

  it('creates the row with the week key, the show and the dry-run flag', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.podcast.create.mockResolvedValueOnce(row())
    await findOrCreateWeekEpisode(NOW, 'full')
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ weekKey: '2026-W41', edition: 'full', dryRun: false, title: 'Actually Relevant, 2026-W41' }),
    })
  })

  it("looks up and creates the Actually Uplifting show's own row for the week", async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.podcast.create.mockResolvedValueOnce(row({ edition: 'uplifting' }))
    await findOrCreateWeekEpisode(NOW, 'uplifting')
    expect(mockPrisma.podcast.findUnique).toHaveBeenCalledWith({ where: { edition_weekKey: { edition: 'uplifting', weekKey: '2026-W41' } } })
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({ data: expect.objectContaining({ weekKey: '2026-W41', edition: 'uplifting' }) })
  })

  it('reads the row another process created first (unique week key)', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ id: 'pod-other' }))
    mockPrisma.podcast.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    expect((await findOrCreateWeekEpisode(NOW, 'full')).id).toBe('pod-other')
  })
})

describe("runWeeklyEpisode for Actually Uplifting's short week", () => {
  const FRIDAY_LAST_SLOT = new Date('2026-10-09T18:30:00Z')
  const FRIDAY_EARLY_SLOT = new Date('2026-10-09T10:30:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.advanceEpisode.mockResolvedValue({ status: 'done', stage: 'scripted' })
    mockPrisma.podcast.update.mockResolvedValue(row())
  })

  it('creates no row and counts no attempt when the pool is short, and says so only at the last slot', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValue(null)
    mockScript.episodePoolSize.mockResolvedValue(3)

    expect(await runWeeklyEpisode({ trigger: 'cron', now: FRIDAY_EARLY_SLOT, edition: 'uplifting' })).toMatchObject({ outcome: 'skipped', podcastId: null })
    expect(mockNotify.notify).not.toHaveBeenCalled()

    expect((await runWeeklyEpisode({ trigger: 'cron', now: FRIDAY_LAST_SLOT, edition: 'uplifting' })).outcome).toBe('skipped')
    expect(mockNotify.notify).toHaveBeenCalledTimes(1)
    const [notice, options] = mockNotify.notify.mock.calls[0]
    expect(notice).toMatchObject({ source: 'podcast', severity: 'info', dedupeKey: 'podcast-uplifting-no-stories:2026-W41' })
    expect(options).toEqual({ reopen: false })

    expect(mockPrisma.podcast.create).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.update).not.toHaveBeenCalled()
    expect(mockPipeline.advanceEpisode).not.toHaveBeenCalled()
  })

  it('creates the uplifting row and runs it when the pool holds enough stories', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockScript.episodePoolSize.mockResolvedValue(4)
    mockPrisma.podcast.create.mockResolvedValueOnce(row({ edition: 'uplifting', mode: null }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: FRIDAY_EARLY_SLOT, edition: 'uplifting' })).outcome).toBe('done')
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({ data: expect.objectContaining({ edition: 'uplifting', weekKey: '2026-W41' }) })
    expect(mockPipeline.advanceEpisode).toHaveBeenCalled()
  })

  it("runs the week's uplifting row once it exists, without counting the pool again", async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ edition: 'uplifting', stage: 'selected' }))
    expect((await runWeeklyEpisode({ trigger: 'cron', now: FRIDAY_LAST_SLOT, edition: 'uplifting' })).outcome).toBe('done')
    expect(mockScript.episodePoolSize).not.toHaveBeenCalled()
  })

  it("never counts the main show's pool: its short week fails at selection, as before", async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(null)
    mockPrisma.podcast.create.mockResolvedValueOnce(row())
    await runWeeklyEpisode({ trigger: 'cron', now: FRIDAY_LAST_SLOT })
    expect(mockScript.episodePoolSize).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({ data: expect.objectContaining({ edition: 'full' }) })
  })

  it("names the show in an uplifting episode's ready notice", async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ edition: 'uplifting', stage: 'voiced' }))
    mockPipeline.advanceEpisode.mockResolvedValueOnce({ status: 'done', stage: 'ready' })
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ edition: 'uplifting', stage: 'ready', title: 'W41: Good news', durationSec: 300 }))
    await runWeeklyEpisode({ trigger: 'cron', now: FRIDAY_EARLY_SLOT, edition: 'uplifting' })
    const { episodeNoticeTitle } = await import('./podcastEdition.js')
    expect(mockNotify.notify.mock.calls[0][0].title).toBe(episodeNoticeTitle('uplifting', 'ready'))
  })
})

describe('runWeeklyEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipeline.advanceEpisode.mockResolvedValue({ status: 'done', stage: 'scripted' })
    mockPrisma.podcast.update.mockResolvedValue(row({ attempts: 1 }))
  })

  it("advances the week's episode", async () => {
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
    expect(await runWeeklyEpisode({ trigger: 'cron', now: NOW })).toMatchObject({
      outcome: 'skipped',
      reason: expect.stringMatching(/interactive/),
      waitingForPerson: true,
    })
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
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ blockedAt: new Date(), blockedReason: 'monthly TTS cap reached' }))
    expect(await runWeeklyEpisode({ trigger: 'cron', now: NOW })).toMatchObject({ outcome: 'skipped', reason: 'blocked' })
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
    mockGuards.assertPodcastRunnable.mockImplementationOnce(() => {
      throw new PodcastBlockedError('podcast configuration missing: ELEVENLABS_API_KEY')
    })
    const result = await runWeeklyEpisode({ trigger: 'cron', now: NOW })
    expect(result).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('ELEVENLABS_API_KEY') })
    expect(mockGuards.assertPodcastRunnable).toHaveBeenCalledWith({ dryRun: false })
    expect(mockPipeline.advanceEpisode).not.toHaveBeenCalled()
  })

  it('sends the ready notice with duration and characters when the episode becomes ready', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'voiced' }))
    mockPipeline.advanceEpisode.mockResolvedValueOnce({ status: 'done', stage: 'ready' })
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ stage: 'ready', title: 'The week in water', durationSec: 342 }))
    await runWeeklyEpisode({ trigger: 'cron', now: NOW })
    const [{ source, severity, message, link }] = mockNotify.notify.mock.calls[0]
    expect({ source, severity, link }).toEqual({ source: 'podcast', severity: 'info', link: '/admin/podcasts/pod-1' })
    expect(message).toContain('The week in water')
    expect(message).toContain('5:42')
    expect(message).toContain('5400')
  })

  it('sends no notice for a run that stops short of ready', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    await runWeeklyEpisode({ trigger: 'admin', now: NOW })
    expect(mockNotify.notify).not.toHaveBeenCalled()
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
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { mode: 'interactive', blockedAt: null, blockedReason: null, attempts: 0 },
    })
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

  it('refuses an Actually Uplifting episode while the show is closed, before claiming', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(row({ edition: 'uplifting', mode: 'interactive' }))
    await expect(startAdminRun('pod-1', { mode: 'automated' })).rejects.toThrow(/Actually Uplifting is switched off/)
    expect(mockPipeline.claimEpisode).not.toHaveBeenCalled()
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
