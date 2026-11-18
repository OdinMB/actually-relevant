import { describe, it, expect, vi, beforeEach } from 'vitest'

// Publishing itself (chunks, slugs, clusters, races) is tested on PostgreSQL: storyLifecycle.db.test.ts;
// which stories await research is researchQueue.db.test.ts's, which await their context cards storyContextQueue.db.test.ts's
const mockGetStoryIdsByStatus = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())
const mockAwaiting = vi.hoisted(() => vi.fn())
const mockAwaitingContext = vi.hoisted(() => vi.fn())

vi.mock('../services/story.js', () => ({
  getStoryIdsByStatus: mockGetStoryIdsByStatus,
}))
vi.mock('../services/storyLifecycle.js', () => ({ transition: mockTransition }))
vi.mock('../services/researchQueue.js', () => ({ awaitingResearch: mockAwaiting }))
vi.mock('../services/storyContextQueue.js', () => ({ awaitingContext: mockAwaitingContext }))

const { runPublishStories } = await import('./publishStories.js')
const { createRunScope, runInScope } = await import('../lib/runUsage.js')

describe('runPublishStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAwaiting.mockResolvedValue(new Set())
    mockAwaitingContext.mockResolvedValue(new Set())
    mockTransition.mockImplementation(async (ids: string[]) => ({ moved: ids, skipped: [] }))
  })

  it('does nothing when no stories are selected', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue([])

    await runPublishStories()

    expect(mockGetStoryIdsByStatus).toHaveBeenCalledWith('selected')
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('publishes every selected story while none awaits research or its context cards', async () => {
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

  it('leaves the stories awaiting their context cards for a later run too, and says how many wait for what', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['a', 'b', 'c', 'd'])
    mockAwaiting.mockResolvedValue(new Set(['b']))
    mockAwaitingContext.mockResolvedValue(new Set(['c']))

    const scope = createRunScope({ jobName: 'publish_stories', flex: false })
    await runInScope(scope, () => runPublishStories())

    expect(mockAwaitingContext).toHaveBeenCalledWith(['a', 'c', 'd'])
    expect(mockTransition).toHaveBeenCalledWith(['a', 'd'], { to: 'published' }, 'pipeline')
    expect(scope.summary).toBe('Published 2 stories, 1 waiting for research, 1 waiting for context cards')
  })

  it('publishes nothing when every selected story awaits research or its context cards', async () => {
    mockGetStoryIdsByStatus.mockResolvedValue(['a', 'b'])
    mockAwaiting.mockResolvedValue(new Set(['a']))
    mockAwaitingContext.mockResolvedValue(new Set(['b']))

    await runPublishStories()

    expect(mockTransition).not.toHaveBeenCalled()
  })
})
