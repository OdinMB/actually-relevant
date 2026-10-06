import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  podcast: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
}))
const mockScript = vi.hoisted(() => ({
  selectEpisodeStories: vi.fn(),
  writeEpisodeScript: vi.fn(),
  buildShowNotes: vi.fn(() => 'notes'),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./podcastScript.js', () => mockScript)

const { advanceEpisode, resetEpisode, releaseHeldLeases, LeaseLostError } = await import('./podcastPipeline.js')
const { PODCAST_OPENER } = await import('../lib/aiLabelCopy.js')

const snapshot = (ref: number) => ({ ref, id: `story-${ref}`, title: `T${ref}`, publisher: 'P', sourceUrl: 'https://x.example', slug: `t${ref}`, issue: 'I' })
const dialogue = {
  episodeTitle: 'Episode title',
  episodeSummary: 'Summary.',
  segments: [{ kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome.' }] }],
}

function episode(stage: string, overrides: Record<string, unknown> = {}) {
  return { id: 'pod-1', stage, title: 'Week', leaseOwner: null, leaseUntil: null, ...overrides }
}

/** Every updateMany whose data carries a given key. */
const writesWith = (key: string) => mockPrisma.podcast.updateMany.mock.calls.map(c => c[0]).filter(a => key in a.data)

describe('advanceEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockResolvedValue(1)
    mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
    mockScript.selectEpisodeStories.mockResolvedValue([1, 2, 3, 4].map(n => ({ snapshot: snapshot(n), prompt: {} })))
    mockScript.writeEpisodeScript.mockResolvedValue({ dialogue, modelId: 'gpt-6-sol' })
  })

  it('returns busy without running a stage when another process holds the lease', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'busy' })
    expect(mockScript.selectEpisodeStories).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.updateMany).not.toHaveBeenCalled()
  })

  it('writes the script stage from created, fenced on its own lease, then releases the lease', async () => {
    mockPrisma.podcast.findUniqueOrThrow
      .mockResolvedValueOnce(episode('created'))
      .mockResolvedValueOnce(episode('scripted'))

    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'scripted' })

    const [stageWrite] = writesWith('stage')
    expect(stageWrite.where).toEqual({ id: 'pod-1', leaseOwner: expect.any(String) })
    expect(stageWrite.data).toMatchObject({
      stage: 'scripted', title: 'Episode title', episodeSummary: 'Summary.', showNotes: 'notes',
      storyIds: ['story-1', 'story-2', 'story-3', 'story-4'], scriptModelId: 'gpt-6-sol', lastError: null,
    })
    expect(stageWrite.data.episodeStories).toEqual([1, 2, 3, 4].map(snapshot))
    expect(stageWrite.data.script.startsWith(`HOST A: ${PODCAST_OPENER}`)).toBe(true)
    const [release] = writesWith('leaseOwner')
    expect(release).toEqual({ where: { id: 'pod-1', leaseOwner: stageWrite.where.leaseOwner }, data: { leaseOwner: null, leaseUntil: null } })
  })

  it('runs no stage for an episode that is already scripted', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('scripted'))
    expect(await advanceEpisode('pod-1', { trigger: 'admin' })).toEqual({ status: 'done', stage: 'scripted' })
    expect(mockScript.selectEpisodeStories).not.toHaveBeenCalled()
  })

  it('keeps the stage on a failure, records the error and rethrows', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('created'))
    mockScript.writeEpisodeScript.mockRejectedValueOnce(new Error('model down'))

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow('model down')

    expect(writesWith('stage')).toHaveLength(0)
    const [failure] = writesWith('lastError')
    expect(failure.data).toEqual({ lastError: 'model down', failedAt: expect.any(Date) })
    expect(failure.where.leaseOwner).toEqual(expect.any(String))
    expect(writesWith('leaseOwner')).toHaveLength(1)
  })

  it('aborts when the stage write finds the lease taken by another process', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('created'))
    mockPrisma.podcast.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ count: 'stage' in args.data ? 0 : 1 }))

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(writesWith('lastError').filter(a => a.data.lastError !== null)).toHaveLength(0)
  })

  it('aborts before the next stage when renewing the lease fails', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('created'))
    mockPrisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toBeInstanceOf(LeaseLostError)
    expect(mockScript.selectEpisodeStories).not.toHaveBeenCalled()
  })

  it('refuses a legacy episode', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('legacy'))
    await expect(advanceEpisode('pod-1', { trigger: 'admin' })).rejects.toThrow(/legacy/)
  })
})

describe('resetEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockResolvedValue(1)
    mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
  })

  it('takes a scripted episode back to created and clears the script', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('scripted'))
    await resetEpisode('pod-1', { dryRun: false })
    const [reset] = writesWith('stage')
    expect(reset.data).toMatchObject({ stage: 'created', dryRun: false, script: '', showNotes: '', episodeSummary: '', storyIds: [], scriptModelId: null })
  })

  it('refuses while another process holds the lease', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(resetEpisode('pod-1', { dryRun: false })).rejects.toThrow(/in progress/)
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
