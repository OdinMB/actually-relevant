import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  feedFavicon: { findUnique: vi.fn(), upsert: vi.fn() },
  feed: { findMany: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { getFavicon, saveFavicon, hasFavicon, activeFeedsForFavicons, _resetFaviconCache } = await import('./faviconStore.js')

const FEED_ID = '11111111-2222-4333-8444-555555555555'
const OLD = Buffer.from('old png')
const NEW = Buffer.from('new png')

beforeEach(() => {
  vi.clearAllMocks()
  _resetFaviconCache()
  mockPrisma.feedFavicon.upsert.mockResolvedValue({})
})

describe('getFavicon', () => {
  it('serves the stored PNG with an ETag that follows its bytes', async () => {
    mockPrisma.feedFavicon.findUnique.mockResolvedValueOnce({ png: new Uint8Array(OLD) })
    const first = await getFavicon(FEED_ID)
    expect(first?.png).toEqual(OLD)
    expect(first?.etag).toMatch(/^"[^"]+"$/)

    _resetFaviconCache()
    mockPrisma.feedFavicon.findUnique.mockResolvedValueOnce({ png: new Uint8Array(NEW) })
    expect((await getFavicon(FEED_ID))?.etag).not.toBe(first?.etag)
  })

  it('keeps a stored favicon in memory, so repeated requests do not query the database', async () => {
    mockPrisma.feedFavicon.findUnique.mockResolvedValue({ png: new Uint8Array(OLD) })
    await getFavicon(FEED_ID)
    await getFavicon(FEED_ID)
    expect(mockPrisma.feedFavicon.findUnique).toHaveBeenCalledTimes(1)
  })

  it('does not remember a missing favicon, so one stored later is served at once', async () => {
    mockPrisma.feedFavicon.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ png: new Uint8Array(NEW) })
    expect(await getFavicon(FEED_ID)).toBeNull()
    expect((await getFavicon(FEED_ID))?.png).toEqual(NEW)
  })
})

describe('saveFavicon', () => {
  it('replaces the stored favicon and its fetch time, and the next request serves the new one', async () => {
    mockPrisma.feedFavicon.findUnique.mockResolvedValueOnce({ png: new Uint8Array(OLD) }).mockResolvedValueOnce({ png: new Uint8Array(NEW) })
    await getFavicon(FEED_ID)

    await saveFavicon(FEED_ID, NEW, 'https://example.com/favicon.ico')

    const { where, create, update } = mockPrisma.feedFavicon.upsert.mock.calls[0][0]
    expect(where).toEqual({ feedId: FEED_ID })
    expect(create).toMatchObject({ feedId: FEED_ID, png: new Uint8Array(NEW), sourceUrl: 'https://example.com/favicon.ico' })
    expect(update).toMatchObject({ png: new Uint8Array(NEW), sourceUrl: 'https://example.com/favicon.ico', fetchedAt: expect.any(Date) })
    expect((await getFavicon(FEED_ID))?.png).toEqual(NEW)
  })
})

describe('hasFavicon', () => {
  it('says whether a favicon is stored, without loading its bytes', async () => {
    mockPrisma.feedFavicon.findUnique.mockResolvedValueOnce({ feedId: FEED_ID }).mockResolvedValueOnce(null)
    expect(await hasFavicon(FEED_ID)).toBe(true)
    expect(await hasFavicon(FEED_ID)).toBe(false)
    expect(mockPrisma.feedFavicon.findUnique.mock.calls[0][0].select).toEqual({ feedId: true })
  })
})

describe('activeFeedsForFavicons', () => {
  it('lists the active feeds and whether each has a stored favicon, without loading the bytes', async () => {
    mockPrisma.feed.findMany.mockResolvedValue([
      { id: 'a', title: 'A', rssUrl: 'https://a.example/rss', url: null, favicon: { feedId: 'a' } },
      { id: 'b', title: 'B', rssUrl: 'https://b.example/rss', url: 'https://b.example', favicon: null },
    ])

    expect(await activeFeedsForFavicons()).toEqual([
      { id: 'a', title: 'A', rssUrl: 'https://a.example/rss', url: null, hasFavicon: true },
      { id: 'b', title: 'B', rssUrl: 'https://b.example/rss', url: 'https://b.example', hasFavicon: false },
    ])
    const query = mockPrisma.feed.findMany.mock.calls[0][0]
    expect(query.where).toEqual({ active: true })
    expect(query.select.favicon).toEqual({ select: { feedId: true } })
  })
})
