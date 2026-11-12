import { describe, it, expect, vi, beforeEach } from 'vitest'

// Publishing itself (chunks, slugs, clusters, races) is tested on PostgreSQL: storyLifecycle.db.test.ts;
// which stories await research is researchQueue.db.test.ts's
const mockGetStoryIdsByStatus = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())
const mockAwaiting = vi.hoisted(() => vi.fn())

vi.mock('../services/story.js', () => ({
  getStoryIdsByStatus: mockGetStoryIdsByStatus,
}))
vi.mock('../services/storyLifecycle.js', () => ({ transition: mockTransition }))
vi.mock('../services/researchQueue.js', () => ({ awaitingResearch: mockAwaiting }))

const { runPublishStories } = await import('./publishStories.js')

describe('runPublishStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAwaiting.mockResolvedValue(new Set())
    mockTransition.mockImplementation(async (ids: string[]) => ({ moved: ids, skipped: [] }))
  })

  it('does nothing when no stories are selected', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue([])

    await runPublishStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('selected')
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('publishes every selected story while none awaits research', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['a', 'b'])

    await runPublishStories()

    expect(mockAwaiting).toHaveBeenCalledWith(['a', 'b'])
    expect(mockTransition).toHaveBeenCalledWith(['a', 'b'], { to: 'published' }, 'pipeline')
  })

  it('leaves the stories awaiting research for a later run', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['a', 'b', 'c'])
    mockAwaiting.mockResolvedValue(new Set(['b']))

    await runPublishStories()

    expect(mockTransition).toHaveBeenCalledWith(['a', 'c'], { to: 'published' }, 'pipeline')
  })

  it('publishes nothing when every selected story awaits research', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['a'])
    mockAwaiting.mockResolvedValue(new Set(['a']))

    await runPublishStories()

    expect(mockTransition).not.toHaveBeenCalled()
  })
})
