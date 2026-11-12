import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ sourceFavicon: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() } }))
const mockFindIcon = vi.hoisted(() => vi.fn())
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
// The search has its own tests (favicon.test.ts)
vi.mock('./favicon.js', () => ({ findIcon: mockFindIcon }))

const { fetchSourceFaviconsInBackground, getSourceFavicon, isSourceHost, _resetSourceFaviconCache } = await import('./sourceFavicons.js')
const { config } = await import('../config.js')

const NOW = new Date('2026-11-12T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const PNG = Buffer.from([137, 80, 78, 71, 1, 2, 3])
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

const fetchedHosts = () => mockFindIcon.mock.calls.map(c => (c[0] as URL).hostname)
const upserted = () => mockPrisma.sourceFavicon.upsert.mock.calls.map(c => c[0].create as { host: string; png: Uint8Array | null; sourceUrl: string | null })

beforeEach(() => {
  vi.clearAllMocks()
  _resetSourceFaviconCache()
  mockPrisma.sourceFavicon.findMany.mockResolvedValue([])
  mockPrisma.sourceFavicon.upsert.mockResolvedValue({})
  mockFindIcon.mockResolvedValue({ png: PNG, sourceUrl: 'https://icons.example/x.png' })
})

describe('isSourceHost', () => {
  it.each(['outlet.example.com', 'bbc.co.uk', 'a-b.example'])('accepts the host name %s', host => expect(isSourceHost(host)).toBe(true))
  it.each(['localhost', '..%2Fetc', 'Outlet.Example.com', '127.0.0.1', 'outlet.example.com:8080', '-bad.example', `${'a'.repeat(64)}.example`])(
    'refuses %s',
    host => expect(isSourceHost(host)).toBe(false),
  )
})

describe('getSourceFavicon', () => {
  it('serves the stored PNG with a strong ETag', async () => {
    mockPrisma.sourceFavicon.findUnique.mockResolvedValue({ png: PNG })
    const favicon = await getSourceFavicon('outlet.example.com')
    expect(favicon?.png).toEqual(PNG)
    expect(favicon?.etag).toMatch(/^"[\w-]+"$/)
  })

  it('serves nothing for an unknown host or one recorded as having none', async () => {
    mockPrisma.sourceFavicon.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ png: null })
    expect(await getSourceFavicon('unknown.example.com')).toBeNull()
    expect(await getSourceFavicon('none-found.example.com')).toBeNull()
  })
})

describe('fetchSourceFaviconsInBackground', () => {
  it("tries Tavily's icon first, then stores the PNG by host with the address it came from", async () => {
    await fetchSourceFaviconsInBackground([{ host: 'outlet.example.com', favicon: 'https://icons.example/x.png' }], NOW)

    expect(mockFindIcon).toHaveBeenCalledWith(new URL('https://outlet.example.com'), 'https://icons.example/x.png')
    expect(upserted()).toEqual([{ host: 'outlet.example.com', png: new Uint8Array(PNG), sourceUrl: 'https://icons.example/x.png', fetchedAt: NOW }])
  })

  it('records a host where none was found, so it is not looked up again for 30 days', async () => {
    mockFindIcon.mockResolvedValue(null)
    await fetchSourceFaviconsInBackground([{ host: 'none.example.com', favicon: null }], NOW)
    expect(upserted()).toEqual([{ host: 'none.example.com', png: null, sourceUrl: null, fetchedAt: NOW }])

    const days = config.favicon.sourceNegativeCacheDays
    mockPrisma.sourceFavicon.findMany.mockResolvedValue([
      { host: 'recent.example.com', png: null, fetchedAt: daysAgo(days - 1) },
      { host: 'old.example.com', png: null, fetchedAt: daysAgo(days + 1) },
      { host: 'stored.example.com', png: PNG, fetchedAt: daysAgo(400) },
    ])
    mockFindIcon.mockClear()
    await fetchSourceFaviconsInBackground(
      ['recent.example.com', 'old.example.com', 'stored.example.com', 'new.example.com'].map(host => ({ host, favicon: null })),
      NOW,
    )
    expect(fetchedHosts().sort()).toEqual(['new.example.com', 'old.example.com'])
  })

  it('looks a host up once, with the first icon address any of its sources has', async () => {
    await fetchSourceFaviconsInBackground(
      [
        { host: 'outlet.example.com', favicon: null },
        { host: 'outlet.example.com', favicon: 'https://icons.example/y.png' },
      ],
      NOW,
    )
    expect(mockFindIcon).toHaveBeenCalledTimes(1)
    expect(mockFindIcon.mock.calls[0]![1]).toBe('https://icons.example/y.png')
  })

  it('never looks up a host that is not a plain host name', async () => {
    await fetchSourceFaviconsInBackground([{ host: '127.0.0.1', favicon: null }], NOW)
    expect(mockFindIcon).not.toHaveBeenCalled()
  })

  it('settles without an error when a search or a write fails, so it can never fail its caller', async () => {
    mockFindIcon.mockRejectedValueOnce(new Error('boom'))
    mockPrisma.sourceFavicon.upsert.mockRejectedValueOnce(new Error('db down'))
    await expect(
      fetchSourceFaviconsInBackground(
        ['a.example.com', 'b.example.com'].map(host => ({ host, favicon: null })),
        NOW,
      ),
    ).resolves.toBeUndefined()

    mockPrisma.sourceFavicon.findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(fetchSourceFaviconsInBackground([{ host: 'c.example.com', favicon: null }], NOW)).resolves.toBeUndefined()
  })
})
