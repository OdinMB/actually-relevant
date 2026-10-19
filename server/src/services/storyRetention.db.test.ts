import { it, expect, vi, beforeEach } from 'vitest'
import { StoryStatus } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, monthsAgo, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import { clearOldEmbeddingsBatch, deleteOldStoriesBatch, DELETABLE_STATUSES, getLifetimeStoryStats } from './storyRetention.js'
import { repairClusters } from './clusterRepair.js'

const mockNotify = vi.hoisted(() => vi.fn())
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
// storyWrites.ts (deleteStory) imports the OpenAI-backed modules; nothing here calls them
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: vi.fn(), generateSearchEmbedding: vi.fn(), ensureEmbedding: vi.fn(), ensureEmbeddings: vi.fn(),
}))

const { runCleanupOldStories } = await import('../jobs/cleanupOldStories.js')
const { deleteStory } = await import('./story.js')

const OLD = () => monthsAgo(7)
const YOUNG = () => monthsAgo(5)

async function setup() {
  const issue = await createIssue()
  const feed = await createFeed(issue.id)
  return { issue, feed }
}

const exists = async (id: string) => (await prisma.story.count({ where: { id } })) === 1

async function clusterOf(memberIds: string[], primaryId: string | null) {
  const cluster = await prisma.storyCluster.create({ data: { primaryStoryId: primaryId } })
  await prisma.story.updateMany({ where: { id: { in: memberIds } }, data: { clusterId: cluster.id } })
  return cluster.id
}

describeDb('story retention (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => { mockNotify.mockReset().mockResolvedValue(undefined) })

  it('deletes old stories of every deletable status and nothing else', async () => {
    const { feed } = await setup()
    const deletable: string[] = []
    for (const status of DELETABLE_STATUSES) {
      deletable.push((await createStory({ feedId: feed.id, status, dateCrawled: OLD() })).id)
    }
    const kept: string[] = []
    for (const status of [StoryStatus.published, StoryStatus.analyzed, StoryStatus.selected]) {
      kept.push((await createStory({ feedId: feed.id, status, dateCrawled: OLD() })).id)
    }
    for (const status of DELETABLE_STATUSES) {
      kept.push((await createStory({ feedId: feed.id, status, dateCrawled: YOUNG() })).id)
    }

    const { deletedByStatus } = await deleteOldStoriesBatch(6, 100)

    expect(deletedByStatus).toEqual({ fetched: 1, pre_analyzed: 1, rejected: 1, trashed: 1 })
    for (const id of deletable) expect(await exists(id)).toBe(false)
    for (const id of kept) expect(await exists(id)).toBe(true)
  })

  it('keeps old stories that a social post, newsletter, podcast or published cluster sibling names', async () => {
    const { feed } = await setup()
    const old = () => createStory({ feedId: feed.id, status: 'rejected', dateCrawled: OLD() })

    const onBluesky = await old()
    await prisma.blueskyPost.create({ data: { storyId: onBluesky.id, postText: 'x' } })
    const onMastodon = await old()
    await prisma.mastodonPost.create({ data: { storyId: onMastodon.id, postText: 'x' } })
    const inNewsletter = await old()
    const selectedForNewsletter = await old()
    await prisma.newsletter.create({ data: { title: 'n', storyIds: [inNewsletter.id], selectedStoryIds: [selectedForNewsletter.id] } })
    const inPodcast = await old()
    await prisma.podcast.create({ data: { title: 'p', storyIds: [inPodcast.id] } })
    const siblingOfPublished = await old()
    const published = await createStory({ feedId: feed.id, status: 'published', dateCrawled: OLD() })
    await clusterOf([siblingOfPublished.id, published.id], published.id)
    const unkept = await old()

    const { deletedByStatus } = await deleteOldStoriesBatch(6, 100)

    expect(deletedByStatus).toEqual({ rejected: 1 })
    expect(await exists(unkept.id)).toBe(false)
    for (const s of [onBluesky, onMastodon, inNewsletter, selectedForNewsletter, inPodcast, siblingOfPublished, published]) {
      expect(await exists(s.id)).toBe(true)
    }
  })

  it('counts each deleted story into story_archive_counts by month, feed, issue, status, ratings and emotion', async () => {
    const { issue, feed } = await setup()
    const crawled = new Date(Date.UTC(2025, 0, 15, 12))
    for (let i = 0; i < 2; i++) {
      const s = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: crawled, issueId: issue.id })
      await prisma.story.update({ where: { id: s.id }, data: { relevancePre: 3, relevance: 4, emotionTag: 'calm' } })
    }
    await createStory({ feedId: feed.id, status: 'fetched', dateCrawled: crawled })

    await deleteOldStoriesBatch(6, 100)

    const rows = await prisma.storyArchiveCount.findMany({ orderBy: { status: 'asc' } })
    expect(rows.map(r => ({ ...r, id: undefined, createdAt: undefined }))).toEqual([
      expect.objectContaining({ feedId: feed.id, issueId: null, status: 'fetched', relevancePre: null, relevance: null, emotionTag: null, storyCount: 1 }),
      expect.objectContaining({ feedId: feed.id, issueId: issue.id, status: 'rejected', relevancePre: 3, relevance: 4, emotionTag: 'calm', storyCount: 2 }),
    ])
    expect(rows[0].crawlMonth.toISOString().slice(0, 10)).toBe('2025-01-01')

    const stats = await getLifetimeStoryStats()
    expect(stats).toMatchObject({ total: 3, archived: 3, byStatus: { rejected: 2, fetched: 1 } })
  })

  it('deletes in batches of the limit, oldest first, and a second run finds nothing', async () => {
    const { feed } = await setup()
    const ids = []
    for (let i = 0; i < 3; i++) {
      ids.push((await createStory({ feedId: feed.id, status: 'trashed', dateCrawled: monthsAgo(9 - i) })).id)
    }

    expect((await deleteOldStoriesBatch(6, 2)).deletedByStatus).toEqual({ trashed: 2 })
    expect(await exists(ids[0])).toBe(false)
    expect(await exists(ids[2])).toBe(true)
    expect((await deleteOldStoriesBatch(6, 2)).deletedByStatus).toEqual({ trashed: 1 })
    expect((await deleteOldStoriesBatch(6, 2)).deletedByStatus).toEqual({})

    const total = await prisma.storyArchiveCount.aggregate({ _sum: { storyCount: true } })
    expect(total._sum.storyCount).toBe(3)
  })

  it('reports the clusters of deleted stories', async () => {
    const { feed } = await setup()
    const a = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: OLD() })
    const b = await createStory({ feedId: feed.id, status: 'analyzed', dateCrawled: YOUNG() })
    const clusterId = await clusterOf([a.id, b.id], a.id)

    expect((await deleteOldStoriesBatch(6, 100)).clusterIds).toEqual([clusterId])
  })

  it('clears the embeddings of old unpublished stories only', async () => {
    const { feed } = await setup()
    const oldAnalyzed = await createStory({ feedId: feed.id, status: 'analyzed', dateCrawled: OLD() })
    const oldPublished = await createStory({ feedId: feed.id, status: 'published', dateCrawled: OLD() })
    const youngAnalyzed = await createStory({ feedId: feed.id, status: 'analyzed', dateCrawled: YOUNG() })
    for (const [i, s] of [oldAnalyzed, oldPublished, youngAnalyzed].entries()) {
      await setEmbedding(s.id, i)
      await prisma.story.update({ where: { id: s.id }, data: { embeddingContentHash: 'h', embeddingGeneratedAt: new Date() } })
    }

    expect(await clearOldEmbeddingsBatch(6, 100)).toBe(1)

    const rows = await prisma.$queryRaw<{ id: string; has: boolean; embedding_content_hash: string | null }[]>`
      SELECT id, embedding IS NOT NULL AS has, embedding_content_hash FROM stories`
    const byId = new Map(rows.map(r => [r.id, r]))
    expect(byId.get(oldAnalyzed.id)).toMatchObject({ has: false, embedding_content_hash: null })
    expect(byId.get(oldPublished.id)).toMatchObject({ has: true, embedding_content_hash: 'h' })
    expect(byId.get(youngAnalyzed.id)).toMatchObject({ has: true, embedding_content_hash: 'h' })
  })

  it('the job repairs clusters like deleteStory: re-elects a lost primary, dissolves clusters left with one member or none', async () => {
    const { feed } = await setup()
    // A: old primary deleted, two younger members stay -> new primary, the higher-rated one
    const aOld = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: OLD(), relevance: 9 })
    const aLow = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: YOUNG(), relevance: 3 })
    const aHigh = await createStory({ feedId: feed.id, status: 'analyzed', dateCrawled: YOUNG(), relevance: 6 })
    const clusterA = await clusterOf([aOld.id, aLow.id, aHigh.id], aOld.id)
    // B: old primary deleted, one member stays -> dissolved
    const bOld = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: OLD() })
    const bYoung = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: YOUNG() })
    const clusterB = await clusterOf([bOld.id, bYoung.id], bOld.id)
    // C: every member old and deletable -> gone
    const c1 = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: OLD() })
    const c2 = await createStory({ feedId: feed.id, status: 'trashed', dateCrawled: OLD() })
    const clusterC = await clusterOf([c1.id, c2.id], c1.id)
    // D: untouched by the deletion -> unchanged
    const d1 = await createStory({ feedId: feed.id, status: 'analyzed', dateCrawled: YOUNG() })
    const d2 = await createStory({ feedId: feed.id, status: 'rejected', dateCrawled: YOUNG() })
    const clusterD = await clusterOf([d1.id, d2.id], d1.id)

    const result = await runCleanupOldStories()

    expect(result).toMatchObject({ deleted: 4, clustersDeleted: 2, primariesReElected: 1 })
    expect((await prisma.storyCluster.findUnique({ where: { id: clusterA } }))?.primaryStoryId).toBe(aHigh.id)
    expect(await prisma.storyCluster.findUnique({ where: { id: clusterB } })).toBeNull()
    expect((await prisma.story.findUniqueOrThrow({ where: { id: bYoung.id } })).clusterId).toBeNull()
    expect(await prisma.storyCluster.findUnique({ where: { id: clusterC } })).toBeNull()
    expect((await prisma.storyCluster.findUnique({ where: { id: clusterD } }))?.primaryStoryId).toBe(d1.id)
    expect(mockNotify).toHaveBeenCalledTimes(1)

    // Idempotent: nothing more to delete or repair
    expect(await runCleanupOldStories()).toMatchObject({ deleted: 0, clustersDeleted: 0, primariesReElected: 0 })
  })

  it('deleteStory uses the same repair', async () => {
    const { feed } = await setup()
    const p = await createStory({ feedId: feed.id, status: 'analyzed', relevance: 8 })
    const m1 = await createStory({ feedId: feed.id, status: 'rejected', relevance: 2 })
    const m2 = await createStory({ feedId: feed.id, status: 'rejected', relevance: 5 })
    const clusterId = await clusterOf([p.id, m1.id, m2.id], p.id)

    await deleteStory(p.id)
    expect((await prisma.storyCluster.findUniqueOrThrow({ where: { id: clusterId } })).primaryStoryId).toBe(m2.id)

    await deleteStory(m2.id)
    expect(await prisma.storyCluster.findUnique({ where: { id: clusterId } })).toBeNull()
    expect((await prisma.story.findUniqueOrThrow({ where: { id: m1.id } })).clusterId).toBeNull()

    // A cluster that is already gone is not an error
    expect(await repairClusters([clusterId])).toEqual({ dissolved: 0, reElected: 0 })
  })
})
