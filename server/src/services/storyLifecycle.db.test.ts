/**
 * Story status moves and cluster edits against PostgreSQL. The OpenAI-backed modules are mocked; a
 * mocked call that changes a row mid-call (an editor trashing the story while the model runs) is
 * how the races are reproduced. Known defects are `it.fails`, each naming the step of
 * `.plans/2026-10-19_story-lifecycle-and-db-tests.md` that fixes it.
 */
import { it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import type { BaseMessage } from '@langchain/core/messages'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import {
  axisVector, createCluster, createFeed, createIssue, createStory, describeDb, setEmbedding, statusesOf, useTestDatabase,
} from '../test/db/harness.js'

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('./llm.js', () => ({
  getLLMByTier: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  getMediumLLM: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  getSmallLLM: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  rateLimitDelay: () => Promise.resolve(),
}))
const mockEnsureEmbeddings = vi.hoisted(() => vi.fn())
const mockGenerate = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerate,
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: (id: string) => mockEnsureEmbeddings([id]),
  ensureEmbeddings: mockEnsureEmbeddings,
}))

const {
  publishStory, rejectStory, updateStoryStatus, dissolveCluster: dissolveStoryCluster, getPublishedStoryBySlug,
  createStory: createStoryViaService,
} = await import('./story.js')
const { runPublishStories } = await import('../jobs/publishStories.js')
const { runAssessStories } = await import('../jobs/assessStories.js')
const { runSelectStories } = await import('../jobs/selectStories.js')
const { selectStories, assessStory, preAssessStories } = await import('./analysis.js')
const { transition } = await import('./storyLifecycle.js')
const { detectAndCluster } = await import('./dedup.js')
const { dissolveCluster, removeFromCluster, mergeClusters, setClusterPrimary, createManualCluster } = await import('./cluster.js')

let feedId = ''
let issueSlug = ''
const story = (data: Omit<Parameters<typeof createStory>[0], 'feedId'> = {}) => createStory({ feedId, ...data })
const row = async (id: string) => (await statusesOf([id])).get(id)!
const primaryOf = async (clusterId: string) =>
  (await prisma.storyCluster.findUnique({ where: { id: clusterId }, select: { primaryStoryId: true } }))?.primaryStoryId
const promptOf = (messages: BaseMessage[]) => messages.map(m => String(m.content)).join('\n')

const assessAnswer = (rating = 7) => ({
  publicationDate: '1970-01-01 00:00:00', quote: 'q', quoteAttribution: 'Original article', summary: 'New summary',
  factors: ['- f'], limitingFactors: ['- l'], relevanceCalculation: ['- c'], conservativeRating: rating,
  relevanceSummary: 'rs', titleLabel: 'Label', relevanceTitle: 'New title', marketingBlurb: 'mb',
})

const dedupWasEnabled = config.dedup.enabled

describeDb('story lifecycle (PostgreSQL)', () => {
  useTestDatabase()
  // Dedup after assessment is fire-and-forget; its own cases call it directly
  beforeAll(() => { config.dedup.enabled = false })
  afterAll(() => { config.dedup.enabled = dedupWasEnabled })

  beforeEach(async () => {
    mockInvoke.mockReset()
    mockEnsureEmbeddings.mockReset().mockResolvedValue(undefined)
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(5), hash: 'assessed' })
    const issue = await createIssue()
    issueSlug = issue.slug
    feedId = (await createFeed(issue.id)).id
  })

  // ──── Selection ─────────────────────────────────────────────────────────

  it('a story trashed during the select call stays trashed and is not published next', async () => {
    const a = await story({ status: 'analyzed', relevance: 8 })
    const b = await story({ status: 'analyzed', relevance: 8 })
    mockInvoke.mockImplementation(async () => {
      await updateStoryStatus(a.id, 'trashed')
      return { selectedIds: [a.id, b.id] }
    })

    const result = await selectStories([a.id, b.id])

    expect(result.selected).toEqual([b.id])
    expect(result.skipped).toEqual([a.id])
    expect((await row(a.id)).status).toBe('trashed')
    await runPublishStories()
    expect((await row(a.id)).status).toBe('trashed')
    expect((await row(b.id)).status).toBe('published')
  })

  it('a story an editor rejects during the select call stays rejected', async () => {
    const a = await story({ status: 'analyzed', relevance: 8 })
    mockInvoke.mockImplementation(async () => {
      await rejectStory(a.id)
      return { selectedIds: [a.id] }
    })

    const result = await selectStories([a.id])

    expect(result.selected).toEqual([])
    expect((await row(a.id)).status).toBe('rejected')
  })

  it('selection never revives a trashed story and never shows it to the model', async () => {
    const primary = await story({ status: 'analyzed', relevance: 8 })
    const trashedMember = await story({ status: 'trashed' })
    const trashedLoner = await story({ status: 'trashed' })
    await createCluster([primary.id, trashedMember.id], primary.id)
    mockInvoke.mockResolvedValue({ selectedIds: [primary.id] })

    await selectStories([primary.id, trashedMember.id, trashedLoner.id])

    expect((await row(trashedMember.id)).status).toBe('trashed')
    expect((await row(trashedLoner.id)).status).toBe('trashed')
    expect(promptOf(mockInvoke.mock.calls[0][0])).not.toContain(trashedLoner.id)
  })

  it('selection records why it rejected: a duplicate, or not picked', async () => {
    const primary = await story({ status: 'analyzed', relevance: 8 })
    const member = await story({ status: 'analyzed', relevance: 8 })
    const notPicked = await story({ status: 'analyzed', relevance: 8 })
    await createCluster([primary.id, member.id], primary.id)
    mockInvoke.mockResolvedValue({ selectedIds: [primary.id] })

    const result = await selectStories([primary.id, member.id, notPicked.id])

    expect(result).toEqual({ selected: [primary.id], rejected: [member.id, notPicked.id], skipped: [] })
    expect(await row(primary.id)).toMatchObject({ status: 'selected', rejectionReason: null })
    expect(await row(member.id)).toMatchObject({ status: 'rejected', rejectionReason: 'duplicate' })
    expect(await row(notPicked.id)).toMatchObject({ status: 'rejected', rejectionReason: 'selection' })
  })

  // ──── Assessment and pre-assessment ─────────────────────────────────────

  it('re-assessing a published story refreshes it and keeps it on the site', async () => {
    const s = await story({ status: 'published', slug: 'live', title: 'Old title', datePublished: new Date() })
    await setEmbedding(s.id, 1)
    mockInvoke.mockResolvedValue(assessAnswer())

    expect(await assessStory(s.id, 'editor')).toBe('refreshed')

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id } })
    expect(after.status).toBe('published')
    expect(after.title).toBe('New title')
    expect(after.embeddingContentHash).toBe('assessed')
    expect(await getPublishedStoryBySlug('live')).not.toBeNull()
  })

  it('re-assessing a selected story keeps it selected', async () => {
    const s = await story({ status: 'selected' })
    mockInvoke.mockResolvedValue(assessAnswer())
    await assessStory(s.id, 'editor')
    expect((await row(s.id)).status).toBe('selected')
  })

  it('an editor re-assessing a paywall-rejected story re-queues it as analyzed and clears the reason', async () => {
    const s = await story({ status: 'rejected', rejectionReason: 'paywall', accessTier: 'locked' })
    mockInvoke.mockResolvedValue(assessAnswer())
    expect(await assessStory(s.id, 'editor')).toBe('advanced')
    expect(await row(s.id)).toMatchObject({ status: 'analyzed', rejectionReason: null })
  })

  it('the assess job never takes a story out of rejected', async () => {
    const s = await story({ status: 'rejected', rejectionReason: 'editor' })
    expect(await assessStory(s.id)).toBe('skipped')
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(await row(s.id)).toMatchObject({ status: 'rejected', rejectionReason: 'editor' })
  })

  it('assessing a trashed story makes no model call and leaves it trashed', async () => {
    const s = await story({ status: 'trashed' })
    mockInvoke.mockResolvedValue(assessAnswer())
    expect(await assessStory(s.id, 'editor')).toBe('skipped')
    expect(mockInvoke).not.toHaveBeenCalled()
    expect((await row(s.id)).status).toBe('trashed')
  })

  it('a story trashed during the assess call stays trashed and gets no embedding', async () => {
    const s = await story({ status: 'pre_analyzed' })
    mockInvoke.mockImplementation(async () => {
      await updateStoryStatus(s.id, 'trashed')
      return assessAnswer()
    })

    expect(await assessStory(s.id)).toBe('skipped')

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id } })
    expect(after.status).toBe('trashed')
    expect(after.title).toBeNull()
    expect(after.embeddingContentHash).toBeNull()
  })

  it('re-screening a published story rewrites relevancePre and keeps it published', async () => {
    const s = await story({ status: 'published', slug: 'p' })
    await prisma.story.update({ where: { id: s.id }, data: { relevancePre: 3 } })
    mockInvoke.mockResolvedValue({ articles: [{ articleId: s.id, issueSlug, rating: 9, emotionTag: 'calm' }] })

    await preAssessStories([s.id], undefined, 'editor')

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id } })
    expect(after.relevancePre).toBe(9)
    expect(after.status).toBe('published')
  })

  it('an editor pre-assessing a rejected story re-queues it; the job leaves it alone', async () => {
    const byEditor = await story({ status: 'rejected', rejectionReason: 'paywall' })
    const byJob = await story({ status: 'rejected', rejectionReason: 'paywall' })
    mockInvoke.mockImplementation(async (messages: BaseMessage[]) => ({
      articles: [byEditor.id, byJob.id].filter(id => promptOf(messages).includes(id))
        .map(articleId => ({ articleId, issueSlug, rating: 6, emotionTag: 'calm' })),
    }))

    await preAssessStories([byEditor.id], undefined, 'editor')
    await preAssessStories([byJob.id])

    expect(await row(byEditor.id)).toMatchObject({ status: 'pre_analyzed', rejectionReason: null })
    expect(await row(byJob.id)).toMatchObject({ status: 'rejected', rejectionReason: 'paywall' })
  })

  it('pre-assessing a trashed story makes no model call', async () => {
    const s = await story({ status: 'trashed' })
    mockInvoke.mockResolvedValue({ articles: [{ articleId: s.id, issueSlug, rating: 9, emotionTag: 'calm' }] })
    await preAssessStories([s.id], undefined, 'editor')
    expect(mockInvoke).not.toHaveBeenCalled()
    expect((await row(s.id)).status).toBe('trashed')
  })

  it('a story trashed during the pre-assess call stays trashed', async () => {
    const s = await story({ status: 'fetched' })
    mockInvoke.mockImplementation(async () => {
      await updateStoryStatus(s.id, 'trashed')
      return { articles: [{ articleId: s.id, issueSlug, rating: 9, emotionTag: 'calm' }] }
    })

    await preAssessStories([s.id])

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id } })
    expect(after.status).toBe('trashed')
    expect(after.relevancePre).toBeNull()
  })

  // ──── Publishing ────────────────────────────────────────────────────────

  it('a story trashed while the publish job ensures embeddings gets no slug or date and is not counted', async () => {
    const s = await story({ status: 'selected', title: 'Will be trashed' })
    const other = await story({ status: 'selected', title: 'Goes live' })
    mockEnsureEmbeddings.mockImplementation(async () => {
      await prisma.$executeRaw`UPDATE stories SET status = 'trashed' WHERE id = ${s.id}`
    })

    const result = await transition([s.id, other.id], { to: 'published' }, 'pipeline')

    expect(result).toEqual({ moved: [other.id], skipped: [{ id: s.id, status: 'trashed' }] })
    expect(await row(s.id)).toMatchObject({ status: 'trashed', slug: null, datePublished: null })
    expect(await row(other.id)).toMatchObject({ status: 'published', slug: 'goes-live' })
  })

  it('publishing works through bounded chunks, each with its own embedding pass', async () => {
    const chunkSize = config.publish.chunkSize
    config.publish.chunkSize = 2
    try {
      const ids = []
      for (let i = 0; i < 5; i++) ids.push((await story({ status: 'selected', title: 'Same title' })).id)

      await runPublishStories()

      expect(mockEnsureEmbeddings).toHaveBeenCalledTimes(3)
      const slugs = [...(await statusesOf(ids)).values()].map(r => { expect(r.status).toBe('published'); return r.slug })
      expect(new Set(slugs).size).toBe(5)
    } finally {
      config.publish.chunkSize = chunkSize
    }
  })

  it('the publish job publishes a cluster primary, not a selected non-primary', async () => {
    const primary = await story({ status: 'selected', title: 'Primary', relevance: 9 })
    const member = await story({ status: 'selected', title: 'Member', relevance: 5 })
    const clusterId = await createCluster([primary.id, member.id], primary.id)

    await runPublishStories()

    expect((await row(primary.id)).status).toBe('published')
    expect(await row(member.id)).toMatchObject({ status: 'rejected', rejectionReason: 'duplicate', slug: null })
    expect(await primaryOf(clusterId)).toBe(primary.id)
  })

  it('an editor publishing a non-primary makes it primary and rejects the unpublished former one', async () => {
    const primary = await story({ status: 'analyzed', relevance: 9 })
    const member = await story({ status: 'rejected', title: 'Member' })
    const keptPublished = await story({ status: 'published', slug: 'kept', datePublished: new Date() })
    const clusterId = await createCluster([primary.id, member.id, keptPublished.id], primary.id)
    // The kept one was published later than the member will be: the member wins the election
    await prisma.story.update({ where: { id: keptPublished.id }, data: { datePublished: new Date(Date.now() + 60_000) } })

    await publishStory(member.id)

    expect(await primaryOf(clusterId)).toBe(member.id)
    expect(await row(primary.id)).toMatchObject({ status: 'rejected', rejectionReason: 'duplicate' })
    expect((await row(keptPublished.id)).status).toBe('published')
  })

  it('an editor can publish a trashed story, and publishing a published one changes nothing', async () => {
    const trashed = await story({ status: 'trashed', title: 'Back from the bin' })
    await publishStory(trashed.id)
    const published = await row(trashed.id)
    expect(published.status).toBe('published')
    expect(published.slug).toBe('back-from-the-bin')

    await publishStory(trashed.id)
    expect(await row(trashed.id)).toEqual(published)
  })

  it('an editor publishing a rejected story clears its reason', async () => {
    const s = await story({ status: 'rejected', rejectionReason: 'paywall', title: 'Override' })
    await publishStory(s.id)
    expect(await row(s.id)).toMatchObject({ status: 'published', rejectionReason: null, slug: 'override' })
  })

  it('unpublishing keeps the slug and the publish date', async () => {
    const date = new Date('2026-09-01T00:00:00Z')
    const s = await story({ status: 'published', slug: 'stays', datePublished: date })
    await updateStoryStatus(s.id, 'analyzed')
    expect(await row(s.id)).toMatchObject({ status: 'analyzed', slug: 'stays', datePublished: date })
  })

  // ──── Dissolve and remove ───────────────────────────────────────────────

  it('dissolving puts a published duplicate back on the site, slug and date unchanged', async () => {
    const date = new Date('2026-09-01T00:00:00Z')
    const primary = await story({ status: 'published', slug: 'primary', datePublished: date })
    const dup = await story({ status: 'rejected', rejectionReason: 'duplicate', slug: 'dup', datePublished: date })
    const fresh = await story({ status: 'rejected', rejectionReason: 'duplicate' })
    const kept = await Promise.all(([null, 'editor', 'assess_threshold', 'selection'] as const).map(
      rejectionReason => story({ status: 'rejected', rejectionReason }),
    ))
    const clusterId = await createCluster([primary.id, dup.id, fresh.id, ...kept.map(k => k.id)], primary.id)

    await dissolveCluster(clusterId)

    expect(await row(dup.id)).toMatchObject({ status: 'published', rejectionReason: null, slug: 'dup', datePublished: date, clusterId: null })
    expect(await row(fresh.id)).toMatchObject({ status: 'analyzed', rejectionReason: null })
    for (const k of kept) expect(await row(k.id)).toMatchObject({ status: 'rejected', rejectionReason: k.rejectionReason, clusterId: null })
    expect(await prisma.storyCluster.count()).toBe(0)
  })

  it('the per-story dissolve behaves the same', async () => {
    const date = new Date('2026-09-01T00:00:00Z')
    const primary = await story({ status: 'published', slug: 'primary', datePublished: date })
    const dup = await story({ status: 'rejected', rejectionReason: 'duplicate', slug: 'dup', datePublished: date })
    await createCluster([primary.id, dup.id], primary.id)

    await dissolveStoryCluster(primary.id)

    expect(await row(dup.id)).toMatchObject({ status: 'published', slug: 'dup', clusterId: null })
  })

  it('removing down to one member dissolves by the same rule', async () => {
    const date = new Date('2026-09-01T00:00:00Z')
    const primary = await story({ status: 'analyzed' })
    const dup = await story({ status: 'rejected', rejectionReason: 'duplicate', slug: 'dup', datePublished: date })
    const clusterId = await createCluster([primary.id, dup.id], primary.id)

    expect(await removeFromCluster(clusterId, primary.id)).toBeNull()

    expect((await row(dup.id)).status).toBe('published')
    expect((await row(primary.id)).status).toBe('analyzed')
  })

  // ──── Election ──────────────────────────────────────────────────────────

  it('re-election never picks a trashed member', async () => {
    const primary = await story({ status: 'analyzed', relevance: 5 })
    const trashed = await story({ status: 'trashed', relevance: 9 })
    const leaving = await story({ status: 'rejected', relevance: 1 })
    const other = await story({ status: 'analyzed', relevance: 2 })
    const clusterId = await createCluster([primary.id, trashed.id, leaving.id, other.id], primary.id)

    await removeFromCluster(clusterId, leaving.id)

    expect(await primaryOf(clusterId)).toBe(primary.id)
    expect((await row(trashed.id)).status).toBe('trashed')
  })

  it('rejecting the primary elects the next member and restores it', async () => {
    const primary = await story({ status: 'analyzed', relevance: 9 })
    const next = await story({ status: 'rejected', rejectionReason: 'duplicate', relevance: 6 })
    const clusterId = await createCluster([primary.id, next.id], primary.id)

    await rejectStory(primary.id)

    expect(await primaryOf(clusterId)).toBe(next.id)
    expect(await row(primary.id)).toMatchObject({ status: 'rejected', rejectionReason: 'editor' })
    expect(await row(next.id)).toMatchObject({ status: 'analyzed', rejectionReason: null })
  })

  it('trashing a published primary elects a duplicate and puts it back on the site', async () => {
    const date = new Date('2026-09-01T00:00:00Z')
    const primary = await story({ status: 'published', slug: 'p', datePublished: date })
    const dup = await story({ status: 'rejected', rejectionReason: 'duplicate', slug: 'd', datePublished: date })
    const editorRejected = await story({ status: 'rejected', rejectionReason: 'editor', relevance: 10 })
    const clusterId = await createCluster([primary.id, dup.id, editorRejected.id], primary.id)

    await updateStoryStatus(primary.id, 'trashed')

    expect(await primaryOf(clusterId)).toBe(dup.id)
    expect((await row(dup.id)).status).toBe('published')
    expect(await row(editorRejected.id)).toMatchObject({ status: 'rejected', rejectionReason: 'editor' })
  })

  // ──── Dedup formation ───────────────────────────────────────────────────

  it('dedup forms a cluster around the published story and rejects the newcomer as a duplicate', async () => {
    const pub = await story({ status: 'published', slug: 'first', datePublished: new Date(), title: 'First', summary: 's' })
    const fresh = await story({ status: 'analyzed', relevance: 9, title: 'Second', summary: 's' })
    const late = await story({ status: 'analyzed', relevance: 9, title: 'Third', summary: 's' })
    for (const s of [pub, fresh, late]) await setEmbedding(s.id, 1)
    mockInvoke.mockResolvedValue({ assessments: [{ candidateNumber: 1, isDuplicate: true, reason: 'same event' }] })
    config.dedup.enabled = true
    try {
      // `fresh` sees one candidate: `pub` (both unclustered)
      await prisma.story.update({ where: { id: late.id }, data: { status: 'fetched' } })
      const formed = await detectAndCluster(fresh.id)
      expect(formed).toMatchObject({ newCluster: true, memberCount: 2, rejectedIds: [fresh.id] })
      expect(await primaryOf(formed.clusterId!)).toBe(pub.id)
      expect(await row(pub.id)).toMatchObject({ status: 'published', slug: 'first' })
      expect(await row(fresh.id)).toMatchObject({ status: 'rejected', rejectionReason: 'duplicate' })

      // `late` sees the cluster's primary and joins that cluster
      await prisma.story.update({ where: { id: late.id }, data: { status: 'analyzed' } })
      const joined = await detectAndCluster(late.id)
      expect(joined).toMatchObject({ clusterId: formed.clusterId, newCluster: false, memberCount: 3, rejectedIds: [late.id] })
      expect(await row(late.id)).toMatchObject({ status: 'rejected', rejectionReason: 'duplicate' })
    } finally {
      config.dedup.enabled = false
    }
  })

  // ──── Set primary and merge ─────────────────────────────────────────────

  it('setting a rejected duplicate as primary restores it and rejects published members', async () => {
    const primary = await story({ status: 'published', slug: 'p', datePublished: new Date() })
    const chosen = await story({ status: 'rejected', rejectionReason: 'duplicate' })
    const clusterId = await createCluster([primary.id, chosen.id], primary.id)

    await setClusterPrimary(clusterId, chosen.id)

    expect(await primaryOf(clusterId)).toBe(chosen.id)
    expect((await row(chosen.id)).status).toBe('analyzed')
    expect((await row(primary.id)).status).toBe('rejected')
  })

  it('a manual cluster rejects every member but the chosen one, published ones too', async () => {
    const chosen = await story({ status: 'analyzed', relevance: 1 })
    const pub = await story({ status: 'published', slug: 'pub', datePublished: new Date() })
    const created = await createManualCluster([chosen.id, pub.id], chosen.id)

    expect(created?.primaryStory?.id).toBe(chosen.id)
    expect(await row(pub.id)).toMatchObject({ status: 'rejected', rejectionReason: 'duplicate' })
  })

  it('two manual clusters claiming one story: one wins, the other leaves nothing behind', async () => {
    const [a, b, c] = await Promise.all([story({ status: 'analyzed' }), story({ status: 'analyzed' }), story({ status: 'analyzed' })])

    const results = await Promise.allSettled([
      createManualCluster([a.id, b.id], a.id),
      createManualCluster([b.id, c.id], c.id),
    ])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.storyCluster.count()).toBe(1)
    const rows = await prisma.story.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, select: { clusterId: true } })
    expect(rows.filter(r => r.clusterId !== null)).toHaveLength(2)
  })

  it('merging rejects published non-primaries of the merged cluster', async () => {
    const a = await story({ status: 'published', slug: 'a', datePublished: new Date('2026-01-01') })
    const b = await story({ status: 'rejected' })
    const c = await story({ status: 'published', slug: 'c', datePublished: new Date('2026-02-01') })
    const d = await story({ status: 'rejected' })
    const target = await createCluster([a.id, b.id], a.id)
    const source = await createCluster([c.id, d.id], c.id)

    await mergeClusters(target, source)

    expect(await primaryOf(target)).toBe(a.id)
    expect((await row(c.id)).status).toBe('rejected')
    expect(await prisma.storyCluster.count()).toBe(1)
  })

  // ──── Rejection reasons ─────────────────────────────────────────────────

  it('a paywall-locked story is created rejected for the paywall', async () => {
    const s = await createStoryViaService({ sourceUrl: 'https://news.example/locked', sourceTitle: 'Locked', sourceContent: 'teaser', feedId, accessTier: 'locked' })
    expect(await row(s.id)).toMatchObject({ status: 'rejected', rejectionReason: 'paywall' })
    const free = await createStoryViaService({ sourceUrl: 'https://news.example/free', sourceTitle: 'Free', sourceContent: 'text', feedId, accessTier: 'free' })
    expect(await row(free.id)).toMatchObject({ status: 'fetched', rejectionReason: null })
  })

  it('the threshold jobs reject below-threshold stories with their reason and nothing else', async () => {
    const issue = await prisma.feed.findUniqueOrThrow({ where: { id: feedId }, select: { issueId: true } })
    const lowPre = await story({ status: 'pre_analyzed', issueId: issue.issueId })
    await prisma.story.update({ where: { id: lowPre.id }, data: { relevancePre: 1 } })
    const lowRelevance = await story({ status: 'analyzed', relevance: 1 })
    const trashed = await story({ status: 'trashed', relevance: 1 })

    await runAssessStories()
    await runSelectStories()

    expect(await row(lowPre.id)).toMatchObject({ status: 'rejected', rejectionReason: 'assess_threshold' })
    expect(await row(lowRelevance.id)).toMatchObject({ status: 'rejected', rejectionReason: 'select_threshold' })
    expect((await row(trashed.id)).status).toBe('trashed')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('the database refuses a rejection reason on a story that is not rejected', async () => {
    const s = await story({ status: 'analyzed' })
    await expect(prisma.$executeRaw`UPDATE stories SET rejection_reason = 'editor' WHERE id = ${s.id}`)
      .rejects.toThrow(/stories_rejection_reason_only_when_rejected/)
  })

  // ──── Concurrency ───────────────────────────────────────────────────────

  it('a concurrent publish and trash of one story both finish and leave one of the two', async () => {
    const s = await story({ status: 'analyzed', title: 'Contested' })

    await Promise.all([publishStory(s.id), updateStoryStatus(s.id, 'trashed')])

    expect(['published', 'trashed']).toContain((await row(s.id)).status)
  })

  it('a publish run and a dissolve of the same cluster do not deadlock', async () => {
    const primary = await story({ status: 'selected', title: 'P' })
    const member = await story({ status: 'rejected' })
    const clusterId = await createCluster([primary.id, member.id], primary.id)

    await Promise.all([runPublishStories(), dissolveCluster(clusterId)])

    expect((await row(primary.id)).status).toBe('published')
    expect(await prisma.storyCluster.count()).toBe(0)
  })
})
