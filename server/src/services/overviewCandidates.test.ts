import { describe, expect, it } from 'vitest'
import { groupCandidates, noOccurrenceOf, type CandidateOptions, type Neighbour } from './overviewCandidates.js'
import type { Membership, Memberships } from './overviewTypes.js'

const DAY = 86_400_000
const STORY_DATE = new Date('2026-06-01T12:00:00Z')
const story = { id: 'story', datePublished: STORY_DATE }
const daysBefore = (days: number) => new Date(STORY_DATE.getTime() - days * DAY)

const OPTIONS: CandidateOptions = {
  maxDistance: 0.45,
  neighbourLimit: 40,
  memberLookbackDays: 180,
  foundingWindowDays: 30,
  candidateOverviews: 5,
  foundingCandidates: 3,
}

const near = (id: string, distance: number, days = 1, via: Neighbour['via'] = 'near'): Neighbour => ({ id, distance, datePublished: daysBefore(days), via })

const member = (overviewId: string, over: Partial<Membership> = {}): Membership => ({
  overviewId,
  scope: 'forming',
  status: 'open',
  closedReason: null,
  frozen: false,
  lastEntryAt: daysBefore(2),
  ...over,
})

const memberships = (active: Record<string, Membership>, lockedOut: Record<string, string[]> = {}): Memberships => ({
  active: new Map(Object.entries(active)),
  lockedOut: new Map(Object.entries(lockedOut)),
})

describe('groupCandidates', () => {
  it('ranks each overview by its nearest member and keeps the nearest few', () => {
    const neighbours = [near('a1', 0.1), near('b1', 0.2), near('a2', 0.05), near('c1', 0.3)]
    const got = groupCandidates(story, neighbours, memberships({ a1: member('A'), a2: member('A'), b1: member('B'), c1: member('C') }), {
      ...OPTIONS,
      candidateOverviews: 2,
    })
    expect(got.overviews).toEqual([
      { overviewId: 'A', distance: 0.05, frozen: false },
      { overviewId: 'B', distance: 0.2, frozen: false },
    ])
  })

  it('leaves out an overview closed by an editor, and one whose newest entry is past the lookback, but keeps a faded one', () => {
    const neighbours = [near('a', 0.1), near('b', 0.1), near('c', 0.1)]
    const got = groupCandidates(
      story,
      neighbours,
      memberships({
        a: member('A', { status: 'closed', closedReason: 'editor' }),
        b: member('B', { lastEntryAt: daysBefore(181) }),
        c: member('C', { status: 'closed', closedReason: 'faded' }),
      }),
      OPTIONS,
    )
    expect(got.overviews.map(o => o.overviewId)).toEqual(['C'])
  })

  it('never offers an overview an editor detached the story from', () => {
    const got = groupCandidates(story, [near('a', 0.1), near('b', 0.2)], memberships({ a: member('A'), b: member('B') }, { story: ['A'] }), OPTIONS)
    expect(got.overviews.map(o => o.overviewId)).toEqual(['B'])
  })

  it('keeps a frozen overview, marked, so a story that belongs there is held', () => {
    const got = groupCandidates(story, [near('a', 0.1)], memberships({ a: member('A', { frozen: true }) }), OPTIONS)
    expect(got.overviews).toEqual([{ overviewId: 'A', distance: 0.1, frozen: true }])
  })

  it('offers unlinked neighbours as founding partners only within the founding window and the distance, nearest first', () => {
    const neighbours = [near('old', 0.1, 31), near('recent', 0.3, 29), near('closest', 0.2, 2), near('far', 0.5, 1, 'linked'), near('member', 0.1)]
    const got = groupCandidates(story, neighbours, memberships({ member: member('A') }), OPTIONS)
    expect(got.partners.map(p => p.id)).toEqual(['closest', 'recent'])
  })

  it('takes a linked story beyond the distance for its overview, never as a partner', () => {
    const got = groupCandidates(story, [near('linked', 2, 3, 'linked'), near('alone', 2, 3, 'linked')], memberships({ linked: member('A') }), OPTIONS)
    expect(got.overviews.map(o => o.overviewId)).toEqual(['A'])
    expect(got.partners).toEqual([])
  })

  it('ignores the story itself and any neighbour dated after it', () => {
    const later = { ...near('later', 0.1), datePublished: new Date(STORY_DATE.getTime() + DAY) }
    const got = groupCandidates(story, [near('story', 0), later], memberships({ later: member('A') }), OPTIONS)
    expect(got).toEqual({ overviews: [], partners: [], excludedPartners: [] })
  })

  it('caps the partners at foundingCandidates', () => {
    const got = groupCandidates(story, [near('a', 0.1), near('b', 0.2), near('c', 0.3)], memberships({}), { ...OPTIONS, foundingCandidates: 2 })
    expect(got.partners.map(p => p.id)).toEqual(['a', 'b'])
  })

  it("reads each story's latest founding check as A (the earlier, the partner on a tie) or B", () => {
    const check = (a: string, b: string) => ({ a: { occurred: a }, b: { occurred: b } })
    const attempt = (storyId: string, partnerId: string, storyDay: number, partnerDay: number, c: ReturnType<typeof check> | null) => ({
      storyId,
      partnerId,
      storyDate: daysBefore(-storyDay),
      partnerDate: daysBefore(-partnerDay),
      check: c,
    })
    expect(noOccurrenceOf([attempt('s', 'w', 2, 1, check('no', 'yes'))])).toEqual(new Set(['w']))
    expect(noOccurrenceOf([attempt('s', 'w', 1, 1, check('no', 'yes'))])).toEqual(new Set(['w']))
    expect(noOccurrenceOf([attempt('s', 'w', 1, 2, check('no', 'yes'))])).toEqual(new Set(['s']))
    // The latest answer stands, a check with none says nothing
    expect(noOccurrenceOf([attempt('s', 'w', 2, 1, check('no', 'yes')), attempt('t', 'w', 3, 1, check('yes', 'yes')), attempt('u', 'w', 4, 1, null)])).toEqual(
      new Set(),
    )
  })

  it('leaves out a partner whose latest founding check judged it to report no occurrence, before the cut, and never an overview', () => {
    const neighbours = [near('warning', 0.05), near('a', 0.1), near('b', 0.2), near('c', 0.3), near('m', 0.1)]
    const got = groupCandidates(story, neighbours, { ...memberships({ m: member('A') }), noOccurrence: new Set(['warning', 'm']) }, OPTIONS)
    expect(got.partners.map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(got.excludedPartners).toEqual(['warning'])
    expect(got.overviews.map(o => o.overviewId)).toEqual(['A'])
  })
})
