import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fixtureStories, goodDialogue, withTurn } from '../test/podcastFixtures.js'
import type { PodcastDialogue } from '../schemas/llm.js'

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  podcast: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  podcastAudioChunk: { deleteMany: vi.fn() },
}))
const mockPool = vi.hoisted(() => ({ loadEpisodePool: vi.fn() }))
const mockFeed = vi.hoisted(() => ({ invalidateFeedCache: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./podcastFeed.js', () => mockFeed)
vi.mock('./podcastScript.js', async importOriginal => ({ ...(await importOriginal<typeof import('./podcastScript.js')>()), ...mockPool }))
// Pinned, so the tests do not change meaning when the owner confirms the edited AI line.
vi.mock('../lib/aiLabelCopy.js', async importOriginal => ({ ...(await importOriginal<typeof import('../lib/aiLabelCopy.js')>()), PODCAST_EPISODE_AI_LINE_EDITED_CONFIRMED: false }))

const { replaceEpisodeStories, saveEpisodeScript, updateEpisodeMeta, getEpisodeStoryPool, PodcastEditRejectedError } = await import('./podcastEditing.js')
const { PodcastRefusedError } = await import('./podcastGuards.js')
const { PODCAST_EPISODE_AI_LINE, PODCAST_EPISODE_AI_LINE_EDITED } = await import('../lib/aiLabelCopy.js')

const SELECTED_AT = new Date('2026-10-10T06:00:00Z')
const poolEntry = (n: number) => ({ id: `s${n}`, title: `Story ${n}`, publisher: `Pub ${n}`, sourceUrl: `https://news.example/${n}`, slug: `story-${n}`, issue: `Issue ${n}`, relevance: 8 })
const POOL = [1, 2, 3, 4, 5, 6, 7].map(poolEntry)
const snapshots = fixtureStories.map(s => ({ ref: s.ref, id: `s${s.ref}`, title: s.title, publisher: s.publisher, sourceUrl: `https://news.example/${s.ref}`, slug: null, issue: 'I' }))

function episode(stage: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'pod-1', stage, status: 'draft', humanEdited: false, createdAt: new Date('2026-10-05T06:00:00Z'), storiesSelectedAt: SELECTED_AT,
    storyIds: ['s1', 's2', 's3', 's4'], episodeStories: snapshots, dialogue: null, episodeSummary: 'Summary.', showNotes: '', ...overrides,
  }
}

/** The data of every fenced write but the lease release. */
const writes = () => mockPrisma.podcast.updateMany.mock.calls.map(c => c[0].data).filter(d => !('leaseOwner' in d))

const asEdit = (d: PodcastDialogue) => ({
  episodeSummary: d.episodeSummary,
  segments: d.segments.map(s => ({ kind: s.kind, storyRef: s.storyRef, turns: s.turns.map(t => ({ speaker: t.speaker, text: t.text })) })),
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.podcastAudioChunk.deleteMany.mockResolvedValue({ count: 0 })
  mockPool.loadEpisodePool.mockResolvedValue(POOL)
})

describe('replaceEpisodeStories', () => {
  it('refuses fewer than the minimum, more than the maximum and duplicates, before taking the lease', async () => {
    for (const ids of [['s1', 's2', 's3'], ['s1', 's2', 's3', 's4', 's5', 's6'], ['s1', 's1', 's2', 's3']]) {
      await expect(replaceEpisodeStories('pod-1', ids)).rejects.toBeInstanceOf(PodcastEditRejectedError)
    }
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('refuses a story outside the week\'s pool and saves nothing', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await expect(replaceEpisodeStories('pod-1', ['s1', 's2', 's3', 'elsewhere'])).rejects.toThrow(/not in this week's pool: elsewhere/)
    expect(writes()).toHaveLength(0)
  })

  it('refuses any stage but selected, and an episode in progress', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('scripted'))
    await expect(replaceEpisodeStories('pod-1', ['s1', 's2', 's3', 's4'])).rejects.toBeInstanceOf(PodcastRefusedError)
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(replaceEpisodeStories('pod-1', ['s1', 's2', 's3', 's4'])).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writes()).toHaveLength(0)
  })

  it('rebuilds the snapshot with refs in the submitted order and ticks "edited by a person"', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await replaceEpisodeStories('pod-1', ['s5', 's2', 's3', 's4', 's1'])
    const [data] = writes()
    expect(data.storyIds).toEqual(['s5', 's2', 's3', 's4', 's1'])
    expect(data.episodeStories.map((s: { ref: number; id: string }) => [s.ref, s.id])).toEqual([[1, 's5'], [2, 's2'], [3, 's3'], [4, 's4'], [5, 's1']])
    expect(data.episodeStories[0]).toEqual({ ref: 1, id: 's5', title: 'Story 5', publisher: 'Pub 5', sourceUrl: 'https://news.example/5', slug: 'story-5', issue: 'Issue 5' })
    expect(data.humanEdited).toBe(true)
  })

  it('does not tick the flag when the same stories are saved in the same order', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await replaceEpisodeStories('pod-1', ['s1', 's2', 's3', 's4'])
    expect(writes()[0].humanEdited).toBe(false)
  })
})

describe('saveEpisodeScript', () => {
  const scripted = (overrides: Record<string, unknown> = {}) => episode('scripted', { dialogue: goodDialogue(), ...overrides })

  it('refuses an episode that is not at scripted', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await expect(saveEpisodeScript('pod-1', asEdit(goodDialogue()))).rejects.toBeInstanceOf(PodcastRefusedError)
  })

  it('saves nothing and returns the errors when the edit breaks a hard rule', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted())
    const err = await saveEpisodeScript('pod-1', asEdit(withTurn(goodDialogue(), 2, 1, 'Read more at https://example.org now.'))).catch(e => e)
    expect(err).toBeInstanceOf(PodcastEditRejectedError)
    expect(err.errors.join(' ')).toMatch(/URL/)
    expect(writes()).toHaveLength(0)
  })

  it('refuses an edit whose structure no longer matches the stored script', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted())
    const edit = asEdit(goodDialogue())
    edit.segments[2].turns[0].speaker = edit.segments[2].turns[0].speaker === 'HOST_A' ? 'HOST_B' : 'HOST_A'
    await expect(saveEpisodeScript('pod-1', edit)).rejects.toThrow(/changed since it was opened/)
    expect(writes()).toHaveLength(0)
  })

  it('saves a valid edit with a segue warning, ticks the flag and rebuilds the script and show notes', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted())
    const edit = asEdit(withTurn(goodDialogue(), 2, 0, 'And now, vaccines.'))
    edit.episodeSummary = 'A person wrote this summary.'

    const { warnings } = await saveEpisodeScript('pod-1', edit)

    expect(warnings.join(' ')).toMatch(/spoken bridge/)
    const [data] = writes()
    expect(data.humanEdited).toBe(true)
    expect(data.dialogue.segments[2].turns[0].text).toBe('And now, vaccines.')
    expect(data.episodeSummary).toBe('A person wrote this summary.')
    expect(data.script).toContain('And now, vaccines.')
    expect(data.showNotes.split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE_EDITED)
    expect(data.showNotes).toContain('A person wrote this summary.')
  })

  it('does not tick the flag on a save of identical text', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted())
    await saveEpisodeScript('pod-1', asEdit(goodDialogue()))
    expect(writes()[0].humanEdited).toBe(false)
    expect(writes()[0].showNotes.split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE)
  })

  it('discards the audio chunks a failed voicing left behind when a spoken turn changed', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted({ lastError: 'chunk 3 failed' }))
    await saveEpisodeScript('pod-1', asEdit(withTurn(goodDialogue(), 1, 0, 'A rewritten line for the first story.')))
    expect(mockPrisma.podcastAudioChunk.deleteMany).toHaveBeenCalledWith({ where: { podcastId: 'pod-1' } })
    expect(mockPrisma.podcastAudioChunk.deleteMany.mock.invocationCallOrder[0])
      .toBeGreaterThan(mockPrisma.podcast.updateMany.mock.invocationCallOrder[0])
  })

  it('keeps the stored chunks when only the summary changed or nothing did', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted())
    await saveEpisodeScript('pod-1', { ...asEdit(goodDialogue()), episodeSummary: 'A new summary.' })
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(scripted())
    await saveEpisodeScript('pod-1', asEdit(goodDialogue()))
    expect(mockPrisma.podcastAudioChunk.deleteMany).not.toHaveBeenCalled()
  })
})

describe('updateEpisodeMeta', () => {
  it('changes the title without ticking the flag', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { showNotes: `${PODCAST_EPISODE_AI_LINE}\n\nSummary.` }))
    await updateEpisodeMeta('pod-1', { title: 'W41: A better title' })
    expect(writes()).toEqual([{ title: 'W41: A better title' }])
  })

  it('refuses a title change before the script exists', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await expect(updateEpisodeMeta('pod-1', { title: 'Too early' })).rejects.toBeInstanceOf(PodcastRefusedError)
  })

  it('ticks and unticks the flag, and the show notes\' AI line follows it', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('scripted', { showNotes: 'old notes' }))
    await updateEpisodeMeta('pod-1', { humanEdited: true })
    expect(writes()[0].humanEdited).toBe(true)
    expect(writes()[0].showNotes.split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE_EDITED)

    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('scripted', { humanEdited: true, showNotes: 'old notes' }))
    await updateEpisodeMeta('pod-1', { humanEdited: false })
    expect(writes()[1].humanEdited).toBe(false)
    expect(writes()[1].showNotes.split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE)
  })

  it('refuses a title change on an episode that was ever published, and any change on a legacy one', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'published', publishedAt: new Date() }))
    await expect(updateEpisodeMeta('pod-1', { title: 'x' })).rejects.toBeInstanceOf(PodcastRefusedError)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'draft', publishedAt: new Date(), unpublishedAt: new Date() }))
    await expect(updateEpisodeMeta('pod-1', { title: 'x' })).rejects.toBeInstanceOf(PodcastRefusedError)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('legacy'))
    await expect(updateEpisodeMeta('pod-1', { humanEdited: true })).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writes()).toHaveLength(0)
    expect(mockFeed.invalidateFeedCache).not.toHaveBeenCalled()
  })

  it('toggles the flag on a published episode, rebuilds its show notes and its feed', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'published', publishedAt: new Date(), humanEdited: true, showNotes: 'old notes' }))
    await updateEpisodeMeta('pod-1', { humanEdited: false })
    expect(writes()[0].showNotes.split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE)
    expect(mockFeed.invalidateFeedCache).toHaveBeenCalledOnce()
  })

  it('refuses ticking the flag on a listed episode while the edited AI line is unconfirmed', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'published', publishedAt: new Date(), showNotes: 'old notes' }))
    await expect(updateEpisodeMeta('pod-1', { humanEdited: true })).rejects.toThrow(/Edited by a person/)
    expect(writes()).toHaveLength(0)
    expect(mockFeed.invalidateFeedCache).not.toHaveBeenCalled()
  })

  it('allows ticking the flag on an episode that was taken down (republishing is refused instead)', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { status: 'draft', publishedAt: new Date(), unpublishedAt: new Date(), showNotes: 'old notes' }))
    await updateEpisodeMeta('pod-1', { humanEdited: true })
    expect(writes()[0].humanEdited).toBe(true)
  })

  it('leaves the feed alone for an episode that was never published', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('ready', { showNotes: 'old notes' }))
    await updateEpisodeMeta('pod-1', { humanEdited: true })
    expect(mockFeed.invalidateFeedCache).not.toHaveBeenCalled()
  })
})

describe('getEpisodeStoryPool', () => {
  it('lists the pool the model chose from (anchored on the selection), marking its stories, with the limits', async () => {
    const pool = await getEpisodeStoryPool(episode('selected'))
    expect(mockPool.loadEpisodePool).toHaveBeenCalledWith(SELECTED_AT)
    expect(pool.stories.filter(s => s.selected).map(s => s.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(pool.minStories).toBeLessThanOrEqual(pool.maxStories)
  })

  it('checks a replacement against the same pool', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode('selected'))
    await replaceEpisodeStories('pod-1', ['s1', 's2', 's3', 's5'])
    expect(mockPool.loadEpisodePool).toHaveBeenCalledWith(SELECTED_AT)
  })
})
