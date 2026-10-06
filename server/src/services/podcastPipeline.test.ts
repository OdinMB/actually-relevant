import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  podcastAudioChunk: { create: vi.fn() },
}))
const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  podcast: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  podcastAudioChunk: { deleteMany: vi.fn() },
}))
const mockScript = vi.hoisted(() => ({
  selectEpisodeStories: vi.fn(),
  writeEpisodeScript: vi.fn(),
  buildShowNotes: vi.fn(() => 'notes'),
}))
const mockAudio = vi.hoisted(() => ({
  voiceEpisode: vi.fn(),
  finishEpisode: vi.fn(),
  deleteEpisodeObjects: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./podcastScript.js', () => mockScript)
vi.mock('./podcastAudioStages.js', () => mockAudio)

const { advanceEpisode, resetEpisode, releaseHeldLeases, LeaseLostError } = await import('./podcastPipeline.js')
const { PodcastStoppedError, PodcastRefusedError } = await import('./podcastGuards.js')
const { PODCAST_OPENER } = await import('../lib/aiLabelCopy.js')

const snapshot = (ref: number) => ({ ref, id: `story-${ref}`, title: `T${ref}`, publisher: 'P', sourceUrl: 'https://x.example', slug: `t${ref}`, issue: 'I' })
const dialogue = {
  episodeTitle: 'Episode title',
  episodeSummary: 'Summary.',
  segments: [{ kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome.' }] }],
}

function episode(stage: string, overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', stage, status: 'draft', title: 'Week', leaseOwner: null, leaseUntil: null, audioPath: null, transcriptPath: null, ...overrides }
}

/** Every updateMany whose data carries a given key. */
const writesWith = (key: string) => mockPrisma.podcast.updateMany.mock.calls.map(c => c[0]).filter(a => key in a.data)

/** The episode as each successive read sees it. */
function stagesRead(...stages: string[]) {
  for (const stage of stages) mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode(stage))
}

const chunk = { index: 0, bytes: Buffer.from('mp3'), requestId: 'r1', chars: 900, durationMs: 60_000 }

function setUp() {
  vi.clearAllMocks()
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockTx) => Promise<unknown>) => work(mockTx))
  mockTx.$queryRaw.mockResolvedValue([{ id: 'pod-1' }])
  mockScript.selectEpisodeStories.mockResolvedValue([1, 2, 3, 4].map(n => ({ snapshot: snapshot(n), prompt: {} })))
  mockScript.writeEpisodeScript.mockResolvedValue({ dialogue, modelId: 'gpt-6-sol' })
  mockAudio.voiceEpisode.mockResolvedValue({ stage: 'voiced', ttsModelId: 'eleven_v4' })
  mockAudio.finishEpisode.mockResolvedValue({ stage: 'ready', audioPath: 'episodes/a.mp3' })
}

describe('advanceEpisode', () => {
  beforeEach(setUp)

  it('returns busy without running a stage when another process holds the lease', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'busy' })
    expect(mockScript.selectEpisodeStories).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.updateMany).not.toHaveBeenCalled()
  })

  it('runs every stage from created to ready, each written fenced on its own lease, then releases the lease', async () => {
    stagesRead('created', 'scripted', 'voiced', 'ready')

    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'ready' })

    const stageWrites = writesWith('stage')
    expect(stageWrites.map(w => w.data.stage)).toEqual(['scripted', 'voiced', 'ready'])
    const [scriptWrite] = stageWrites
    expect(scriptWrite.where).toEqual({ id: 'pod-1', leaseOwner: expect.any(String) })
    expect(scriptWrite.data).toMatchObject({
      stage: 'scripted', title: 'Episode title', episodeSummary: 'Summary.', showNotes: 'notes',
      storyIds: ['story-1', 'story-2', 'story-3', 'story-4'], scriptModelId: 'gpt-6-sol', lastError: null,
    })
    expect(scriptWrite.data.episodeStories).toEqual([1, 2, 3, 4].map(snapshot))
    expect(scriptWrite.data.script.startsWith(`HOST A: ${PODCAST_OPENER}`)).toBe(true)
    const [release] = writesWith('leaseOwner')
    expect(release).toEqual({ where: { id: 'pod-1', leaseOwner: scriptWrite.where.leaseOwner }, data: { leaseOwner: null, leaseUntil: null } })
  })

  it('deletes the voiced chunks only after the ready stage is written', async () => {
    stagesRead('voiced', 'ready')
    await advanceEpisode('pod-1', { trigger: 'admin' })
    const readyWriteOrder = mockPrisma.podcast.updateMany.mock.invocationCallOrder[0]
    expect(mockPrisma.podcastAudioChunk.deleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } })
    expect(mockPrisma.podcastAudioChunk.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(readyWriteOrder)
  })

  it('keeps the chunks when the ready write finds the lease lost', async () => {
    stagesRead('voiced')
    mockPrisma.podcast.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ count: 'stage' in args.data ? 0 : 1 }))
    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(mockPrisma.podcastAudioChunk.deleteMany).not.toHaveBeenCalled()
  })

  it('runs no stage for an episode that is already ready', async () => {
    stagesRead('ready')
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'ready' })
    expect(mockAudio.voiceEpisode).not.toHaveBeenCalled()
  })

  it('lends the audio stage a chunk store that writes only while the lease is held', async () => {
    stagesRead('scripted')
    mockAudio.voiceEpisode.mockImplementationOnce(async (_ep: unknown, ctx: { storeChunk: (c: typeof chunk) => Promise<void> }) => {
      await ctx.storeChunk(chunk)
      mockTx.$queryRaw.mockResolvedValueOnce([]) // another process took the lease
      await ctx.storeChunk({ ...chunk, index: 1 })
      return { stage: 'voiced' }
    })

    await expect(advanceEpisode('pod-1', { trigger: 'cron' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(mockTx.podcastAudioChunk.create).toHaveBeenCalledTimes(1)
    expect(mockTx.podcastAudioChunk.create.mock.calls[0][0].data).toMatchObject({ podcastId: 'pod-1', index: 0, chars: 900, durationMs: 60_000 })
    expect(writesWith('stage')).toHaveLength(0)
  })

  it('passes the trigger to the audio stage', async () => {
    stagesRead('scripted', 'voiced', 'ready')
    await advanceEpisode('pod-1', { trigger: 'cron' })
    expect(mockAudio.voiceEpisode.mock.calls[0][1].trigger).toBe('cron')
  })

  it('keeps the stage on a failure, records the error and rethrows', async () => {
    stagesRead('created')
    mockScript.writeEpisodeScript.mockRejectedValueOnce(new Error('model down'))

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow('model down')

    expect(writesWith('stage')).toHaveLength(0)
    const [failure] = writesWith('lastError')
    expect(failure.data).toEqual({ lastError: 'model down', failedAt: expect.any(Date) })
    expect(failure.where.leaseOwner).toEqual(expect.any(String))
    expect(writesWith('leaseOwner')).toHaveLength(1)
  })

  it('records no error when the automatic run is stopped by its disabled job', async () => {
    stagesRead('scripted')
    mockAudio.voiceEpisode.mockRejectedValueOnce(new PodcastStoppedError('generate_podcast'))
    await expect(advanceEpisode('pod-1', { trigger: 'cron' })).rejects.toBeInstanceOf(PodcastStoppedError)
    expect(writesWith('lastError')).toHaveLength(0)
    expect(writesWith('stage')).toHaveLength(0)
  })

  it('aborts when the stage write finds the lease taken by another process', async () => {
    stagesRead('created')
    mockPrisma.podcast.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ count: 'stage' in args.data ? 0 : 1 }))

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(writesWith('lastError').filter(a => a.data.lastError !== null)).toHaveLength(0)
  })

  it('aborts before the next stage when renewing the lease fails', async () => {
    stagesRead('created')
    mockPrisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(mockScript.selectEpisodeStories).not.toHaveBeenCalled()
  })

  it('refuses a legacy episode', async () => {
    stagesRead('legacy')
    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow(/legacy/)
  })
})

describe('resetEpisode', () => {
  beforeEach(setUp)

  it('takes a ready episode back to created, clears script and audio, deletes chunks and the old objects', async () => {
    const ready = episode('ready', { audioPath: 'episodes/2026-W41-aaaa.mp3', transcriptPath: 'episodes/2026-W41-aaaa.vtt' })
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready)
    await resetEpisode('pod-1', { dryRun: false })

    const [reset] = writesWith('stage')
    expect(reset.data).toMatchObject({
      stage: 'created', dryRun: false, script: '', showNotes: '', episodeSummary: '', storyIds: [], scriptModelId: null,
      audioUrl: null, audioPath: null, transcriptUrl: null, transcriptPath: null, audioBytes: null, durationSec: null, readyAt: null, ttsModelId: null,
    })
    expect(mockPrisma.podcastAudioChunk.deleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } })
    expect(mockAudio.deleteEpisodeObjects).toHaveBeenCalledWith(ready)
  })

  it('refuses while another process holds the lease', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(resetEpisode('pod-1', { dryRun: false })).rejects.toBeInstanceOf(PodcastRefusedError)
  })

  it('refuses a published episode and keeps its audio', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'published', audioPath: 'episodes/x.mp3' }))
    await expect(resetEpisode('pod-1', { dryRun: false })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writesWith('stage')).toHaveLength(0)
    expect(mockPrisma.podcastAudioChunk.deleteMany).not.toHaveBeenCalled()
    expect(mockAudio.deleteEpisodeObjects).not.toHaveBeenCalled()
  })

  it('refuses a legacy episode', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('legacy'))
    await expect(resetEpisode('pod-1', { dryRun: false })).rejects.toThrow(/legacy/)
    expect(writesWith('stage')).toHaveLength(0)
  })
})

describe('releaseHeldLeases', () => {
  it('clears only this process\'s leases', async () => {
    vi.clearAllMocks()
    mockPrisma.podcast.updateMany.mockResolvedValue({ count: 2 })
    await releaseHeldLeases()
    expect(mockPrisma.podcast.updateMany).toHaveBeenCalledWith({ where: { leaseOwner: expect.any(String) }, data: { leaseOwner: null, leaseUntil: null } })
  })
})
