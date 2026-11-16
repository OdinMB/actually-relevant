import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetStoryIdsByStatus = vi.hoisted(() => vi.fn())
const mockPreAssessStories = vi.hoisted(() => vi.fn())

vi.mock('../services/story.js', () => ({
  getStoryIdsByStatus: mockGetStoryIdsByStatus,
}))
vi.mock('../services/analysis.js', () => ({
  preAssessStories: mockPreAssessStories,
}))

const { runPreassessStories } = await import('./preassessStories.js')
const { createRunScope, runInScope } = await import('../lib/runUsage.js')

/** Run the job in a run scope, as the scheduler does, and answer what it said it did. */
async function reported(): Promise<string | null> {
  const scope = createRunScope({ jobName: 'preassess_stories', flex: false })
  await runInScope(scope, runPreassessStories)
  return scope.summary
}

describe('runPreassessStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pre-assesses all fetched stories', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['story-1', 'story-2'])
    mockPreAssessStories.mockResolvedValue([
      { storyId: 'story-1', rating: 3, emotionTag: 'calm' },
      { storyId: 'story-2', rating: 5, emotionTag: 'calm' },
    ])

    await runPreassessStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('fetched')
    expect(mockPreAssessStories).toHaveBeenCalledWith(['story-1', 'story-2'])
  })

  it('says how many stories it rated, or that there was nothing to rate', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['story-1', 'story-2', 'story-3'])
    mockPreAssessStories.mockResolvedValue([{ storyId: 'story-1', rating: 3, emotionTag: 'calm' }])
    expect(await reported()).toBe('Rated 1 of 3 stories')
    mockPreAssessStories.mockResolvedValue([{ storyId: 'story-1' }, { storyId: 'story-2' }, { storyId: 'story-3' }])
    expect(await reported()).toBe('Rated 3 stories')
    mockGetStoryIdsByStatus.mockResolvedValue([])
    expect(await reported()).toBe('Nothing to rate')
  })

  it('does nothing when no fetched stories', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue([])

    await runPreassessStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('fetched')
    expect(mockPreAssessStories).not.toHaveBeenCalled()
  })
})
