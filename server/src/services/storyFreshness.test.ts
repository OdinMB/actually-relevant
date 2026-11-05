import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ story: { findMany: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { findNewerCoverage, nearlySameHeadline, newerCoverage, preferNewerCoverage, replaceWithNewer, reportedAt } = await import('./storyFreshness.js')
type Chosen = Parameters<typeof newerCoverage>[0][number]
type Candidate = Parameters<typeof newerCoverage>[1][number]

const HOUR = 60 * 60 * 1000
const T0 = new Date('2026-10-26T08:00:00Z')
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR)

const chosen = (overrides: Partial<Chosen> = {}): Chosen => ({
  id: 'chosen',
  title: 'AI headline',
  sourceTitle: 'Death toll rises to 40 in coastal floods',
  feedId: 'feed-a',
  clusterId: null,
  sourceDatePublished: T0,
  dateCrawled: T0,
  ...overrides,
})

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'later',
  title: 'A later AI headline',
  sourceTitle: 'An unrelated headline about something else',
  feedId: 'feed-b',
  clusterId: null,
  sourceDatePublished: at(48),
  // Crawled well after any source date a test gives, so the source date is the one that counts
  dateCrawled: at(24 * 7),
  status: 'analyzed',
  feed: { title: 'Feed B', displayTitle: null },
  ...overrides,
})

describe('nearlySameHeadline', () => {
  it('matches an updated headline that keeps most of its words', () => {
    expect(nearlySameHeadline('Death toll rises to 40 in coastal floods', 'Death toll rises to 75 in coastal floods')).toBe(true)
    expect(nearlySameHeadline('UN climate talks open in Belém', 'UN climate talks open in Belém, with a deal in doubt')).toBe(true)
  })

  it('ignores case, punctuation and filler words', () => {
    expect(nearlySameHeadline('Ozone layer: recovery is on track, says WMO', 'ozone layer recovery on track says WMO')).toBe(true)
  })

  it('does not match headlines that share only a few words', () => {
    expect(nearlySameHeadline('US orders total blockade of key oil route', 'US orders blockade of Iranian ports')).toBe(false)
    expect(nearlySameHeadline('US orders sanctions on Russian oil firms', 'US orders total blockade of key oil route')).toBe(false)
  })

  it('needs at least three shared words, so short headlines do not match by chance', () => {
    expect(nearlySameHeadline('Ozone hole shrinks', 'Ozone hole grows')).toBe(false)
    expect(nearlySameHeadline('Floods', 'Floods')).toBe(false)
  })
})

describe('reportedAt', () => {
  it("is the source's publication date, else the crawl date", () => {
    expect(reportedAt({ sourceDatePublished: at(-5), dateCrawled: T0 })).toEqual(at(-5))
    expect(reportedAt({ sourceDatePublished: null, dateCrawled: T0 })).toEqual(T0)
  })

  it('is the crawl date when the source dates the story after it was crawled', () => {
    expect(reportedAt({ sourceDatePublished: at(30), dateCrawled: T0 })).toEqual(T0)
  })
})

describe('newerCoverage', () => {
  it('flags a story when its dedup cluster has a story reported a day or more later', () => {
    const flags = newerCoverage([chosen({ clusterId: 'cluster-1' })], [candidate({ id: 'next-day', clusterId: 'cluster-1', sourceDatePublished: at(24) })])
    expect(flags).toEqual([
      {
        storyId: 'chosen',
        newer: [{ id: 'next-day', title: 'A later AI headline', publisher: 'Feed B', reportedAt: at(24), reason: 'same_event' }],
      },
    ])
  })

  it("leaves out other outlets' reports of the same event within the day, earlier ones and the story itself", () => {
    const flags = newerCoverage(
      [chosen({ clusterId: 'cluster-1' })],
      [
        candidate({ id: 'same-day', clusterId: 'cluster-1', sourceDatePublished: at(23) }),
        candidate({ id: 'earlier', clusterId: 'cluster-1', sourceDatePublished: at(-48) }),
        candidate({ id: 'chosen', clusterId: 'cluster-1', sourceDatePublished: at(48) }),
        candidate({ id: 'other-cluster', clusterId: 'cluster-2' }),
      ],
    )
    expect(flags).toEqual([])
  })

  it('flags a story when its own feed later ran a nearly identical headline, however soon', () => {
    const flags = newerCoverage(
      [chosen()],
      [
        candidate({
          id: 'update',
          feedId: 'feed-a',
          sourceTitle: 'Death toll rises to 75 in coastal floods',
          sourceDatePublished: at(3),
          feed: { title: 'Feed A', displayTitle: 'Publisher A' },
        }),
      ],
    )
    expect(flags).toEqual([
      { storyId: 'chosen', newer: [{ id: 'update', title: 'A later AI headline', publisher: 'Publisher A', reportedAt: at(3), reason: 'same_source' }] },
    ])
  })

  it('does not flag a similar headline that is older, from another feed, or not similar enough', () => {
    const flags = newerCoverage(
      [chosen()],
      [
        candidate({ id: 'older', feedId: 'feed-a', sourceTitle: 'Death toll rises to 30 in coastal floods', sourceDatePublished: at(-3) }),
        candidate({ id: 'other-feed', feedId: 'feed-b', sourceTitle: 'Death toll rises to 75 in coastal floods' }),
        candidate({ id: 'other-topic', feedId: 'feed-a', sourceTitle: 'Coastal towns plan new flood walls' }),
      ],
    )
    expect(flags).toEqual([])
  })

  it('falls back to the AI title and the crawl date where the source gives none', () => {
    const flags = newerCoverage(
      [chosen({ clusterId: 'cluster-1', sourceDatePublished: null })],
      [candidate({ clusterId: 'cluster-1', title: null, sourceTitle: 'Source headline', sourceDatePublished: null, dateCrawled: at(30) })],
    )
    expect(flags[0]!.newer).toEqual([expect.objectContaining({ title: 'Source headline', reportedAt: at(30) })])
  })

  it('lists a story found both ways once, as the same event, newest first and at most three', () => {
    const sameFeedAndCluster = { feedId: 'feed-a', clusterId: 'cluster-1', sourceTitle: 'Death toll rises to 75 in coastal floods' }
    const flags = newerCoverage(
      [chosen({ clusterId: 'cluster-1' })],
      [
        candidate({ id: 'both', ...sameFeedAndCluster, sourceDatePublished: at(30) }),
        candidate({ id: 'day-3', clusterId: 'cluster-1', sourceDatePublished: at(72) }),
        candidate({ id: 'day-4', clusterId: 'cluster-1', sourceDatePublished: at(96) }),
        candidate({ id: 'day-5', clusterId: 'cluster-1', sourceDatePublished: at(120) }),
      ],
    )
    expect(flags[0]!.newer.map(n => [n.id, n.reason])).toEqual([
      ['day-5', 'same_event'],
      ['day-4', 'same_event'],
      ['day-3', 'same_event'],
    ])

    const both = newerCoverage([chosen({ clusterId: 'cluster-1' })], [candidate({ id: 'both', ...sameFeedAndCluster, sourceDatePublished: at(30) })])
    expect(both[0]!.newer).toEqual([expect.objectContaining({ id: 'both', reason: 'same_event' })])
  })

  it('returns only the flagged stories, in the order they were chosen', () => {
    const flags = newerCoverage(
      [chosen({ id: 'b', clusterId: 'cluster-b' }), chosen({ id: 'quiet' }), chosen({ id: 'a', clusterId: 'cluster-a' })],
      [candidate({ id: 'newer-a', clusterId: 'cluster-a' }), candidate({ id: 'newer-b', clusterId: 'cluster-b' })],
    )
    expect(flags.map(f => f.storyId)).toEqual(['b', 'a'])
  })
})

/** A longlist: each story id with the newsletter section it falls under (one section unless given). */
const longlist = (ids: string[], section = 'Planet & Climate', others: Record<string, string> = {}) =>
  new Map([...ids.map((id): [string, string] => [id, section]), ...Object.entries(others)])

describe('replaceWithNewer', () => {
  const pick = chosen({ clusterId: 'cluster-1' })
  /** A later story of the pick's cluster, published unless overridden */
  const sameEvent = (id: string, hours: number, overrides: Partial<Candidate> = {}) =>
    candidate({ id, clusterId: 'cluster-1', sourceDatePublished: at(hours), status: 'published', ...overrides })

  it('replaces a pick, in place, with the newest later story of its cluster that is published and on the longlist', () => {
    const result = replaceWithNewer(
      ['first', 'chosen', 'last'],
      [pick],
      [sameEvent('day-2', 30), sameEvent('day-3', 54)],
      longlist(['first', 'chosen', 'last', 'day-2', 'day-3']),
    )

    expect(result).toEqual({
      storyIds: ['first', 'day-3', 'last'],
      replaced: [{ replacedId: 'chosen', replacedTitle: 'AI headline', newerId: 'day-3', newerTitle: 'A later AI headline', reason: 'same_event' }],
    })
  })

  it('passes over newer stories the issue cannot carry for the newest one it can', () => {
    const result = replaceWithNewer(
      ['chosen'],
      [pick],
      [
        sameEvent('duplicate', 96, { status: 'rejected' }),
        sameEvent('analyzed', 72, { status: 'analyzed' }),
        sameEvent('off-longlist', 60),
        sameEvent('carried', 30),
      ],
      longlist(['chosen', 'duplicate', 'analyzed', 'carried']),
    )
    expect(result.storyIds).toEqual(['carried'])
  })

  it('keeps a pick, still flagged, when none of its newer stories can be carried', () => {
    const candidates = [sameEvent('duplicate', 48, { status: 'rejected' }), sameEvent('off-longlist', 60)]

    expect(replaceWithNewer(['chosen'], [pick], candidates, longlist(['chosen', 'duplicate']))).toEqual({ storyIds: ['chosen'], replaced: [] })
    expect(newerCoverage([pick], candidates)[0]!.newer.map(n => n.id)).toEqual(['off-longlist', 'duplicate'])
  })

  it('keeps a pick whose later story of the same event falls under another section, and the pick stays flagged', () => {
    const candidates = [sameEvent('other-section', 54), sameEvent('same-section', 30)]
    const sections = longlist(['chosen', 'same-section'], 'Planet & Climate', { 'other-section': 'Human Development' })

    expect(replaceWithNewer(['chosen'], [pick], candidates, sections).storyIds).toEqual(['same-section'])
    expect(replaceWithNewer(['chosen'], [pick], [candidates[0]!], sections)).toEqual({ storyIds: ['chosen'], replaced: [] })
    expect(newerCoverage([pick], [candidates[0]!])[0]!.newer.map(n => n.id)).toEqual(['other-section'])
  })

  it("never swaps for a nearly identical later headline from the pick's own feed, which stays a flag, nor for another outlet's same-day report", () => {
    const other = chosen({ id: 'other', clusterId: 'cluster-2', feedId: 'feed-c', sourceTitle: 'Wetlands bill passes its first vote' })
    const candidates = [
      candidate({ id: 'update', feedId: 'feed-a', sourceTitle: 'Death toll rises to 75 in coastal floods', sourceDatePublished: at(3), status: 'published' }),
      candidate({ id: 'same-day', clusterId: 'cluster-2', sourceDatePublished: at(20), status: 'published' }),
    ]

    const result = replaceWithNewer(['chosen', 'other'], [chosen(), other], candidates, longlist(['chosen', 'other', 'update', 'same-day']))

    expect(result).toEqual({ storyIds: ['chosen', 'other'], replaced: [] })
    expect(newerCoverage([chosen()], candidates)).toEqual([{ storyId: 'chosen', newer: [expect.objectContaining({ id: 'update', reason: 'same_source' })] }])
  })

  it('never lists a story twice: one already picked, or taken by an earlier pick, is passed over', () => {
    const result = replaceWithNewer(
      ['chosen', 'also', 'day-3'],
      [pick, chosen({ id: 'also', clusterId: 'cluster-1' }), chosen({ id: 'day-3', clusterId: 'cluster-1', sourceDatePublished: at(54) })],
      [sameEvent('day-2', 30), sameEvent('day-3', 54)],
      longlist(['chosen', 'also', 'day-2', 'day-3']),
    )

    expect(result.storyIds).toEqual(['day-2', 'also', 'day-3'])
    expect(result.replaced.map(r => r.replacedId)).toEqual(['chosen'])
  })

  it('looks past the three newer stories the flag lists', () => {
    const result = replaceWithNewer(
      ['chosen'],
      [pick],
      [
        sameEvent('day-5', 120, { status: 'rejected' }),
        sameEvent('day-4', 96, { status: 'rejected' }),
        sameEvent('day-3', 72, { status: 'rejected' }),
        sameEvent('day-2', 30),
      ],
      longlist(['chosen', 'day-2']),
    )
    expect(result.storyIds).toEqual(['day-2'])
  })

  it('keeps a pick that no longer exists', () => {
    expect(replaceWithNewer(['gone'], [], [], longlist(['gone']))).toEqual({ storyIds: ['gone'], replaced: [] })
  })
})

describe('preferNewerCoverage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads nothing for an empty shortlist', async () => {
    expect(await preferNewerCoverage([], longlist(['a']))).toEqual({ storyIds: [], replaced: [] })
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
  })

  it("reads the picks' newer coverage with each story's status, and swaps a pick for a published newer story on the longlist", async () => {
    mockPrisma.story.findMany
      .mockResolvedValueOnce([chosen({ id: 'c1', clusterId: 'cluster-1' })])
      .mockResolvedValueOnce([candidate({ id: 'next-day', clusterId: 'cluster-1', sourceDatePublished: at(30), status: 'published' })])

    expect(await preferNewerCoverage(['c1'], longlist(['c1', 'next-day']))).toEqual({
      storyIds: ['next-day'],
      replaced: [expect.objectContaining({ replacedId: 'c1', newerId: 'next-day', reason: 'same_event' })],
    })
    expect(mockPrisma.story.findMany.mock.calls[1]![0].select).toMatchObject({ status: true })
  })
})

describe('findNewerCoverage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads nothing for no stories', async () => {
    expect(await findNewerCoverage([])).toEqual([])
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
  })

  it("reads the chosen stories' clusters and feeds, counting only stories that reached analysis", async () => {
    mockPrisma.story.findMany
      .mockResolvedValueOnce([chosen({ id: 'c1', clusterId: 'cluster-1' }), chosen({ id: 'c2', feedId: 'feed-b', dateCrawled: at(10) })])
      .mockResolvedValueOnce([candidate({ id: 'next-day', clusterId: 'cluster-1', sourceDatePublished: at(30) })])

    const flags = await findNewerCoverage(['c1', 'c2'])

    expect(flags).toEqual([{ storyId: 'c1', newer: [expect.objectContaining({ id: 'next-day', reason: 'same_event' })] }])
    expect(mockPrisma.story.findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['c1', 'c2'] } })
    const where = mockPrisma.story.findMany.mock.calls[1]![0].where
    expect(where.AND).toEqual([
      { OR: [{ status: { in: ['analyzed', 'selected', 'published'] } }, { status: 'rejected', rejectionReason: 'duplicate' }] },
      {
        OR: [
          { clusterId: { in: ['cluster-1'] } },
          // A day before the earliest crawl, so a story the same crawl run saved a moment earlier is included
          { feedId: { in: ['feed-a', 'feed-b'] }, dateCrawled: { gte: at(-24) } },
        ],
      },
    ])
  })

  it('reads no candidates when none of the stories exists', async () => {
    mockPrisma.story.findMany.mockResolvedValueOnce([])
    expect(await findNewerCoverage(['gone'])).toEqual([])
    expect(mockPrisma.story.findMany).toHaveBeenCalledTimes(1)
  })
})
