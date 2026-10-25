import { describe, it, expect, vi, beforeEach } from 'vitest'

// The below-minimum rejection is a status move: storyLifecycle.db.test.ts covers it on PostgreSQL
const mockGetStoryIdsByStatus = vi.hoisted(() => vi.fn())
const mockSelectStoriesInGroups = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())

vi.mock('../services/story.js', () => ({
  getStoryIdsByStatus: mockGetStoryIdsByStatus,
}))
vi.mock('../services/analysis.js', () => ({
  selectStoriesInGroups: mockSelectStoriesInGroups,
}))
vi.mock('../services/storyLifecycle.js', () => ({ transition: mockTransition }))

const { runSelectStories } = await import('./selectStories.js')

describe('runSelectStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransition.mockResolvedValue({ moved: [], skipped: [] })
  })

  it('selects from recent analyzed stories', async () => {
    mockGetStoryIdsByStatus
      .mockResolvedValueOnce(['story-1', 'story-2']) // snapshot: all analyzed
      .mockResolvedValueOnce(['story-1', 'story-2']) // qualified
    mockSelectStoriesInGroups.mockResolvedValue({ selected: 1, rejected: 1, skipped: 0, errors: 0 })

    await runSelectStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('analyzed', { relevanceMin: 5 })
    expect(mockSelectStoriesInGroups).toHaveBeenCalledWith(['story-1', 'story-2'])
  })

  it('does nothing when no analyzed stories', async () => {
    mockGetStoryIdsByStatus
      .mockResolvedValueOnce([]) // snapshot: all analyzed (empty)
      .mockResolvedValueOnce([]) // qualified (empty)

    await runSelectStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('analyzed', { relevanceMin: 5 })
    expect(mockSelectStoriesInGroups).not.toHaveBeenCalled()
  })
})
