import { describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import type { RecenterAnswer, RecenterCheckAnswer } from '../schemas/overviews.js'
import type { ModelCall } from './overviewLink.js'
import {
  anchorHolds,
  anchorOf,
  automatedRecenterBlocked,
  draftHoldsAnchor,
  neighbourOverviews,
  recenterCaseOf,
  recenterLock,
  recenterOverview,
  signalFires,
  signalsSince,
  turnedAway,
  type AnchorEntry,
  type RecenterCase,
  type RecenterParts,
  type RecenterState,
  type TurnedAwayRow,
} from './overviewRecenter.js'
import type { ReviewEntry } from './overviewReview.js'

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 8))
const OPTIONS = { anchorTurningShare: 2 / 3, anchorStandIns: 2, maxAutomatedRecenters: 2, editorRecenterLockDays: 180 }

const entry = (i: number, over: Partial<AnchorEntry> = {}): AnchorEntry => ({
  entryId: `e${i}`,
  status: 'active',
  published: true,
  datePublished: day(i),
  role: 'routine',
  ...over,
})
const turning = (i: number, over: Partial<AnchorEntry> = {}) => entry(i, { role: 'turning_point', ...over })

describe('anchorOf', () => {
  it('takes the founding entries still active and published, oldest first, then the other turning points', () => {
    const anchor = anchorOf([entry(5), turning(2), entry(1), turning(4), turning(3)], ['e1', 'e2'], OPTIONS)
    expect(anchor).toEqual({ founding: ['e1', 'e2'], standIns: false, turningPoints: ['e3', 'e4'] })
  })

  it('leaves out a founding entry detached or unpublished, and a turning point detached', () => {
    const anchor = anchorOf(
      [entry(1, { status: 'detached' }), entry(2), entry(3, { published: false }), turning(4), turning(5, { status: 'detached' })],
      ['e1', 'e2', 'e3'],
      OPTIONS,
    )
    expect(anchor).toEqual({ founding: ['e2'], standIns: false, turningPoints: ['e4'] })
  })

  it('stands the 2 oldest active entries in for the founding ones when none is left', () => {
    const anchor = anchorOf([entry(1, { status: 'detached' }), turning(6), entry(4), entry(3), turning(5)], ['e1', 'e2'], OPTIONS)
    expect(anchor).toEqual({ founding: ['e3', 'e4'], standIns: true, turningPoints: ['e5', 'e6'] })
  })
})

describe('anchorHolds', () => {
  const anchor = (turningPoints: number) => ({
    founding: ['f1', 'f2'],
    standIns: false,
    turningPoints: Array.from({ length: turningPoints }, (_, i) => `t${i + 1}`),
  })
  const failing =
    (...ids: string[]) =>
    (id: string) =>
      !ids.includes(id)

  it('needs every founding entry judged to belong', () => {
    expect(anchorHolds(anchor(0), failing(), OPTIONS)).toEqual({ holds: true, failed: [] })
    expect(anchorHolds(anchor(3), failing('f2'), OPTIONS)).toEqual({ holds: false, failed: ['f2'] })
  })

  it('needs 2/3 of the turning points, rounded up: 3 of 4, 2 of 3, all of 1 or 2', () => {
    expect(anchorHolds(anchor(4), failing('t1'), OPTIONS)).toEqual({ holds: true, failed: ['t1'] })
    expect(anchorHolds(anchor(4), failing('t1', 't2'), OPTIONS).holds).toBe(false)
    expect(anchorHolds(anchor(3), failing('t3'), OPTIONS).holds).toBe(true)
    expect(anchorHolds(anchor(3), failing('t1', 't3'), OPTIONS)).toEqual({ holds: false, failed: ['t1', 't3'] })
    expect(anchorHolds(anchor(2), failing('t2'), OPTIONS).holds).toBe(false)
    expect(anchorHolds(anchor(1), failing('t1'), OPTIONS).holds).toBe(false)
    expect(anchorHolds(anchor(1), failing(), OPTIONS).holds).toBe(true)
  })
})

describe('the fixed limits on an automated re-center', () => {
  const NOW = day(20)
  const state = (over: Partial<RecenterState> = {}): RecenterState => ({
    scope: 'ongoing',
    status: 'open',
    frozen: false,
    automatedRecenters: 0,
    recenteredAt: null,
    recenteredBy: null,
    recenterUndoneAt: null,
    ...over,
  })

  it('allows an ongoing open or quiet overview under the limit', () => {
    expect(automatedRecenterBlocked(state(), NOW, OPTIONS)).toBeNull()
    expect(automatedRecenterBlocked(state({ status: 'quiet', automatedRecenters: 1 }), NOW, OPTIONS)).toBeNull()
  })

  it('skips a frozen, closing, closed, forming or single overview', () => {
    expect(automatedRecenterBlocked(state({ frozen: true }), NOW, OPTIONS)).toBe('frozen')
    expect(automatedRecenterBlocked(state({ status: 'closing' }), NOW, OPTIONS)).toBe('status')
    expect(automatedRecenterBlocked(state({ status: 'closed' }), NOW, OPTIONS)).toBe('status')
    expect(automatedRecenterBlocked(state({ scope: 'forming' }), NOW, OPTIONS)).toBe('scope')
    expect(automatedRecenterBlocked(state({ scope: 'single' }), NOW, OPTIONS)).toBe('scope')
  })

  it('leaves an overview at 2 applied automated re-centers to an editor', () => {
    expect(automatedRecenterBlocked(state({ automatedRecenters: 2 }), NOW, OPTIONS)).toBe('limit')
  })

  it("holds automation off for 180 days after an editor's re-center or an Undo of automation's, never after its own", () => {
    const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
    const at = (by: string, daysAgo: number) => state({ recenteredBy: by, recenteredAt: ago(daysAgo) })
    expect(automatedRecenterBlocked(at('editor', 10), NOW, OPTIONS)).toBe('locked')
    expect(automatedRecenterBlocked(state({ recenterUndoneAt: ago(179) }), NOW, OPTIONS)).toBe('locked')
    expect(automatedRecenterBlocked(at('editor', 180), NOW, OPTIONS)).toBeNull()
    expect(automatedRecenterBlocked(at('recenter', 1), NOW, OPTIONS)).toBeNull()
    expect(recenterLock(at('editor', 10), OPTIONS)).toEqual({ until: new Date(NOW.getTime() + 170 * 86_400_000), by: 'editor' })
    expect(recenterLock(at('recenter', 10), OPTIONS)).toBeNull()
    // The later lock holds, whichever set it: an Undo's after an editor's, or an editor's after an Undo's
    expect(recenterLock({ ...at('editor', 10), recenterUndoneAt: ago(5) }, OPTIONS)).toEqual({ until: new Date(NOW.getTime() + 175 * 86_400_000), by: 'undo' })
    expect(recenterLock({ ...at('editor', 5), recenterUndoneAt: ago(10) }, OPTIONS)?.by).toBe('editor')
  })
})

// ---------------------------------------------------------------------------
// The automated re-center
// ---------------------------------------------------------------------------

const ATTEMPT = config.overviews
const CLOCK = new Date(Date.UTC(2026, 9, 30, 2))
const routine = { role: 'routine' as const, roleKind: null }
const turningRole = { role: 'turning_point' as const, roleKind: 'decision' as const }
const call = <T>(parsed: T | null, costUsd = 0.05): Promise<ModelCall<T>> => Promise.resolve({ parsed, costUsd, model: 'large' })

describe('the signals that fire an attempt', () => {
  const linked = (h: number) => new Date(CLOCK.getTime() + h * 3_600_000)
  const record = (storyId: string, at: Date | null, ...kinds: ('wider' | 'center_moved')[]) => ({
    storyId,
    linkedAt: at,
    signals: [...kinds.map(kind => ({ overviewId: 'o1', kind, quote: 'q' })), { overviewId: 'o2', kind: 'center_moved' as const, quote: 'q' }],
  })

  it('counts each story once per kind, for this overview, from stories linked after the last attempt', () => {
    const records = [
      record('a', linked(-2), 'wider'),
      record('b', linked(0), 'wider', 'center_moved'),
      record('c', linked(1), 'wider'),
      record('d', null, 'wider'),
    ]
    expect(signalsSince('o1', records, null)).toEqual({ wider: 3, centerMoved: 1 })
    // The attempt at the same run time as b's link weighed it: only c counts after it
    expect(signalsSince('o1', records, linked(0))).toEqual({ wider: 1, centerMoved: 0 })
    expect(signalsSince('o3', records, null)).toEqual({ wider: 0, centerMoved: 0 })
  })

  it('fires on two wider flags or one center flag', () => {
    expect(signalFires({ wider: 1, centerMoved: 0 }, ATTEMPT)).toBe(false)
    expect(signalFires({ wider: 2, centerMoved: 0 }, ATTEMPT)).toBe(true)
    expect(signalFires({ wider: 0, centerMoved: 1 }, ATTEMPT)).toBe(true)
  })
})

const row = (i: number, over: Partial<TurnedAwayRow> = {}): TurnedAwayRow => ({
  storyId: `s${i}`,
  title: `Story ${i}`,
  label: 'Label',
  summary: 'Summary.',
  date: `2026-10-${String(i).padStart(2, '0')}`,
  datePublished: day(i),
  published: true,
  active: false,
  quotes: [`Story ${i}`],
  row: null,
  ...over,
})

describe('turnedAway', () => {
  it('takes published stories in no overview, flagged for it or detached by a review, within the lookback, newest first', () => {
    const rows = [
      row(20),
      row(21, { published: false }),
      row(22, { active: true }),
      row(23, { quotes: [] }),
      row(24, { quotes: [], row: { entryId: 'x24', detachedBy: 'review', locked: false } }),
      row(25, { row: { entryId: 'x25', detachedBy: 'ed-1', locked: true } }),
      row(26, { quotes: [], row: { entryId: 'x26', detachedBy: 'pipeline', locked: false } }),
      row(27, { datePublished: new Date(CLOCK.getTime() + 86_400_000) }),
      row(1, { datePublished: new Date(CLOCK.getTime() - 91 * 86_400_000) }),
    ]
    expect(turnedAway(rows, CLOCK, ATTEMPT).map(s => [s.storyId, s.entryId])).toEqual([
      ['s24', 'x24'],
      ['s20', null],
    ])
    expect(turnedAway([row(20), row(24), row(22)], CLOCK, { ...ATTEMPT, maxRecenterStories: 1 }).map(s => s.storyId)).toEqual(['s24'])
  })
})

const reviewEntry = (i: number, role = routine, locked = false): ReviewEntry => ({
  entryId: `e${i}`,
  storyId: `m${i}`,
  title: `Member ${i}`,
  label: 'Label',
  summary: 'Summary.',
  date: `2026-10-${String(i).padStart(2, '0')}`,
  role,
  locked,
})

describe('recenterCaseOf', () => {
  const parts = (over: Partial<RecenterParts> = {}, state: Partial<RecenterParts['state']> = {}): RecenterParts => ({
    review: {
      overviewId: 'o1',
      title: 'Colorado River rules',
      charter: { in: 'The rules fight.', out: ['Western drought'], endEvent: null },
      scope: 'ongoing',
      frozen: false,
      entries: [reviewEntry(1), reviewEntry(2), reviewEntry(3, turningRole)],
      closingStoryId: null,
      lockedOut: [],
    },
    state: {
      scope: 'ongoing',
      status: 'open',
      frozen: false,
      automatedRecenters: 0,
      recenteredAt: null,
      recenteredBy: null,
      recenterUndoneAt: null,
      recenterTriedAt: null,
      ...state,
    },
    entryDates: new Map([1, 2, 3].map(i => [`e${i}`, day(i)])),
    founding: ['e2', 'e1'],
    records: [
      { storyId: 's20', signals: [{ overviewId: 'o1', kind: 'wider', quote: 'q' }], linkedAt: day(20) },
      { storyId: 's21', signals: [{ overviewId: 'o1', kind: 'wider', quote: 'q' }], linkedAt: day(21) },
    ],
    rows: [row(20), row(21)],
    ...over,
  })

  it('builds the case with its anchor when the signals fire and enough stories may join', () => {
    const c = recenterCaseOf(parts(), { clock: CLOCK, now: CLOCK }, ATTEMPT)!
    expect(c.anchor).toEqual({ founding: ['e1', 'e2'], standIns: false, turningPoints: ['e3'] })
    expect(c.stories.map(s => s.storyId)).toEqual(['s21', 's20'])
    expect(c).toMatchObject({ fired: { wider: 2, centerMoved: 0 }, status: 'open', automatedRecenters: 0 })
  })

  it('is no case when automation may not re-center it, the signals do not fire, or fewer stories than a re-center needs could join', () => {
    const at = { clock: CLOCK, now: CLOCK }
    expect(recenterCaseOf(parts({}, { automatedRecenters: 2 }), at, ATTEMPT)).toBeNull()
    expect(recenterCaseOf(parts({}, { recenteredBy: 'editor', recenteredAt: day(1) }), at, ATTEMPT)).toBeNull()
    expect(recenterCaseOf(parts({}, { recenterTriedAt: day(20) }), at, ATTEMPT)).toBeNull()
    expect(recenterCaseOf(parts({ rows: [row(20), row(21, { active: true })] }), at, ATTEMPT)).toBeNull()
  })
})

describe('neighbourOverviews', () => {
  it('names the overviews near the stories at the clock, the overview itself left out', async () => {
    const neighbours = vi.fn(async (id: string) => [{ id: `n-${id}`, datePublished: day(5), distance: 0.2, via: 'near' as const }])
    const membership = (overviewId: string) => ({
      overviewId,
      scope: 'ongoing' as const,
      status: 'open' as const,
      closedReason: null,
      frozen: false,
      lastEntryAt: day(28),
    })
    const memberships = vi.fn(async (ids: string[]) => ({
      active: new Map(ids.map(id => [id, membership(id === 'n-a' ? 'o1' : 'o2')] as const)),
      lockedOut: new Map<string, string[]>(),
    }))
    const overviews = vi.fn(async (ids: string[]) =>
      ids.map(id => ({ id, title: `Overview ${id}`, charter: { in: `In ${id}.`, out: [], endEvent: null }, entries: [] })),
    )
    expect(await neighbourOverviews('o1', ['a', 'b'], CLOCK, { neighbours, memberships, overviews }, ATTEMPT)).toEqual([
      { overviewId: 'o2', title: 'Overview o2', in: 'In o2.' },
    ])
    expect(neighbours).toHaveBeenCalledWith('a', CLOCK)
  })
})

describe('recenterOverview', () => {
  /** Four entries (the first two founding, the third a turning point, the fourth locked by an editor) and three stories turned away. */
  const recenterCase = (over: Partial<RecenterCase> = {}): RecenterCase => ({
    overviewId: 'o1',
    title: 'Colorado River rules',
    charter: { in: 'The fight over the post-2026 rules.', out: ['Western drought'], endEvent: 'The final rule is published' },
    scope: 'ongoing',
    frozen: false,
    entries: [reviewEntry(1), reviewEntry(2), reviewEntry(3, turningRole), reviewEntry(4, routine, true)],
    closingStoryId: null,
    lockedOut: ['Lake Mead tourism'],
    status: 'open',
    automatedRecenters: 0,
    anchor: { founding: ['e1', 'e2'], standIns: false, turningPoints: ['e3'] },
    stories: [20, 21, 22].map(i => ({ ...row(i), entryId: i === 22 ? 'x22' : null })).map(({ published: _p, active: _a, row: _r, ...s }) => s),
    neighbours: [{ overviewId: 'o9', title: 'Sacramento Valley sinking', in: 'Subsidence in the Sacramento Valley.' }],
    fired: { wider: 2, centerMoved: 0 },
    ...over,
  })
  const judged = (ids: string[], no: string[] = []) => ids.map(id => ({ id, belongs: no.includes(id) ? ('no' as const) : ('yes' as const) }))
  const draft = (over: Partial<RecenterAnswer> = {}, no: string[] = []): RecenterAnswer => ({
    decision: 'recenter',
    title: 'Colorado River water shortage',
    charter: { in: 'The Colorado River water shortage and the fight over its rules.', out: ['Western drought', 'Sacramento aquifer'], endEvent: '' },
    entries: judged(['E1', 'E2', 'E3', 'E4'], no),
    stories: judged(['S1', 'S2', 'S3'], no).map(s => ({ ...s, ...(s.id === 'S1' ? turningRole : routine) })),
    reason: 'The shortage is the development now.',
    ...over,
  })
  const check = (over: Partial<RecenterCheckAnswer> = {}, no: string[] = []): RecenterCheckAnswer => ({
    entries: judged(['E1', 'E2', 'E3', 'E4'], no).map(e => ({ ...e, reason: 'Why.' })),
    stories: judged(['S1', 'S2', 'S3'], no).map(s => ({ ...s, reason: 'Why.' })),
    endEventConcrete: 'none',
    neighbours: [{ id: 'N1', covered: 'no' }],
    ...over,
  })
  const run = (d: RecenterAnswer | null, k: RecenterCheckAnswer | null, c = recenterCase(), options = ATTEMPT) => {
    const deps = { draft: vi.fn(() => call(d)), check: vi.fn(() => call(k)) }
    return { deps, result: recenterOverview(c, deps, options) }
  }

  it('reads whether a draft’s own judgments hold the anchor, its first judgment of each entry counting', () => {
    expect(draftHoldsAnchor(recenterCase(), draft(), ATTEMPT)).toBe(true)
    // A founding entry judged not to belong breaks it; the only turning point too (1 of 1 must pass)
    expect(draftHoldsAnchor(recenterCase(), draft({}, ['E1']), ATTEMPT)).toBe(false)
    expect(draftHoldsAnchor(recenterCase(), draft({}, ['E3']), ATTEMPT)).toBe(false)
    // An entry outside the anchor may go
    expect(draftHoldsAnchor(recenterCase(), draft({}, ['E4']), ATTEMPT)).toBe(true)
    expect(draftHoldsAnchor(recenterCase(), draft({ entries: [...judged(['E1', 'E2', 'E3', 'E4']), { id: 'E1', belongs: 'no' }] }), ATTEMPT)).toBe(true)
  })

  it('re-centers when every rule holds: the draft’s title, the old OUT with its additions, the stories both took in, the entries both rejected', async () => {
    const { deps, result } = run(draft({}, ['E4']), check({}, ['S2', 'E4']))
    const r = await result
    expect(r).toMatchObject({
      outcome: 'recentered',
      rule: null,
      title: 'Colorado River water shortage',
      charter: { in: 'The Colorado River water shortage and the fight over its rules.', out: ['Western drought', 'Sacramento aquifer'], endEvent: null },
      outAdded: ['Sacramento aquifer'],
      // E4 is locked: rejected by both, it stays
      detaches: [],
      // A story a review detached here reuses its row
      joins: [
        { storyId: 's20', entryId: null, role: turningRole },
        { storyId: 's22', entryId: 'x22', role: routine },
      ],
      kept: 3,
      costUsd: 0.1,
      model: 'large',
    })
    expect(r.anchor).toEqual([
      { entryId: 'e1', founding: true, passed: true },
      { entryId: 'e2', founding: true, passed: true },
      { entryId: 'e3', founding: false, passed: true },
    ])
    // The check sees the proposed charter, the stories and the neighbors, never the anchor marks or the old IN
    const shown = deps.check.mock.calls[0]![0]
    expect(shown.charter.in).toBe('The Colorado River water shortage and the fight over its rules.')
    expect(JSON.stringify(shown)).not.toContain('anchor')
    expect(shown.neighbours).toEqual([{ ref: 'N1', title: 'Sacramento Valley sinking', in: 'Subsidence in the Sacramento Valley.' }])
    expect(deps.draft.mock.calls[0]![0].entries.map(e => e.anchor)).toEqual([true, true, true, false])
  })

  it('detaches only an unlocked entry outside the anchor that both calls rejected', async () => {
    const c = recenterCase({ entries: [...recenterCase().entries, ...[5, 6, 7, 8].map(i => reviewEntry(i))] })
    const entries = c.entries.map((_, i) => `E${i + 1}`)
    const r = await run(draft({ entries: judged(entries, ['E5', 'E6']) }), check({ entries: judged(entries, ['E5']).map(e => ({ ...e, reason: 'Why.' })) }), c)
      .result
    expect(r).toMatchObject({ outcome: 'recentered', detaches: [{ entryId: 'e5', storyId: 'm5' }], kept: 6 })
  })

  it('ends at a keep, and at a draft code refuses, without asking the check', async () => {
    for (const [answer, rule] of [
      [draft({ decision: 'keep' }), null],
      [draft({ charter: { ...draft().charter, out: ['Sacramento aquifer'] } }), 'out'],
      [draft({ charter: { ...draft().charter, out: ['Western drought', 'Lake Mead tourism'] } }), 'out'],
      [draft({ charter: { ...draft().charter, out: ['Western drought', 'x'.repeat(ATTEMPT.maxOutChars + 1)] } }), 'out'],
      [draft({ title: '' }), 'draft'],
      // A story judged among the entries (with no role), or an entry among the stories, is a malformed draft
      [draft({ entries: [...judged(['E1', 'E2', 'E3', 'E4']), { id: 'S1', belongs: 'yes' }], stories: draft().stories.slice(1) }), 'draft'],
      [draft({ stories: [...draft().stories, { id: 'E2', belongs: 'no', ...routine }] }), 'draft'],
      [
        draft({
          title: 'Colorado River rules',
          charter: { in: 'The fight over the post-2026 rules.', out: ['Western drought'], endEvent: 'The final rule is published' },
        }),
        'draft',
      ],
    ] as const) {
      const { deps, result } = run(answer, check())
      expect(await result).toMatchObject({ outcome: rule ? 'refused' : 'kept', rule, joins: [], detaches: [] })
      expect(deps.check).not.toHaveBeenCalled()
    }
  })

  it('refuses a proposal the check undoes, naming every rule that failed, and applies nothing of it', async () => {
    const refused = async (d: RecenterAnswer, k: RecenterCheckAnswer, c?: RecenterCase) => {
      const r = await run(d, k, c).result
      expect(r).toMatchObject({ outcome: 'refused', joins: [], detaches: [] })
      return r.refusals.map(x => x.rule)
    }
    // A named end event the check finds vague; none named is no fault
    expect(await refused(draft({ charter: { ...draft().charter, endEvent: 'Things improve' } }), check({ endEventConcrete: 'no' }))).toEqual(['end_event'])
    // A founding entry the check rejects breaks the anchor, and the share it keeps
    expect(await refused(draft(), check({}, ['E1']))).toEqual(['anchor'])
    expect(await refused(draft(), check({}, ['E1', 'E3']))).toEqual(['anchor', 'kept'])
    // Two of four kept by both is under 75%
    const sixth = recenterCase({
      entries: [...recenterCase().entries, reviewEntry(5), reviewEntry(6)],
      anchor: { founding: ['e1'], standIns: false, turningPoints: [] },
    })
    const six = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']
    expect(await refused(draft({ entries: judged(six) }), check({ entries: judged(six, ['E2', 'E5']).map(e => ({ ...e, reason: 'Why.' })) }), sixth)).toEqual([
      'kept',
    ])
    // One story both took in is too few
    expect(await refused(draft({}, ['S2']), check({}, ['S3']))).toEqual(['joins'])
    // A neighbor its IN takes in; an id naming no neighbor counts for nothing
    expect(await refused(draft(), check({ neighbours: [{ id: 'N1', covered: 'yes' }] }))).toEqual(['neighbour'])
    expect((await run(draft(), check({ neighbours: [{ id: 'N7', covered: 'yes' }] })).result).outcome).toBe('recentered')
  })

  it('holds a re-center to the detach brake even when the share keeps', async () => {
    // Eight entries, six locked: detaching both unlocked ones keeps 75% but is more than half of the unlocked
    const locked = [1, 2, 3, 4, 5, 6, 7, 8].map(i => reviewEntry(i, routine, i > 2))
    const c = recenterCase({ entries: locked, anchor: { founding: ['e3'], standIns: false, turningPoints: [] } })
    const refs = locked.map((_, i) => `E${i + 1}`)
    const r = await run(draft({ entries: judged(refs, ['E1', 'E2']) }), check({ entries: judged(refs, ['E1', 'E2']).map(e => ({ ...e, reason: 'Why.' })) }), c)
      .result
    expect(r).toMatchObject({ outcome: 'refused', rule: 'brake' })
  })

  it('is failed when a call gives nothing, and the draft’s cost is still counted', async () => {
    expect(await run(null, check()).result).toMatchObject({ outcome: 'failed', costUsd: 0.05, answer: { draft: null, check: null } })
    expect(await run(draft(), null).result).toMatchObject({ outcome: 'failed', costUsd: 0.1 })
  })
})
