import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  podcast: { findUnique: vi.fn(), findMany: vi.fn() },
  podcastAudioChunk: { count: vi.fn() },
  podcastTtsUsage: { aggregate: vi.fn(async () => ({ _sum: { chars: 5400 } })) },
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { getPodcastById, getActiveEpisodes } = await import('./podcast.js')
const { episodeChunks } = await import('./podcastAudioStages.js')

const LIVE = () => new Date(Date.now() + 60_000)
const turn = (speaker: 'HOST_A' | 'HOST_B', n: number) => ({ speaker, text: `Turn ${n} `.repeat(40).trim() })
const dialogue = {
  episodeTitle: 'T',
  episodeSummary: 'S',
  segments: [
    { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome to the week.' }] },
    { kind: 'story', storyRef: 1, turns: [turn('HOST_B', 1), turn('HOST_A', 2), turn('HOST_B', 3)] },
    { kind: 'story', storyRef: 2, turns: [turn('HOST_A', 4), turn('HOST_B', 5), turn('HOST_A', 6)] },
    { kind: 'outro', storyRef: null, turns: [{ speaker: 'HOST_B', text: 'That was the week.' }] },
  ],
}

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'p', stage: 'created', kind: 'weekly', mode: null, leaseUntil: null, lastError: null, blockedAt: null, dialogue: null, ...overrides }
}

describe('getPodcastById', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports an episode as in progress only while its lease is live', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ leaseUntil: LIVE() }))
    expect((await getPodcastById('p'))?.inProgress).toBe(true)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ leaseUntil: new Date(Date.now() - 60_000) }))
    expect((await getPodcastById('p'))?.inProgress).toBe(false)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row())
    expect((await getPodcastById('p'))?.inProgress).toBe(false)
  })

  it('adds the TTS characters spent on the episode', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'ready' }))
    expect((await getPodcastById('p'))?.ttsChars).toBe(5400)
    expect(mockPrisma.podcastTtsUsage.aggregate).toHaveBeenCalledWith({ _sum: { chars: true }, where: { podcastId: 'p' } })
  })

  it('is awaiting review only for an interactive episode at rest at selected or scripted, without error or block', async () => {
    const awaiting = async (overrides: Record<string, unknown>) => {
      mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ mode: 'interactive', ...overrides }))
      return (await getPodcastById('p'))?.awaitingReview
    }
    expect(await awaiting({ stage: 'selected' })).toBe(true)
    expect(await awaiting({ stage: 'scripted' })).toBe(true)
    expect(await awaiting({ stage: 'voiced' })).toBe(false)
    expect(await awaiting({ stage: 'scripted', leaseUntil: LIVE() })).toBe(false)
    expect(await awaiting({ stage: 'scripted', lastError: 'boom' })).toBe(false)
    expect(await awaiting({ stage: 'scripted', blockedAt: new Date() })).toBe(false)
    expect(await awaiting({ stage: 'scripted', mode: 'automated' })).toBe(false)
  })

  it('names the running step after the stage being left, and none at rest', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'scripted', leaseUntil: LIVE() }))
    expect((await getPodcastById('p'))?.activity).toBe('Voicing')
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'scripted' }))
    expect((await getPodcastById('p'))?.activity).toBeNull()
  })

  it('says why the episode cannot be published, and nothing for a ready draft with audio', async () => {
    const audio = { stage: 'ready', status: 'draft', dryRun: false, humanEdited: false, audioUrl: 'https://audio.example/e.mp3', audioBytes: 5_000_000 }
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ ...audio, mode: 'automated' }))
    expect((await getPodcastById('p'))?.publishBlockedReason).toBeNull()
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ ...audio, leaseUntil: LIVE() }))
    expect((await getPodcastById('p'))?.publishBlockedReason).toMatch(/run is working/)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ ...audio, stage: 'scripted' }))
    expect((await getPodcastById('p'))?.publishBlockedReason).toMatch(/at scripted/)
  })

  it('estimates the characters a voicing of the stored script sends, and none without a script', async () => {
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'scripted', dialogue }))
    const total = episodeChunks({ id: 'p', dialogue, kind: 'weekly' } as never).flat().reduce((n, t) => n + t.text.length, 0)
    expect((await getPodcastById('p'))?.ttsCharsEstimate).toBe(total)
    mockPrisma.podcast.findUnique.mockResolvedValueOnce(row({ stage: 'selected' }))
    expect((await getPodcastById('p'))?.ttsCharsEstimate).toBeNull()
  })
})

describe('getActiveEpisodes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists only episodes with a live lease, with the step and, while voicing, the chunk counts', async () => {
    mockPrisma.podcast.findMany.mockResolvedValueOnce([
      { id: 'a', title: 'W41: A', stage: 'scripted', mode: 'interactive', kind: 'weekly', dialogue },
      { id: 'b', title: 'W40: B', stage: 'created', mode: 'automated', kind: 'weekly', dialogue: null },
    ])
    mockPrisma.podcastAudioChunk.count.mockResolvedValueOnce(2)
    const now = new Date('2026-10-10T06:00:00Z')

    const active = await getActiveEpisodes(now)

    expect(mockPrisma.podcast.findMany.mock.calls[0][0].where).toEqual({ leaseUntil: { gt: now } })
    expect(active[0]).toEqual({
      id: 'a', title: 'W41: A', stage: 'scripted', mode: 'interactive', activity: 'Voicing',
      chunksDone: 2, chunksTotal: episodeChunks({ id: 'a', dialogue, kind: 'weekly' } as never).length,
    })
    expect(active[1]).toMatchObject({ id: 'b', activity: 'Selecting stories', chunksDone: null, chunksTotal: null })
    expect(mockPrisma.podcastAudioChunk.count).toHaveBeenCalledTimes(1)
  })
})
