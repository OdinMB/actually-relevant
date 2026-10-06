import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ podcastAudioChunk: { findMany: vi.fn() } }))
const mockElevenLabs = vi.hoisted(() => ({
  textToDialogue: vi.fn(),
  ElevenLabsQuotaError: class ElevenLabsQuotaError extends Error {},
}))
const mockAudio = vi.hoisted(() => ({
  assembleEpisodeMp3: vi.fn(),
  silentMp3: vi.fn(),
  cbrDurationMs: (bytes: number) => bytes, // 1 byte = 1 ms keeps the arithmetic visible
}))
const mockBunny = vi.hoisted(() => ({
  isBunnyConfigured: vi.fn(() => true),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  publicUrl: (path: string) => `https://cdn.example/${path}`,
}))
const mockGuards = vi.hoisted(() => ({
  reserveTtsChars: vi.fn(),
  assertBalanceCovers: vi.fn(),
  assertJobEnabled: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/elevenlabs.js', () => mockElevenLabs)
vi.mock('../lib/podcastAudio.js', () => mockAudio)
vi.mock('../lib/bunnyStorage.js', () => mockBunny)
vi.mock('./podcastGuards.js', async importOriginal => ({ ...(await importOriginal<typeof import('./podcastGuards.js')>()), ...mockGuards }))

const stages = await import('./podcastAudioStages.js')
const { PodcastBlockedError, PodcastStoppedError } = await import('./podcastGuards.js')
const { config } = await import('../config.js')

const turn = (speaker: 'HOST_A' | 'HOST_B', mark: string) => ({ speaker, text: `${mark} `.repeat(70).trim() }) // ~349 chars
const story = (ref: number) => ({ kind: 'story', storyRef: ref, turns: [turn('HOST_B', `s${ref}b`), turn('HOST_A', `s${ref}a`), turn('HOST_B', `s${ref}c`)] })
const dialogue = {
  episodeTitle: 'Week 41',
  episodeSummary: 'Summary.',
  segments: [
    { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome to the show, here is the first story of the week.' }] },
    story(1), story(2), story(3),
    { kind: 'outro', storyRef: null, turns: [{ speaker: 'HOST_B', text: 'And that brings us back from the last story to the wider week.' }] },
  ],
}

function episode(overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', stage: 'scripted', status: 'draft', title: 'Week 41', weekKey: '2026-W41', dryRun: false, dialogue, ...overrides } as never
}

function context(trigger: 'cron' | 'admin' = 'admin') {
  return { trigger, renewLease: vi.fn(), storeChunk: vi.fn() }
}

const CHUNKS = stages.episodeChunks({ id: 'pod-1', dialogue } as never)

describe('voiceEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.podcastAudioChunk.findMany.mockResolvedValue([])
    mockElevenLabs.textToDialogue.mockImplementation(async () => ({ audio: Buffer.alloc(500), requestId: 'req', chars: 1, characterCost: 100 }))
    mockAudio.silentMp3.mockResolvedValue(Buffer.alloc(300))
  })

  it('voices every chunk in order with the two voices and text continuity, storing each before the next', async () => {
    expect(CHUNKS.length).toBeGreaterThanOrEqual(3)
    const ctx = context()
    const write = await stages.voiceEpisode(episode(), ctx)

    expect(mockElevenLabs.textToDialogue).toHaveBeenCalledTimes(CHUNKS.length)
    const first = mockElevenLabs.textToDialogue.mock.calls[0][0]
    expect(first.inputs[0]).toEqual({ text: CHUNKS[0][0].text, voiceId: config.podcast.voiceIdA })
    expect(first.previousText).toBeUndefined()
    expect(first.futureText).toBeDefined()
    expect(mockElevenLabs.textToDialogue.mock.calls.at(-1)![0].futureText).toBeUndefined()
    expect(ctx.storeChunk.mock.calls.map(c => c[0].index)).toEqual(CHUNKS.map((_, i) => i))
    expect(ctx.storeChunk.mock.calls[0][0]).toMatchObject({ requestId: 'req', durationMs: 500 })
    expect(write).toMatchObject({ stage: 'voiced', ttsModelId: config.podcast.ttsModelId, voiceIds: { HOST_A: config.podcast.voiceIdA, HOST_B: config.podcast.voiceIdB } })
  })

  it('reserves each chunk\'s characters before its call, and checks the balance once for the rest', async () => {
    await stages.voiceEpisode(episode(), context())
    const total = CHUNKS.reduce((n, c) => n + c.reduce((m, t) => m + t.text.length, 0), 0)
    expect(mockGuards.assertBalanceCovers).toHaveBeenCalledWith(total)
    expect(mockGuards.reserveTtsChars).toHaveBeenCalledTimes(CHUNKS.length)
    expect(mockGuards.reserveTtsChars.mock.invocationCallOrder[0]).toBeLessThan(mockElevenLabs.textToDialogue.mock.invocationCallOrder[0])
  })

  it('skips stored chunks on a resume, so nothing is paid twice', async () => {
    mockPrisma.podcastAudioChunk.findMany.mockResolvedValueOnce([{ index: 0 }, { index: 1 }])
    const ctx = context()
    await stages.voiceEpisode(episode(), ctx)
    expect(mockElevenLabs.textToDialogue).toHaveBeenCalledTimes(CHUNKS.length - 2)
    expect(mockGuards.reserveTtsChars).toHaveBeenCalledTimes(CHUNKS.length - 2)
    expect(ctx.storeChunk.mock.calls.map(c => c[0].index)).toEqual(CHUNKS.map((_, i) => i).slice(2))
  })

  it('stops before the TTS call when the reservation is refused', async () => {
    mockGuards.reserveTtsChars.mockRejectedValueOnce(new PodcastBlockedError('monthly TTS cap reached'))
    await expect(stages.voiceEpisode(episode(), context())).rejects.toBeInstanceOf(PodcastBlockedError)
    expect(mockElevenLabs.textToDialogue).not.toHaveBeenCalled()
  })

  it('blocks on an ElevenLabs credit or auth refusal', async () => {
    mockElevenLabs.textToDialogue.mockRejectedValueOnce(new mockElevenLabs.ElevenLabsQuotaError('HTTP 402'))
    await expect(stages.voiceEpisode(episode(), context())).rejects.toBeInstanceOf(PodcastBlockedError)
  })

  it('always uses the silent stub in a dry run: no balance check, no reservation, no TTS call', async () => {
    const ctx = context('cron')
    mockGuards.assertJobEnabled.mockResolvedValue(undefined)
    const write = await stages.voiceEpisode(episode({ dryRun: true }), ctx)
    expect(mockElevenLabs.textToDialogue).not.toHaveBeenCalled()
    expect(mockGuards.reserveTtsChars).not.toHaveBeenCalled()
    expect(mockGuards.assertBalanceCovers).not.toHaveBeenCalled()
    expect(mockAudio.silentMp3).toHaveBeenCalledTimes(CHUNKS.length)
    const firstChars = CHUNKS[0].reduce((n, t) => n + t.text.length, 0)
    expect(mockAudio.silentMp3).toHaveBeenCalledWith(firstChars / config.podcast.stubCharsPerSecond)
    expect(write.ttsModelId).toBe(stages.STUB_MODEL_ID)
  })

  it('on the cron trigger stops before the next TTS call once the job is disabled, keeping stored chunks', async () => {
    mockGuards.assertJobEnabled.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new PodcastStoppedError('generate_podcast'))
    const ctx = context('cron')
    await expect(stages.voiceEpisode(episode(), ctx)).rejects.toBeInstanceOf(PodcastStoppedError)
    expect(mockGuards.assertJobEnabled).toHaveBeenCalledWith(stages.GENERATE_PODCAST_JOB)
    expect(mockElevenLabs.textToDialogue).toHaveBeenCalledTimes(1)
    expect(ctx.storeChunk).toHaveBeenCalledTimes(1)
  })

  it('on the admin trigger ignores the job row', async () => {
    await stages.voiceEpisode(episode(), context('admin'))
    expect(mockGuards.assertJobEnabled).not.toHaveBeenCalled()
  })
})

describe('finishEpisode', () => {
  const stored = () => CHUNKS.map((_, i) => ({ index: i, bytes: new Uint8Array([i]), durationMs: 1000 * (i + 1) }))

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.podcastAudioChunk.findMany.mockResolvedValue(stored())
    mockAudio.assembleEpisodeMp3.mockResolvedValue({ buffer: Buffer.alloc(4000), durationSec: 312 })
  })
  afterEach(() => mockBunny.isBunnyConfigured.mockReturnValue(true))

  it('assembles with the pause and loudnorm, uploads MP3 and VTT under a fresh name, and returns the fields', async () => {
    const write = await stages.finishEpisode(episode({ stage: 'voiced' }), context())

    const [buffers, tags, opts] = mockAudio.assembleEpisodeMp3.mock.calls[0]
    expect(buffers).toHaveLength(CHUNKS.length)
    expect(tags).toMatchObject({ title: 'Week 41', artist: config.podcast.showTitle })
    expect(tags.comment).toMatch(/^AI-generated/)
    expect(opts).toEqual({ pauseMs: config.podcast.segmentPauseMs, loudnorm: true })

    const [[mp3Path, , mp3Type], [vttPath, vtt, vttType]] = mockBunny.putObject.mock.calls
    expect(mp3Path).toMatch(/^episodes\/2026-W41-[0-9a-f]{8}\.mp3$/)
    expect(vttPath).toBe(mp3Path.replace(/\.mp3$/, '.vtt'))
    expect([mp3Type, vttType]).toEqual(['audio/mpeg', 'text/vtt'])
    expect(vtt.toString()).toMatch(/^WEBVTT/)
    expect(write).toMatchObject({
      stage: 'ready', audioPath: mp3Path, audioUrl: `https://cdn.example/${mp3Path}`, transcriptPath: vttPath,
      audioBytes: 4000, durationSec: 312, readyAt: expect.any(Date),
    })
  })

  it('never reuses a file name across renders', async () => {
    await stages.finishEpisode(episode({ stage: 'voiced' }), context())
    await stages.finishEpisode(episode({ stage: 'voiced' }), context())
    const paths = mockBunny.putObject.mock.calls.map(c => c[0])
    expect(new Set(paths).size).toBe(4)
  })

  it('puts a dry run under dry-run/ without loudnorm', async () => {
    await stages.finishEpisode(episode({ stage: 'voiced', dryRun: true }), context())
    expect(mockBunny.putObject.mock.calls[0][0]).toMatch(/^dry-run\/episodes\//)
    expect(mockAudio.assembleEpisodeMp3.mock.calls[0][2].loudnorm).toBe(false)
  })

  it('stops at voiced when storage is not configured', async () => {
    mockBunny.isBunnyConfigured.mockReturnValue(false)
    await expect(stages.finishEpisode(episode({ stage: 'voiced' }), context())).rejects.toThrow('storage not configured')
    expect(mockAudio.assembleEpisodeMp3).not.toHaveBeenCalled()
  })

  it('refuses when the stored chunks do not match the dialogue', async () => {
    mockPrisma.podcastAudioChunk.findMany.mockResolvedValueOnce(stored().slice(1))
    await expect(stages.finishEpisode(episode({ stage: 'voiced' }), context())).rejects.toThrow(/stored chunks/)
    expect(mockBunny.putObject).not.toHaveBeenCalled()
  })
})

describe('deleteEpisodeObjects', () => {
  it('deletes both objects and survives a storage failure', async () => {
    vi.clearAllMocks()
    mockBunny.deleteObject.mockResolvedValue(undefined)
    mockBunny.deleteObject.mockRejectedValueOnce(new Error('401'))
    await expect(stages.deleteEpisodeObjects({ id: 'pod-1', audioPath: 'episodes/a.mp3', transcriptPath: 'episodes/a.vtt' })).resolves.toBeUndefined()
    expect(mockBunny.deleteObject.mock.calls.map(c => c[0])).toEqual(['episodes/a.mp3', 'episodes/a.vtt'])
  })
})
