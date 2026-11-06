/**
 * Actually Uplifting's stories against PostgreSQL (`upliftingIssue.ts`), through the lifecycle's assign
 * and select moves, with the model mocked.
 */
import { it, expect, vi, beforeEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createNewsletter, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('./llm.js', () => ({
  getLLMByTier: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  rateLimitDelay: () => Promise.resolve(),
}))

const { assignStories, selectStories } = await import('./newsletterLifecycle.js')
const { upliftingCandidateIds } = await import('./upliftingIssue.js')

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

describeDb('Actually Uplifting stories', () => {
  useTestDatabase()

  let feedId: string
  beforeEach(async () => {
    mockInvoke.mockReset()
    feedId = (await createFeed((await createIssue()).id)).id
  })

  const uplifting = (data: { relevance?: number | null; dateCrawled?: Date; status?: 'published' | 'analyzed' } = {}) =>
    createStory({
      feedId,
      status: data.status ?? 'published',
      emotionTag: 'uplifting',
      relevance: data.relevance ?? 5,
      dateCrawled: data.dateCrawled ?? daysAgo(1),
    })

  it("takes the week's published uplifting stories, most relevant first, then newest, and never reaches back", async () => {
    const newer = await uplifting({ relevance: 7, dateCrawled: daysAgo(1) })
    const best = await uplifting({ relevance: 9, dateCrawled: daysAgo(2) })
    const older = await uplifting({ relevance: 7, dateCrawled: daysAgo(3) })
    const unrated = await uplifting({ relevance: null, dateCrawled: daysAgo(0.5) })
    await createStory({ feedId, status: 'published', emotionTag: 'calm', relevance: 9, dateCrawled: daysAgo(1) })
    await uplifting({ status: 'analyzed' })
    await uplifting({ relevance: 9, dateCrawled: daysAgo(8) })

    expect(await upliftingCandidateIds()).toEqual([best.id, newer.id, older.id, unrated.id])
  })

  it('leaves out a story another built Actually Uplifting issue carries, and only such an issue', async () => {
    const carried = await uplifting({ relevance: 9 })
    const onFullIssue = await uplifting({ relevance: 8 })
    const onUnbuiltIssue = await uplifting({ relevance: 7 })
    await createNewsletter({ edition: 'uplifting', html: '<p>built</p>', selectedStoryIds: [carried.id] })
    await createNewsletter({ edition: 'full', html: '<p>built</p>', selectedStoryIds: [onFullIssue.id] })
    await createNewsletter({ edition: 'uplifting', html: '', selectedStoryIds: [onUnbuiltIssue.id] })

    expect(await upliftingCandidateIds()).toEqual([onFullIssue.id, onUnbuiltIssue.id])
  })

  it('assigns an issue its longlist, counting its own shortlist, and refuses a week with no uplifting story left', async () => {
    const story = await uplifting()
    const issue = await createNewsletter({ edition: 'uplifting', html: '<p>built</p>', selectedStoryIds: [story.id] })

    expect((await assignStories(issue.id)).storyIds).toEqual([story.id])

    const next = await createNewsletter({ edition: 'uplifting' })
    await expect(assignStories(next.id)).rejects.toMatchObject({ status: 400 })
    expect((await prisma.newsletter.findUniqueOrThrow({ where: { id: next.id } })).storyIds).toEqual([])
  })

  it('selects the whole longlist up to the issue size with no model call, a single story included', async () => {
    const one = await uplifting()
    const issue = await createNewsletter({ edition: 'uplifting' })
    await assignStories(issue.id)

    expect((await selectStories(issue.id)).selectedStoryIds).toEqual([one.id])

    const more = await Promise.all(Array.from({ length: 9 }, (_, i) => uplifting({ relevance: i })))
    await assignStories(issue.id)
    expect((await selectStories(issue.id)).selectedStoryIds.sort()).toEqual([one.id, ...more.map(s => s.id)].sort())
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('has the model pick the issue size from a longer longlist, keeping only longlist stories, each once', async () => {
    const stories = await Promise.all(Array.from({ length: 12 }, (_, i) => uplifting({ relevance: i % 10 })))
    const ids = stories.map(s => s.id)
    const issue = await createNewsletter({ edition: 'uplifting' })
    await assignStories(issue.id)
    mockInvoke.mockResolvedValueOnce({ selectedIds: [ids[0], ids[0], 'not-on-the-longlist', ...ids.slice(1, 11)] })

    const { selectedStoryIds } = await selectStories(issue.id)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(selectedStoryIds).toEqual(ids.slice(0, 10))
  })
})
