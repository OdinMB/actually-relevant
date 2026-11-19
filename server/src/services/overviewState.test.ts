import { describe, expect, it } from 'vitest'
import { newOverviewRow, type EntryRow, type OverviewRow } from './overviewChanges.js'
import { overviewStateOf } from './overviewState.js'
import { reportQueuesReview } from './overviewStatus.js'

const HOUR = 3_600_000
const NOW = new Date('2026-11-18T02:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR)
const charter = { in: 'In.', out: [], endEvent: 'End.' }

const overview = (over: Partial<OverviewRow> = {}): OverviewRow => ({
  ...newOverviewRow({ id: 'o1', title: 'Ebola in Ituri', issueId: null, charter, charterModel: 'm', charterPromptVersion: 'v', foundedAt: hoursAgo(500) }),
  scope: 'ongoing',
  ...over,
})
let n = 0
const entry = (published: Date, joined: Date, over: Partial<EntryRow> = {}): EntryRow => ({
  id: `e${++n}`,
  overviewId: 'o1',
  storyId: `s${n}`,
  joinedBy: 'pipeline',
  joinedAt: joined,
  status: 'active',
  detachedBy: null,
  detachReason: null,
  detachedAt: null,
  locked: false,
  role: 'routine',
  roleKind: null,
  published: true,
  datePublished: published,
  ...over,
})
const OPTIONS = { nightHours: 24 }

describe('overviewStateOf', () => {
  it("counts the burst from the night's stories the pipeline joined, never a backfill's old ones, an editor's or a detached one", () => {
    const entries = [
      entry(hoursAgo(5), hoursAgo(1)),
      entry(hoursAgo(6), hoursAgo(1)),
      // Old stories linked by the backfill tonight: not a burst of news
      entry(hoursAgo(24 * 40), hoursAgo(1)),
      entry(hoursAgo(5), hoursAgo(1), { joinedBy: 'editor' }),
      entry(hoursAgo(5), hoursAgo(1), { status: 'detached' }),
    ]
    expect(overviewStateOf(overview(), entries, null, NOW, OPTIONS).burstJoins).toBe(2)
  })

  it('counts only the joins after the last freeze, unfreeze or review, so the joins one burst answered never count again', () => {
    const entries = [entry(hoursAgo(5), hoursAgo(3)), entry(hoursAgo(5), hoursAgo(3)), entry(hoursAgo(4), hoursAgo(1))]
    expect(overviewStateOf(overview({ joinsCountedFrom: hoursAgo(3) }), entries, null, NOW, OPTIONS).burstJoins).toBe(1)
    expect(overviewStateOf(overview({ joinsCountedFrom: hoursAgo(10) }), entries, null, NOW, OPTIONS).burstJoins).toBe(3)
  })

  it('lists the active entries of stories no longer published and counts only the published ones', () => {
    const gone = entry(hoursAgo(30), hoursAgo(30), { published: false })
    const s = overviewStateOf(overview(), [entry(hoursAgo(40), hoursAgo(40)), gone], null, NOW, OPTIONS)
    expect(s).toMatchObject({ activeEntries: 1, unpublished: [{ entryId: gone.id, storyId: gone.storyId }] })
  })

  it("is due a burst review only for a burst's freeze not reviewed since, never an editor's or the brake's", () => {
    const frozen = { frozen: true, frozenAt: hoursAgo(2) }
    expect(overviewStateOf(overview({ ...frozen, frozenBy: 'burst' }), [], null, NOW, OPTIONS).burstAt).toEqual(hoursAgo(2))
    expect(overviewStateOf(overview({ ...frozen, frozenBy: 'burst', reviewedAt: hoursAgo(1) }), [], null, NOW, OPTIONS).burstAt).toBeNull()
    expect(overviewStateOf(overview({ ...frozen, frozenBy: 'editor' }), [], null, NOW, OPTIONS).burstAt).toBeNull()
    expect(overviewStateOf(overview({ ...frozen, frozenBy: 'review' }), [], null, NOW, OPTIONS).burstAt).toBeNull()
  })

  it('names the closing story and whether the closure review ran only while closing', () => {
    const closing = overview({ status: 'closing', closingSince: hoursAgo(50), closingStoryId: 's1', closureReviewedAt: hoursAgo(1) })
    expect(overviewStateOf(closing, [], null, NOW, OPTIONS)).toMatchObject({ closingStoryId: 's1', closureReviewed: true })
    const open = overview({ status: 'open', closingStoryId: 's1', closureReviewedAt: hoursAgo(1) })
    expect(overviewStateOf(open, [], null, NOW, OPTIONS)).toMatchObject({ closingStoryId: null, closureReviewed: false })
  })
})

describe('reportQueuesReview', () => {
  it("queues a review on a reader's first report, and again only once the spacing has passed", () => {
    const options = { reportReviewEveryDays: 7 }
    expect(reportQueuesReview(null, NOW, options)).toBe(true)
    expect(reportQueuesReview(hoursAgo(24 * 6), NOW, options)).toBe(false)
    expect(reportQueuesReview(hoursAgo(24 * 7), NOW, options)).toBe(true)
  })
})
