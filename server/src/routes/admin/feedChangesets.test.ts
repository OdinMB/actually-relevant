import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { authHeader, TEST_API_KEY } from '../../test/helpers.js'

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const CLIMATE = '00000000-0000-0000-0000-0000000000c1'
const SIPRI_ID = '00000000-0000-0000-0000-0000000000f1'
const EMPTY_ID = '00000000-0000-0000-0000-0000000000f3'

const mockPrisma = vi.hoisted(() => ({
  issue: { findMany: vi.fn(), findUnique: vi.fn() },
  feed: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  story: { count: vi.fn() },
  $transaction: vi.fn(),
  $disconnect: vi.fn(),
}))

const mockFetchFaviconsInBackground = vi.hoisted(() => vi.fn())

vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../../services/crawler.js', () => ({ crawlFeed: vi.fn(), crawlAllDueFeeds: vi.fn(), crawlUrl: vi.fn() }))
vi.mock('../../services/favicon.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchFaviconsInBackground: mockFetchFaviconsInBackground,
}))

process.env.PUBLIC_API_KEY = TEST_API_KEY

const { default: app } = await import('../../app.js')

function dbFeed(overrides: Record<string, unknown>) {
  return {
    url: null,
    displayTitle: null,
    language: 'en',
    region: null,
    issueId: CLIMATE,
    crawlIntervalHours: 24,
    htmlSelector: null,
    paywallDetection: true,
    paywallTitleMarker: null,
    contentSource: 'page',
    active: true,
    _count: { stories: 0 },
    ...overrides,
  }
}

const reason = 'Researched 2026-11-01'
const moveSipri = { action: 'update', match: { title: 'SIPRI' }, set: { rssUrl: 'https://www.sipri.org/rss/combined.xml' }, reason }
const removeEmpty = { action: 'delete', match: { id: EMPTY_ID }, reason }
const addEcdc = { action: 'create', feed: { title: 'ECDC', rssUrl: 'https://www.ecdc.europa.eu/feed', issue: 'climate', contentSource: 'rss' }, reason }
const unknownIssue = { action: 'create', feed: { title: 'Typo', rssUrl: 'https://typo.example/feed', issue: 'climat' }, reason }

function changeset(changes: unknown[]) {
  return { format: 'actually-relevant/feed-changeset', version: 1, title: 'Fixes', changes }
}

describe('Admin feed changesets API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.feed.findMany.mockResolvedValue([
      dbFeed({ id: SIPRI_ID, title: 'SIPRI', rssUrl: 'https://www.sipri.org/rss/old.xml', _count: { stories: 12 } }),
      dbFeed({ id: EMPTY_ID, title: 'Never crawled', rssUrl: 'https://empty.example/feed' }),
    ])
    mockPrisma.issue.findMany.mockResolvedValue([{ id: CLIMATE, slug: 'climate' }])
    mockPrisma.issue.findUnique.mockResolvedValue({ id: CLIMATE, slug: 'climate' })
    mockPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockPrisma) => Promise<unknown>) => work(mockPrisma))
    mockPrisma.feed.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-feed', consecutiveEmptyCrawls: 0, ...data }))
    mockPrisma.feed.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      consecutiveEmptyCrawls: 0,
      ...data,
    }))
    mockPrisma.feed.delete.mockResolvedValue({})
    mockPrisma.story.count.mockResolvedValue(0)
  })

  it('requires a session', async () => {
    const res = await request(app)
      .post('/api/admin/feeds/changesets/preview')
      .send(changeset([moveSipri]))
    expect(res.status).toBe(401)
  })

  describe('POST /api/admin/feeds/changesets/preview', () => {
    it('resolves every change and writes nothing', async () => {
      const res = await request(app)
        .post('/api/admin/feeds/changesets/preview')
        .set(authHeader())
        .send(changeset([moveSipri, removeEmpty, addEcdc, unknownIssue]))

      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Fixes')
      expect(res.body.counts).toEqual({ ok: 3, noop: 0, error: 1 })
      expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok', 'ok', 'error'])
      expect(res.body.results[0]).toMatchObject({
        index: 0,
        action: 'update',
        feedTitle: 'SIPRI',
        reason,
        diff: [{ field: 'rssUrl', from: 'https://www.sipri.org/rss/old.xml', to: 'https://www.sipri.org/rss/combined.xml' }],
      })
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
      expect(mockPrisma.feed.create).not.toHaveBeenCalled()
      expect(mockPrisma.feed.update).not.toHaveBeenCalled()
      expect(mockPrisma.feed.delete).not.toHaveBeenCalled()
    })

    it('refuses a file that is not a feed changeset', async () => {
      const res = await request(app)
        .post('/api/admin/feeds/changesets/preview')
        .set(authHeader())
        .send({ ...changeset([moveSipri]), format: 'opml' })

      expect(res.status).toBe(400)
      expect(mockPrisma.feed.findMany).not.toHaveBeenCalled()
    })

    it('accepts a changeset larger than the default request body limit', async () => {
      const longReason = 'r'.repeat(490)
      const changes = Array.from({ length: 200 }, (_, i) => ({
        action: 'create',
        feed: { title: `Feed ${i}`, rssUrl: `https://f${i}.example/feed`, issue: 'climate' },
        reason: longReason,
      }))
      const body = changeset(changes)
      expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024)

      const res = await request(app).post('/api/admin/feeds/changesets/preview').set(authHeader()).send(body)

      expect(res.status).toBe(200)
      expect(res.body.counts.ok).toBe(200)
    })
  })

  describe('POST /api/admin/feeds/changesets/apply', () => {
    it('applies every change in one transaction when none has an error', async () => {
      mockPrisma.story.count.mockImplementation(async ({ where }: { where: { feedId: string } }) => (where.feedId === SIPRI_ID ? 12 : 0))

      const res = await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([moveSipri, removeEmpty, addEcdc]))

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ applied: true, counts: { ok: 3, noop: 0, error: 0 } })
      expect(res.body.results.map((r: { message: string }) => r.message)).toEqual(['Updated 1 field', 'Deleted', 'Created'])
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockPrisma.feed.update).toHaveBeenCalledWith({ where: { id: SIPRI_ID }, data: { rssUrl: 'https://www.sipri.org/rss/combined.xml' } })
      expect(mockPrisma.feed.delete).toHaveBeenCalledWith({ where: { id: EMPTY_ID } })
      expect(mockPrisma.feed.create).toHaveBeenCalledWith({
        data: { title: 'ECDC', rssUrl: 'https://www.ecdc.europa.eu/feed', issueId: CLIMATE, language: 'en', crawlIntervalHours: 24, contentSource: 'rss' },
      })
    })

    it('fetches favicons, once the transaction has committed, for created feeds and feeds whose address changed', async () => {
      let committed = false
      mockPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const result = await work(mockPrisma)
        committed = true
        return result
      })
      const committedAtFetch: boolean[] = []
      mockFetchFaviconsInBackground.mockImplementation(async () => {
        committedAtFetch.push(committed)
      })
      const retitle = { action: 'update', match: { id: EMPTY_ID }, set: { title: 'Renamed' }, reason }

      const res = await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([moveSipri, retitle, addEcdc]))

      expect(res.status).toBe(200)
      expect(mockFetchFaviconsInBackground).toHaveBeenCalledTimes(1)
      expect(committedAtFetch).toEqual([true])
      const fetched = mockFetchFaviconsInBackground.mock.calls[0][0] as { id: string; rssUrl: string }[]
      expect(fetched.map(f => [f.id, f.rssUrl])).toEqual([
        [SIPRI_ID, 'https://www.sipri.org/rss/combined.xml'],
        ['new-feed', 'https://www.ecdc.europa.eu/feed'],
      ])
    })

    it('fetches no favicon when nothing applied touches an address, or nothing was applied', async () => {
      const retitle = { action: 'update', match: { id: EMPTY_ID }, set: { title: 'Renamed' }, reason }
      await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([retitle]))
      await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([addEcdc, unknownIssue]))
      mockPrisma.feed.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
      await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([addEcdc]))

      expect(mockFetchFaviconsInBackground).not.toHaveBeenCalled()
    })

    it('reports a delete that finds stories at apply time as a deactivation', async () => {
      mockPrisma.story.count.mockResolvedValue(2)

      const res = await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([removeEmpty]))

      expect(res.status).toBe(200)
      expect(res.body.results[0].message).toBe('Deactivated (it has stories)')
      expect(mockPrisma.feed.update).toHaveBeenCalledWith({ where: { id: EMPTY_ID }, data: { active: false } })
      expect(mockPrisma.feed.delete).not.toHaveBeenCalled()
    })

    it('writes nothing and answers 400 with the preview when any change has an error', async () => {
      const res = await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([moveSipri, unknownIssue, removeEmpty]))

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ applied: false, counts: { ok: 2, noop: 0, error: 1 } })
      expect(res.body.error).toBe('1 of 3 changes has an error; nothing was applied')
      expect(res.body.results[1]).toMatchObject({ status: 'error', message: 'Unknown issue "climat"' })
      expect(mockPrisma.feed.create).not.toHaveBeenCalled()
      expect(mockPrisma.feed.update).not.toHaveBeenCalled()
      expect(mockPrisma.feed.delete).not.toHaveBeenCalled()
    })

    it('answers 409 when the database refuses a duplicate RSS URL, rolling the transaction back', async () => {
      mockPrisma.feed.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

      const res = await request(app)
        .post('/api/admin/feeds/changesets/apply')
        .set(authHeader())
        .send(changeset([addEcdc]))

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('A feed with this RSS URL already exists')
    })
  })
})
