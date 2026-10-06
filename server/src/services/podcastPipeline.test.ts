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
  loadEpisodeStories: vi.fn(),
  episodeSnapshots: vi.fn((ep: { episodeStories: unknown }) => ep.episodeStories),
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

const {
  advanceEpisode, rewindEpisode, withEpisodeLease, releaseHeldLeases, pausesForReview, defaultEpisodeTitle, LeaseLostError,
} = await import('./podcastPipeline.js')
const { PodcastStoppedError, PodcastRefusedError } = await import('./podcastGuards.js')
const { PODCAST_OPENER } = await import('../lib/aiLabelCopy.js')

const snapshot = (ref: number) => ({ ref, id: `story-${ref}`, title: `T${ref}`, publisher: 'P', sourceUrl: 'https://x.example', slug: `t${ref}`, issue: 'I' })
const dialogue = {
  episodeTitle: 'Episode title',
  episodeSummary: 'Summary.',
  segments: [{ kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome.' }] }],
}
const CREATED_AT = new Date('2026-10-10T06:00:00Z')

function episode(stage: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'pod-1', stage, status: 'draft', title: 'Week', mode: null, weekKey: null, humanEdited: false, createdAt: CREATED_AT,
    episodeStories: [1, 2, 3, 4].map(snapshot), leaseOwner: null, leaseUntil: null, audioPath: null, transcriptPath: null, ...overrides,
  }
}

/** Every updateMany whose data carries a given key. */
const writesWith = (key: string) => mockPrisma.podcast.updateMany.mock.calls.map(c => c[0]).filter(a => key in a.data)

/** The episode as each successive read sees it. */
function stagesRead(stages: string[], overrides: Record<string, unknown> = {}) {
  for (const stage of stages) mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode(stage, overrides))
}

const chunk = { index: 0, bytes: Buffer.from('mp3'), requestId: 'r1', chars: 900, durationMs: 60_000 }

function setUp() {
  vi.clearAllMocks()
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockTx) => Promise<unknown>) => work(mockTx))
  mockTx.$queryRaw.mockResolvedValue([{ id: 'pod-1' }])
  mockScript.selectEpisodeStories.mockResolvedValue([1, 2, 3, 4].map(n => ({ snapshot: snapshot(n), prompt: {} })))
  mockScript.loadEpisodeStories.mockImplementation(async (snaps: unknown[]) => snaps.map(s => ({ snapshot: s, prompt: {} })))
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

  it('runs an automated episode from created to ready, each stage written fenced on its own lease, then releases the lease', async () => {
    stagesRead(['created', 'selected', 'scripted', 'voiced', 'ready'], { mode: 'automated' })

    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'ready' })

    const stageWrites = writesWith('stage')
    expect(stageWrites.map(w => w.data.stage)).toEqual(['selected', 'scripted', 'voiced', 'ready'])
    const [selectWrite, scriptWrite] = stageWrites
    expect(selectWrite.where).toEqual({ id: 'pod-1', leaseOwner: expect.any(String) })
    expect(selectWrite.data).toMatchObject({ stage: 'selected', storyIds: ['story-1', 'story-2', 'story-3', 'story-4'], lastError: null })
    expect(selectWrite.data.episodeStories).toEqual([1, 2, 3, 4].map(snapshot))
    // The pool's anchor is the moment of selection, kept for the story picker.
    const [anchor] = mockScript.selectEpisodeStories.mock.calls[0]
    expect(anchor).not.toEqual(CREATED_AT)
    expect(selectWrite.data.storiesSelectedAt).toBe(anchor)
    expect(scriptWrite.data).toMatchObject({ stage: 'scripted', title: 'Episode title', episodeSummary: 'Summary.', showNotes: 'notes', scriptModelId: 'gpt-6-sol' })
    expect(scriptWrite.data.script.startsWith(`HOST A: ${PODCAST_OPENER}`)).toBe(true)
    const [release] = writesWith('leaseOwner')
    expect(release).toEqual({ where: { id: 'pod-1', leaseOwner: selectWrite.where.leaseOwner }, data: { leaseOwner: null, leaseUntil: null } })
  })

  it('stops an interactive episode after selected, then after scripted, and a continue from scripted ends at ready', async () => {
    stagesRead(['created', 'selected'], { mode: 'interactive' })
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'selected' })
    expect(mockScript.writeEpisodeScript).not.toHaveBeenCalled()

    stagesRead(['selected', 'scripted'], { mode: 'interactive' })
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'scripted' })
    expect(mockAudio.voiceEpisode).not.toHaveBeenCalled()

    stagesRead(['scripted', 'voiced', 'ready'], { mode: 'interactive' })
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'ready' })
    expect(mockAudio.finishEpisode).toHaveBeenCalledTimes(1)
  })

  it('runs through when the mode is switched to automated between stages', async () => {
    mockPrisma.podcast.findUniqueOrThrow
      .mockResolvedValueOnce(episode('created', { mode: 'interactive' }))
      .mockResolvedValueOnce(episode('selected', { mode: 'automated' }))
      .mockResolvedValueOnce(episode('scripted', { mode: 'automated' }))
      .mockResolvedValueOnce(episode('voiced', { mode: 'automated' }))
      .mockResolvedValueOnce(episode('ready', { mode: 'automated' }))
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'ready' })
  })

  it('with leaseHeld skips the claim and still releases the lease', async () => {
    stagesRead(['ready'])
    await advanceEpisode('pod-1', { trigger: 'admin', leaseHeld: true })
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(writesWith('leaseOwner')).toHaveLength(1)
  })

  it('prefixes the title with the ISO week, and writes none without a week key', async () => {
    stagesRead(['selected', 'scripted'], { mode: 'interactive', weekKey: '2026-W41' })
    await advanceEpisode('pod-1', { trigger: 'admin' })
    expect(writesWith('title')[0].data.title).toBe('W41: Episode title')
  })

  it('fails the script stage on a story no longer published, keeping selected', async () => {
    stagesRead(['selected'], { mode: 'interactive' })
    mockScript.loadEpisodeStories.mockRejectedValueOnce(new Error('story "T2" is no longer published; change the selection'))
    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow(/no longer published/)
    expect(writesWith('stage')).toHaveLength(0)
    expect(writesWith('lastError')[0].data.lastError).toMatch(/no longer published/)
  })

  it('deletes the voiced chunks only after the ready stage is written', async () => {
    stagesRead(['voiced', 'ready'])
    await advanceEpisode('pod-1', { trigger: 'admin' })
    const readyWriteOrder = mockPrisma.podcast.updateMany.mock.invocationCallOrder[0]
    expect(mockPrisma.podcastAudioChunk.deleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } })
    expect(mockPrisma.podcastAudioChunk.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(readyWriteOrder)
  })

  it('keeps the chunks when the ready write finds the lease lost', async () => {
    stagesRead(['voiced'])
    mockPrisma.podcast.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ count: 'stage' in args.data ? 0 : 1 }))
    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(mockPrisma.podcastAudioChunk.deleteMany).not.toHaveBeenCalled()
  })

  it('runs no stage for an episode that is already ready', async () => {
    stagesRead(['ready'])
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'ready' })
    expect(mockAudio.voiceEpisode).not.toHaveBeenCalled()
  })

  it('lends the audio stage a chunk store that writes only while the lease is held', async () => {
    stagesRead(['scripted'])
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
    stagesRead(['scripted', 'voiced', 'ready'])
    await advanceEpisode('pod-1', { trigger: 'cron' })
    expect(mockAudio.voiceEpisode.mock.calls[0][1].trigger).toBe('cron')
  })

  it('keeps the stage on a failure, records the error and rethrows', async () => {
    stagesRead(['selected'])
    mockScript.writeEpisodeScript.mockRejectedValueOnce(new Error('model down'))

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow('model down')

    expect(writesWith('stage')).toHaveLength(0)
    const [failure] = writesWith('lastError')
    expect(failure.data).toEqual({ lastError: 'model down', failedAt: expect.any(Date) })
    expect(failure.where.leaseOwner).toEqual(expect.any(String))
    expect(writesWith('leaseOwner')).toHaveLength(1)
  })

  it('records no error when the automatic run is stopped by its disabled job', async () => {
    stagesRead(['scripted'])
    mockAudio.voiceEpisode.mockRejectedValueOnce(new PodcastStoppedError('generate_podcast'))
    await expect(advanceEpisode('pod-1', { trigger: 'cron' })).rejects.toBeInstanceOf(PodcastStoppedError)
    expect(writesWith('lastError')).toHaveLength(0)
    expect(writesWith('stage')).toHaveLength(0)
  })

  it('aborts when the stage write finds the lease taken by another process', async () => {
    stagesRead(['created'])
    mockPrisma.podcast.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ count: 'stage' in args.data ? 0 : 1 }))

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(writesWith('lastError').filter(a => a.data.lastError !== null)).toHaveLength(0)
  })

  it('aborts before the next stage when renewing the lease fails', async () => {
    stagesRead(['created'])
    mockPrisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(mockScript.selectEpisodeStories).not.toHaveBeenCalled()
  })

  it('refuses a legacy episode', async () => {
    stagesRead(['legacy'])
    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow(/legacy/)
  })
})

describe('pausesForReview', () => {
  it('stops only an interactive episode, and only at selected or scripted', () => {
    expect(pausesForReview({ mode: 'interactive', stage: 'selected' })).toBe(true)
    expect(pausesForReview({ mode: 'interactive', stage: 'scripted' })).toBe(true)
    expect(pausesForReview({ mode: 'interactive', stage: 'voiced' })).toBe(false)
    expect(pausesForReview({ mode: 'automated', stage: 'scripted' })).toBe(false)
    expect(pausesForReview({ mode: null, stage: 'selected' })).toBe(false)
  })
})

describe('rewindEpisode', () => {
  beforeEach(setUp)

  const ready = () => episode('ready', { weekKey: '2026-W41', audioPath: 'episodes/2026-W41-aaaa.mp3', transcriptPath: 'episodes/2026-W41-aaaa.vtt', humanEdited: true })
  const audioCleared = { audioUrl: null, audioPath: null, transcriptUrl: null, transcriptPath: null, audioBytes: null, durationSec: null, readyAt: null, ttsModelId: null }

  it('to scripted clears only the audio, draws a fresh seed, deletes the chunks and the old objects', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready())
    await rewindEpisode('pod-1', 'scripted', { dryRun: false })

    const [write] = writesWith('stage')
    expect(write.data).toMatchObject({ stage: 'scripted', dryRun: false, lastError: null, ...audioCleared })
    expect(write.data.ttsSeed).toEqual(expect.any(Number))
    for (const kept of ['dialogue', 'script', 'showNotes', 'title', 'episodeStories', 'storyIds', 'humanEdited']) expect(write.data).not.toHaveProperty(kept)
    expect(mockPrisma.podcastAudioChunk.deleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } })
    expect(mockAudio.deleteEpisodeObjects).toHaveBeenCalledWith(ready())

    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready())
    await rewindEpisode('pod-1', 'scripted', { dryRun: false })
    expect(writesWith('stage')[1].data.ttsSeed).not.toBe(write.data.ttsSeed)
  })

  it('to selected also clears the script and restores the default title, keeping the stories and the flag', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready())
    await rewindEpisode('pod-1', 'selected', { dryRun: false })
    const [write] = writesWith('stage')
    expect(write.data).toMatchObject({
      stage: 'selected', ...audioCleared, script: '', showNotes: '', episodeSummary: '', scriptModelId: null, ttsSeed: null,
      title: defaultEpisodeTitle('2026-W41'),
    })
    for (const kept of ['episodeStories', 'storyIds', 'storiesSelectedAt', 'humanEdited']) expect(write.data).not.toHaveProperty(kept)
  })

  it('to created also clears the stories and the "edited by a person" flag', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready())
    await rewindEpisode('pod-1', 'created', { dryRun: true, mode: 'interactive' })
    const [write] = writesWith('stage')
    expect(write.data).toMatchObject({ stage: 'created', dryRun: true, storyIds: [], storiesSelectedAt: null, humanEdited: false, script: '', mode: 'interactive' })
  })

  it('refuses a target at or after the current stage', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await expect(rewindEpisode('pod-1', 'scripted', { dryRun: false })).rejects.toBeInstanceOf(PodcastRefusedError)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await expect(rewindEpisode('pod-1', 'selected', { dryRun: false })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writesWith('stage')).toHaveLength(0)
  })

  it('lets a created episode be reset to created (the dry-run reset)', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('created', { dryRun: true }))
    await rewindEpisode('pod-1', 'created', { dryRun: false })
    expect(writesWith('stage')[0].data).toMatchObject({ stage: 'created', dryRun: false })
  })

  it('refuses while another process holds the lease', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(rewindEpisode('pod-1', 'scripted', { dryRun: false })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(mockPrisma.podcast.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('refuses a published episode and keeps its audio', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'published', audioPath: 'episodes/x.mp3' }))
    await expect(rewindEpisode('pod-1', 'scripted', { dryRun: false })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writesWith('stage')).toHaveLength(0)
    expect(mockPrisma.podcastAudioChunk.deleteMany).not.toHaveBeenCalled()
    expect(mockAudio.deleteEpisodeObjects).not.toHaveBeenCalled()
  })

  it('refuses a legacy episode', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('legacy'))
    await expect(rewindEpisode('pod-1', 'created', { dryRun: false })).rejects.toThrow(/legacy/)
    expect(writesWith('stage')).toHaveLength(0)
  })

  it('with leaseHeld neither claims nor releases the lease', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(ready())
    await rewindEpisode('pod-1', 'scripted', { dryRun: false, leaseHeld: true })
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    expect(writesWith('leaseOwner')).toHaveLength(0)
    expect(writesWith('stage')[0].where).toEqual({ id: 'pod-1', leaseOwner: expect.any(String) })
  })
})

describe('withEpisodeLease', () => {
  beforeEach(setUp)

  it('runs the change on the episode read under the lease, fenced, then releases', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    const seen = await withEpisodeLease('pod-1', async ({ episode: ep, update }) => {
      await update({ title: 'New' })
      return ep.stage
    })
    expect(seen).toBe('selected')
    expect(writesWith('title')[0].where).toEqual({ id: 'pod-1', leaseOwner: expect.any(String) })
    expect(writesWith('leaseOwner')).toHaveLength(1)
  })

  it('refuses while a run holds the episode and releases after a failing change', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(withEpisodeLease('pod-1', async () => 'x')).rejects.toBeInstanceOf(PodcastRefusedError)

    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await expect(withEpisodeLease('pod-1', async () => { throw new Error('bad') })).rejects.toThrow('bad')
    expect(writesWith('leaseOwner')).toHaveLength(1)
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
