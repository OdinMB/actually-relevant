import { describe, it, expect, vi, beforeEach } from 'vitest'

// Publishing itself (chunks, slugs, clusters, races) is tested on PostgreSQL: storyLifecycle.db.test.ts
const mockGetStoryIdsByStatus = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())

vi.mock('../services/story.js', () => ({
  getStoryIdsByStatus: mockGetStoryIdsByStatus,
}))
vi.mock('../services/storyLifecycle.js', () => ({ transition: mockTransition }))

const { runPublishStories } = await import('./publishStories.js')

describe('runPublishStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when no stories are selected', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue([])

    await runPublishStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('selected')
    expect(mockTransition).not.toHaveBeenCalled()
  })
})
