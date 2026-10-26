/**
 * The synthetic data set against PostgreSQL: what it writes, that the public reads render it (with
 * the model and embedding modules mocked: the set has no embeddings and needs no model call), that
 * a rerun replaces it, and that a database holding other data is refused unless reset.
 */
import { it, expect, vi } from 'vitest'
import { StoryStatus } from '@prisma/client'
import prisma from '../../lib/prisma.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../../test/db/harness.js'

vi.mock('../../services/llm.js', () => ({
  getLLMByTier: () => {
    throw new Error('the synthetic data set must not need a model call')
  },
  rateLimitDelay: () => Promise.resolve(),
}))
vi.mock('../../services/embedding.js', () => ({
  generateEmbeddingForContent: vi.fn(),
  // A query embedding that works: search still finds nothing by meaning, because no story has an embedding
  generateSearchEmbedding: vi.fn(async () => axisVector(0)),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))

const { SyntheticSeedRefusal, describeSummary, foreignRows, seedSyntheticData } = await import('./seed.js')
const { SYNTHETIC_ADMIN, isoWeek, syntheticId } = await import('./dataset.js')
const { getClusterMembers, getHomepageData, getPublishedStories } = await import('../../services/publicStories.js')
const { getRelatedStories } = await import('../../services/relatedStories.js')
const { getPublishedIssue, listPublishedIssues } = await import('../../services/newsletterArchive.js')
const { getPublishedEpisode, getPublishedEpisodes } = await import('../../services/podcastPublish.js')
const { toPublicEpisodeDetail } = await import('../../services/podcastShow.js')
const { verifyPassword } = await import('../../services/auth.js')

// A Wednesday: the issues and episodes fall in ISO weeks 41 and 42, this week is 43
const NOW = new Date('2026-10-21T12:00:00Z')
const HOMEPAGE_ISSUES = ['human-development', 'planet-climate', 'existential-threats', 'science-technology']
const SLOW = 30_000 // bcrypt at the production cost, once per seed

const seed = (reset = false) => seedSyntheticData(prisma, { now: NOW, reset })

/** Every story's identity and lifecycle fields, in a stable order. */
const storySnapshot = () =>
  prisma.story.findMany({
    select: { id: true, status: true, rejectionReason: true, slug: true, clusterId: true, datePublished: true, issueId: true },
    orderBy: { id: 'asc' },
  })

/** The ids of the rows whose titles or week keys follow the date, and of the admin. */
const datedRowIds = async () => ({
  newsletters: (await prisma.newsletter.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(r => r.id),
  podcasts: (await prisma.podcast.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(r => r.id),
  users: (await prisma.user.findMany({ select: { id: true } })).map(r => r.id),
})

describeDb('synthetic data set (PostgreSQL)', () => {
  useTestDatabase()

  it(
    'fills an empty database with stories in every status, a cluster, newsletters, podcasts and an admin login',
    async () => {
      // A job the migrations seeded enabled: the seed keeps the row and switches it off
      await prisma.jobRun.create({ data: { jobName: 'crawl_feeds', cronExpression: '0 */6 * * *', enabled: true } })

      const summary = await seed()

      expect(await prisma.issue.count()).toBe(11)
      const feedsPerIssue = await prisma.feed.groupBy({ by: ['issueId'], _count: true })
      expect(feedsPerIssue).toHaveLength(5)
      expect(feedsPerIssue.every(f => f._count === 3)).toBe(true)

      const byStatus = Object.fromEntries((await prisma.story.groupBy({ by: ['status'], _count: true })).map(g => [g.status, g._count]))
      expect(Object.keys(byStatus).sort()).toEqual(Object.values(StoryStatus).sort())
      expect(byStatus).toEqual(summary.stories)
      expect(byStatus.published).toBe(26)
      expect(describeSummary(summary)).toContain('45 stories')

      const rejected = await prisma.story.findMany({ where: { status: 'rejected' }, select: { rejectionReason: true, accessTier: true, issueId: true } })
      expect(rejected.map(r => r.rejectionReason).sort()).toEqual([
        'assess_threshold',
        'duplicate',
        'duplicate',
        'editor',
        'paywall',
        'select_threshold',
        'selection',
      ])
      expect(rejected.find(r => r.rejectionReason === 'paywall')).toEqual({ rejectionReason: 'paywall', accessTier: 'locked', issueId: null })

      // No embeddings: nothing was sent to OpenAI to make them
      const embedded = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM stories WHERE embedding IS NOT NULL`
      expect(embedded).toEqual([{ n: 0 }])

      expect(await foreignRows(prisma)).toEqual({ feeds: 0, stories: 0, users: 0 })
      expect(await prisma.jobRun.findMany({ select: { jobName: true, enabled: true } })).toEqual([{ jobName: 'crawl_feeds', enabled: false }])

      const admin = await prisma.user.findUniqueOrThrow({ where: { email: SYNTHETIC_ADMIN.email } })
      expect(admin.role).toBe('admin')
      expect(await verifyPassword(SYNTHETIC_ADMIN.password, admin.passwordHash)).toBe(true)
    },
    SLOW,
  )

  it(
    'renders through the public reads: homepage, story, cluster, search, newsletter archive and podcast',
    async () => {
      await seed()

      // Every homepage section has stories in each of its three emotion buckets
      const { storiesByIssue } = await getHomepageData(HOMEPAGE_ISSUES, 7)
      for (const slug of HOMEPAGE_ISSUES) {
        const buckets = storiesByIssue[slug]!
        expect(
          [buckets.uplifting.length, buckets.calm.length, buckets.negative.length].every(n => n > 0),
          slug,
        ).toBe(true)
      }

      // The cluster's published primary lists the two other feeds' reports
      const cluster = await prisma.storyCluster.findFirstOrThrow({ include: { primaryStory: true, stories: true } })
      expect(cluster.primaryStory?.status).toBe('published')
      expect(cluster.stories.filter(s => s.id !== cluster.primaryStoryId).map(s => s.rejectionReason)).toEqual(['duplicate', 'duplicate'])
      expect((await getClusterMembers(cluster.primaryStory!.slug!))?.sources).toHaveLength(2)

      // Search falls back to text: only the published report of the tidal barrier
      const search = await getPublishedStories({ search: 'tidal' })
      expect(search.data.map(s => s.id)).toEqual([cluster.primaryStoryId])
      expect(await getRelatedStories(cluster.primaryStory!.slug!)).toEqual([])

      // Two published newsletter issues with their stories; this week's issue is a draft
      const archive = await listPublishedIssues(1, 20)
      expect(archive.data.map(i => i.slug)).toEqual(['week-42-2026', 'week-41-2026'])
      for (const { slug } of archive.data) {
        const issue = await getPublishedIssue(slug)
        expect(issue?.stories).toHaveLength(5)
        expect(issue?.stories.every(s => s.slug !== null)).toBe(true)
        expect(issue?.content).not.toContain('{story:')
      }
      const draft = await prisma.newsletter.findFirstOrThrow({ where: { status: 'draft' } })
      expect(draft).toMatchObject({ title: 'Week 43, 2026', slug: null, content: '' })
      expect(draft.selectedStoryIds).toHaveLength(3)

      // Two published episodes with transcripts; this week's episode waits after story selection
      const episodes = await getPublishedEpisodes()
      expect(episodes.map(e => e.stories.length)).toEqual([4, 4])
      const detail = toPublicEpisodeDetail((await getPublishedEpisode(episodes[0]!.id))!)
      expect(detail.transcript.filter(segment => segment.story !== null)).toHaveLength(4)
      expect(await prisma.podcast.findUniqueOrThrow({ where: { weekKey: isoWeek(NOW).key } })).toMatchObject({
        status: 'draft',
        stage: 'selected',
        dryRun: true,
      })
    },
    SLOW,
  )

  it(
    'a second run replaces the set with the same rows, and a run in a later week keeps every id',
    async () => {
      await seed()
      const first = await storySnapshot()
      const ids = await datedRowIds()
      await seed()
      expect(await storySnapshot()).toEqual(first)
      expect(await prisma.user.count()).toBe(1)
      expect(await prisma.storyCluster.count()).toBe(1)
      expect(first.find(s => s.id === syntheticId('story:wendrake-tidal-barrier'))?.status).toBe('published')
      expect(ids.users).toEqual([syntheticId('user:admin')])

      await seedSyntheticData(prisma, { now: new Date('2026-11-04T12:00:00Z'), reset: false })
      expect(await datedRowIds()).toEqual(ids)
      expect((await storySnapshot()).map(s => s.id)).toEqual(first.map(s => s.id))
      expect(await prisma.newsletter.findFirstOrThrow({ where: { status: 'draft' } })).toMatchObject({ title: 'Week 45, 2026' })
    },
    SLOW,
  )

  it('dates weeks by the rule the podcast pipeline uses', async () => {
    const { isoWeekKey } = await import('../../services/podcastWeekly.js')
    for (const day of ['2020-12-31', '2021-01-03', '2021-01-04', '2026-01-01', '2026-10-21', '2026-12-31', '2027-01-03', '2027-01-04']) {
      const date = new Date(`${day}T12:00:00Z`)
      expect(isoWeek(date).key, day).toBe(isoWeekKey(date))
    }
  })

  it('refuses a database holding data it did not write, and changes nothing', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    await createStory({ feedId: feed.id })

    await expect(seed()).rejects.toThrow(SyntheticSeedRefusal)
    await expect(seed()).rejects.toThrow(/1 feed\(s\), 1 story\(ies\) and 0 user\(s\)/)
    expect(await prisma.feed.findMany({ select: { id: true } })).toEqual([{ id: feed.id }])
    expect(await prisma.story.count()).toBe(1)
  })

  it(
    'with reset, deletes data it did not write and seeds',
    async () => {
      const issue = await createIssue()
      const feed = await createFeed(issue.id)
      await createStory({ feedId: feed.id })

      await seed(true)

      expect(await prisma.feed.findUnique({ where: { id: feed.id } })).toBeNull()
      expect(await foreignRows(prisma)).toEqual({ feeds: 0, stories: 0, users: 0 })
      expect(await prisma.story.count()).toBe(45)
    },
    SLOW,
  )
})
