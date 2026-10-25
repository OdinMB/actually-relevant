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
const { PODCAST_EPISODE_COPY } = await import('../lib/aiLabelCopy.js')

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
  return { id: 'pod-1', stage: 'scripted', status: 'draft', title: 'Week 41', weekKey: '2026-W41', kind: 'weekly', dryRun: false, dialogue, ...overrides } as never
}

function context(trigger: 'cron' | 'admin' = 'admin') {
  return { trigger, renewLease: vi.fn(), storeChunk: vi.fn() }
}

const CHUNKS = stages.episodeChunks({ id: 'pod-1', dialogue, kind: 'weekly' } as never)

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

  it('voices every chunk with the episode\'s own seed, or the configured one when it has none', async () => {
    await stages.voiceEpisode(episode({ ttsSeed: 4242 }), context())
    expect(new Set(mockElevenLabs.textToDialogue.mock.calls.map(c => c[0].seed))).toEqual(new Set([4242]))
    mockElevenLabs.textToDialogue.mockClear()
    await stages.voiceEpisode(episode({ ttsSeed: null }), context())
    expect(mockElevenLabs.textToDialogue.mock.calls[0][0].seed).toBe(config.podcast.ttsSeed)
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

  it('voices a standalone episode live now that its wording is confirmed, with the usual balance check and reservations', async () => {
    const standalone = episode({ kind: 'standalone', weekKey: null })
    const ctx = context()
    const write = await stages.voiceEpisode(standalone, ctx)
    const chunks = stages.episodeChunks({ id: 'pod-1', dialogue, kind: 'standalone' } as never)
    expect(mockGuards.assertBalanceCovers).toHaveBeenCalledOnce()
    expect(mockGuards.reserveTtsChars).toHaveBeenCalledTimes(chunks.length)
    expect(mockElevenLabs.textToDialogue).toHaveBeenCalledTimes(chunks.length)
    expect(write).toMatchObject({ stage: 'voiced' })
  })

  it('voices a standalone dry run with the stub, its standalone opener and sign-off in the chunks', async () => {
    const ctx = context()
    await stages.voiceEpisode(episode({ kind: 'standalone', weekKey: null, dryRun: true }), ctx)
    expect(ctx.storeChunk).toHaveBeenCalled()
    const chunks = stages.episodeChunks({ id: 'pod-1', dialogue, kind: 'standalone' } as never)
    expect(chunks[0][0].text).toBe(PODCAST_EPISODE_COPY.standalone.opener)
    expect(chunks.at(-1)!.at(-1)!.text).toBe(PODCAST_EPISODE_COPY.standalone.signOff)
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
    expect(tags.comment).toBe(PODCAST_EPISODE_COPY.weekly.aiLine)
    expect(opts).toEqual({ pauseMs: config.podcast.segmentPauseMs, loudnorm: true })

    const [[mp3Path, , mp3Type], [vttPath, vtt, vttType], [chaptersPath, , chaptersType]] = mockBunny.putObject.mock.calls
    expect(mp3Path).toMatch(/^episodes\/2026-W41-[0-9a-f]{8}\.mp3$/)
    expect(vttPath).toBe(mp3Path.replace(/\.mp3$/, '.vtt'))
    expect(chaptersPath).toBe(mp3Path.replace(/\.mp3$/, '.chapters.json'))
    expect([mp3Type, vttType, chaptersType]).toEqual(['audio/mpeg', 'text/vtt', 'application/json'])
    expect(vtt.toString()).toMatch(/^WEBVTT/)
    expect(write).toMatchObject({
      stage: 'ready', audioPath: mp3Path, audioUrl: `https://cdn.example/${mp3Path}`, transcriptPath: vttPath,
      chaptersPath, chaptersUrl: `https://cdn.example/${chaptersPath}`,
      audioBytes: 4000, durationSec: 312, readyAt: expect.any(Date),
    })
  })

  it('uploads chapters titled and linked from the frozen stories, timed on the stored chunk durations', async () => {
    const episodeStories = [1, 2, 3].map(ref => ({
      ref, id: `s${ref}`, title: `Story ${ref} headline`, publisher: 'P', sourceUrl: `https://src.example/${ref}`,
      slug: ref === 2 ? null : `story-${ref}`, issue: 'Planet',
    }))
    await stages.finishEpisode(episode({ stage: 'voiced', episodeStories }), context())

    const doc = JSON.parse(mockBunny.putObject.mock.calls[2][1].toString())
    expect(doc.version).toBe('1.2.0')
    expect(doc.chapters.map((c: { title: string }) => c.title)).toEqual([
      'Introduction', 'Story 1 headline', 'Story 2 headline', 'Story 3 headline', 'Wrap-up',
    ])
    expect(doc.chapters[0].startTime).toBe(0)
    expect(doc.chapters[1].url).toBe(`${config.siteUrl}/stories/story-1`)
    // A story without a slug has no page to link
    expect(doc.chapters[2]).not.toHaveProperty('url')
    const starts = doc.chapters.map((c: { startTime: number }) => c.startTime)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    // The last chapter starts before the episode ends (stored durations 1,000 ms × index plus pauses)
    const totalMs = stored().reduce((n, r) => n + r.durationMs, 0) + (CHUNKS.length - 1) * config.podcast.segmentPauseMs
    expect(starts.at(-1) * 1000).toBeLessThan(totalMs)
  })

  it('never reuses a file name across renders', async () => {
    await stages.finishEpisode(episode({ stage: 'voiced' }), context())
    await stages.finishEpisode(episode({ stage: 'voiced' }), context())
    const paths = mockBunny.putObject.mock.calls.map(c => c[0])
    expect(new Set(paths).size).toBe(6)
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
  it('deletes all three objects and survives a storage failure', async () => {
    vi.clearAllMocks()
    mockBunny.deleteObject.mockResolvedValue(undefined)
    mockBunny.deleteObject.mockRejectedValueOnce(new Error('401'))
    await expect(stages.deleteEpisodeObjects({
      id: 'pod-1', audioPath: 'episodes/a.mp3', transcriptPath: 'episodes/a.vtt', chaptersPath: 'episodes/a.chapters.json',
    })).resolves.toBeUndefined()
    expect(mockBunny.deleteObject.mock.calls.map(c => c[0])).toEqual(['episodes/a.mp3', 'episodes/a.vtt', 'episodes/a.chapters.json'])
  })

  it('skips the chapters of an episode made before chapters existed', async () => {
    vi.clearAllMocks()
    mockBunny.deleteObject.mockResolvedValue(undefined)
    await stages.deleteEpisodeObjects({ id: 'pod-1', audioPath: 'episodes/a.mp3', transcriptPath: 'episodes/a.vtt', chaptersPath: null })
    expect(mockBunny.deleteObject.mock.calls.map(c => c[0])).toEqual(['episodes/a.mp3', 'episodes/a.vtt'])
  })
})
