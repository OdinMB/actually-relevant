import { describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import type { FoundAnswer, FoundCheckAnswer, LinkAnswer, LinkCandidateAnswer } from '../schemas/overviews.js'
import type { Neighbour } from './overviewCandidates.js'
import {
  acceptFounding,
  acceptLink,
  isStale,
  linkInOrder,
  linkStory,
  type ApplyLink,
  type LinkDeps,
  type LinkResult,
  type ShownOverview,
  type ShownPartner,
} from './overviewLink.js'
import type { CandidateOverview, LinkStory, Membership, Memberships } from './overviewTypes.js'

const at = (day: number) => new Date(Date.UTC(2026, 4, day, 12))

const story = (id: string, day: number, over: Partial<LinkStory> = {}): LinkStory => ({
  id,
  title: `Ebola cases rise in Ituri ${id}`,
  label: 'Ebola in DR Congo',
  summary: 'The outbreak in Ituri province grew this week; it ends when the ministry declares it over.',
  datePublished: at(day),
  date: at(day).toISOString().slice(0, 10),
  issueId: null,
  facts: [],
  ...over,
})

const overview = (id: string, over: Partial<CandidateOverview> = {}): CandidateOverview => ({
  id,
  title: 'Ebola outbreak in eastern DR Congo',
  charter: { in: 'The Ebola outbreak in Ituri province.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares the outbreak over' },
  entries: [],
  ...over,
})

const yes = (id: string, over: Partial<LinkCandidateAnswer> = {}): LinkCandidateAnswer => ({
  id,
  belongs: 'yes',
  cause: { story: 'Ebola', other: 'Ebola' },
  place: { story: 'Ituri', other: 'Ituri' },
  end: { story: 'declares it over', other: 'declares the outbreak over' },
  reportsEndEvent: false,
  scope: 'inside',
  centerMoved: false,
  signalQuote: '',
  confidence: 0.9,
  ...over,
})
const no = (id: string, over: Partial<LinkCandidateAnswer> = {}): LinkCandidateAnswer => ({ ...yes(id), belongs: 'no', scope: 'unrelated', ...over })
/** A yes for a founding partner: its quotes come from the partner's own texts. */
const yesPartner = (id: string): LinkCandidateAnswer => yes(id, { end: { story: 'declares it over', other: 'declares it over' } })

const answer = (candidates: LinkCandidateAnswer[]): LinkAnswer => ({ candidates, role: 'routine', roleKind: null })

const shownOverview = (id: string, ref: string, distance: number, frozen = false): ShownOverview => ({ ...overview(id), ref, distance, frozen })
const shownPartner = (s: LinkStory, ref: string, distance: number): ShownPartner => ({ ...s, ref, distance })

const draft: FoundAnswer = {
  title: 'Ebola outbreak in Ituri',
  charter: { in: 'The Ebola outbreak in Ituri province since May 2026.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares the outbreak over' },
  roles: { a: { role: 'turning_point', roleKind: 'spread' }, b: { role: 'routine', roleKind: 'setback' } },
}
const agree: FoundCheckAnswer = { a: { fits: 'yes', reason: 'r', occurred: 'yes' }, b: { fits: 'yes', reason: 'r', occurred: 'yes' }, endEventConcrete: 'yes' }

describe('acceptLink', () => {
  const s = story('s', 10)

  it('takes a yes with all three fields quoted from both sides', () => {
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.2)], [], answer([yes('O1')]))
    expect(got.join?.candidate.id).toBe('A')
    expect(got.refusals).toEqual([])
    expect(got.proposed).toBe(1)
  })

  it('refuses a yes with a field left empty, or a quote not found on its side', () => {
    const missing = yes('O1', { place: { story: 'Ituri', other: '' } })
    const invented = yes('O2', { cause: { story: 'cholera', other: 'Ebola' } })
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1), shownOverview('B', 'O2', 0.2)], [], answer([missing, invented]))
    expect(got.join).toBeNull()
    expect(got.refusals.map(r => r.id)).toEqual(['O1', 'O2'])
    expect(got.proposed).toBe(2)
  })

  it('counts unsure as none', () => {
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1)], [], answer([{ ...yes('O1'), belongs: 'unsure' }]))
    expect(got).toMatchObject({ join: null, partner: null, proposed: 0, refusals: [] })
  })

  it('joins the nearest of several passing overviews', () => {
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1), shownOverview('B', 'O2', 0.2)], [], answer([yes('O2'), yes('O1')]))
    expect(got.join?.candidate.id).toBe('A')
  })

  it('considers a founding partner only when no overview passed', () => {
    const partner = shownPartner(story('p', 5), 'F1', 0.2)
    expect(acceptLink(s, [shownOverview('A', 'O1', 0.1)], [partner], answer([yes('O1'), yesPartner('F1')])).partner).toBeNull()
    expect(acceptLink(s, [shownOverview('A', 'O1', 0.1)], [partner], answer([no('O1'), yesPartner('F1')])).partner?.candidate.id).toBe('p')
  })

  it('gives every passing founding partner, nearest first', () => {
    const [p, q, r] = [shownPartner(story('p', 5), 'F1', 0.1), shownPartner(story('q', 6), 'F2', 0.2), shownPartner(story('r', 7), 'F3', 0.3)]
    const got = acceptLink(s, [], [p, q, r], answer([yesPartner('F3'), no('F2'), yesPartner('F1')]))
    expect(got.partners.map(x => x.candidate.id)).toEqual(['p', 'r'])
    expect(got.partner?.candidate.id).toBe('p')
  })

  it('matches quotes after the same normalization the answer keys use', () => {
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1)], [], answer([yes('O1', { cause: { story: '  EBOLA ', other: 'ebola' } })]))
    expect(got.join).not.toBeNull()
  })

  it("refuses a yes whose overview quote is found only in the charter's OUT list", () => {
    // "Ebola in Uganda" is what the charter keeps out: it can never be what the two share
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1)], [], answer([yes('O1', { place: { story: 'Ituri', other: 'Uganda' } })]))
    expect(got.join).toBeNull()
    expect(got.refusals).toEqual([{ id: 'O1', reason: "place: the candidate's quote is not in its text" }])
  })

  it('passes a yes with an empty end on the cause and the place, for an overview naming an end event and for a founding partner', () => {
    const emptyEnd = { end: { story: '', other: '' } }
    expect(acceptLink(s, [shownOverview('A', 'O1', 0.1)], [], answer([yes('O1', emptyEnd)]))).toMatchObject({ join: { candidate: { id: 'A' } }, refusals: [] })
    const partner = shownPartner(story('p', 5), 'F1', 0.2)
    expect(acceptLink(s, [], [partner], answer([yes('F1', emptyEnd)]))).toMatchObject({ partner: { candidate: { id: 'p' } }, refusals: [] })
  })

  it('drops the end, and passes the yes, when an end quote is not found on its side, each side on its own', () => {
    const shown = [shownOverview('A', 'O1', 0.1)]
    const storySide = yes('O1', { end: { story: 'the WHO lifts the emergency', other: 'declares the outbreak over' } })
    expect(acceptLink(s, shown, [], answer([storySide]))).toMatchObject({
      join: { candidate: { id: 'A' }, endDropped: true, shared: { end: { story: '', other: '' } } },
      refusals: [],
    })
    const otherSide = yes('O1', { end: { story: 'declares it over', other: 'the WHO lifts the emergency' } })
    expect(acceptLink(s, shown, [], answer([otherSide]))).toMatchObject({ join: { endDropped: true }, refusals: [] })
    expect(acceptLink(s, shown, [], answer([yes('O1')]))).toMatchObject({ join: { endDropped: false, shared: { end: { story: 'declares it over' } } } })
    const partner = shownPartner(story('p', 5), 'F1', 0.2)
    expect(acceptLink(s, [], [partner], answer([yes('F1', { end: { story: '', other: 'reporting stops' } })]))).toMatchObject({
      partner: { candidate: { id: 'p' }, endDropped: true },
      refusals: [],
    })
  })

  it('still refuses a yes whose cause or place quote is not found', () => {
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1)], [], answer([yes('O1', { cause: { story: 'cholera', other: 'Ebola' } })]))
    expect(got).toMatchObject({ join: null, refusals: [{ id: 'O1', reason: "cause: the story's quote is not in its text" }] })
  })

  it('finds a quote with a small misspelling in a long word, and marks the join as passed by the near match', () => {
    const t = story('t', 10, { summary: 'The Bundibugyo outbreak in Ituri province grew this week.' })
    const near = yes('O1', { cause: { story: 'Bundibyo outbreak', other: 'Ebola' }, end: { story: '', other: '' } })
    expect(acceptLink(t, [shownOverview('A', 'O1', 0.1)], [], answer([near]))).toMatchObject({ join: { candidate: { id: 'A' }, nearMatch: true } })
    const exact = yes('O1', { cause: { story: 'Bundibugyo outbreak', other: 'Ebola' }, end: { story: '', other: '' } })
    expect(acceptLink(t, [shownOverview('A', 'O1', 0.1)], [], answer([exact]))).toMatchObject({ join: { nearMatch: false } })
  })

  it('considers no founding partner when code refused a yes to an overview, and names that overview', () => {
    const partner = shownPartner(story('p', 5), 'F1', 0.2)
    const refused = yes('O1', { place: { story: 'Ituri', other: '' } })
    expect(acceptLink(s, [shownOverview('A', 'O1', 0.1)], [partner], answer([refused, yesPartner('F1')]))).toMatchObject({
      join: null,
      partner: null,
      blockedBy: 'A',
      refusals: [{ id: 'O1', reason: 'no place on both sides' }],
    })
    // A refused yes to a partner alone still lets the next passing partner found
    const other = shownPartner(story('q', 6), 'F2', 0.3)
    expect(acceptLink(s, [], [partner, other], answer([yes('F1', { place: { story: 'Ituri', other: '' } }), yesPartner('F2')]))).toMatchObject({
      partner: { candidate: { id: 'q' } },
      blockedBy: null,
    })
  })

  it('passes a half-filled end whose filled side is found', () => {
    const shown = [shownOverview('A', 'O1', 0.1)]
    expect(acceptLink(s, shown, [], answer([yes('O1', { end: { story: 'declares it over', other: '' } })])).join).not.toBeNull()
    expect(acceptLink(s, shown, [], answer([yes('O1', { end: { story: ' ', other: 'declares the outbreak over' } })])).join).not.toBeNull()
  })

  it('holds an overview naming no end event to the same rule: an empty end passes, an end quote found nowhere drops the end', () => {
    const none = { ...shownOverview('A', 'O1', 0.1), charter: { in: 'The Ebola outbreak in Ituri province.', out: [], endEvent: null } }
    const emptyEnd = yes('O1', { end: { story: '', other: '' } })
    expect(acceptLink(s, [none], [], answer([emptyEnd]))).toMatchObject({ join: { candidate: { id: 'A' } }, refusals: [] })
    expect(acceptLink(s, [none], [], answer([yes('O1', { end: { story: 'declares it over', other: 'reporting stops' } })]))).toMatchObject({
      join: { endDropped: true },
      refusals: [],
    })
    // The cause and the place are still required
    expect(acceptLink(s, [none], [], answer([{ ...emptyEnd, place: { story: 'Ituri', other: '' } }])).refusals).toEqual([
      { id: 'O1', reason: 'no place on both sides' },
    ])
  })
})

describe('acceptLink: the re-center signal', () => {
  const s = story('s', 10, { summary: 'The outbreak in Ituri province grew; Ebola has now reached North Kivu and Goma.' })
  const shown = [shownOverview('A', 'O1', 0.1), shownOverview('B', 'O2', 0.2)]

  it('keeps a wider or centerMoved flag for an overview only with its quote found in the story', () => {
    const got = acceptLink(
      s,
      shown,
      [],
      answer([
        no('O1', { scope: 'wider', signalQuote: 'has now reached North Kivu' }),
        no('O2', { scope: 'wider', centerMoved: true, signalQuote: 'a national emergency' }),
      ]),
    )
    expect(got.signals).toEqual([{ overviewId: 'A', kind: 'wider', quote: 'has now reached North Kivu' }])
  })

  it('takes centerMoved apart from the scope, on a join too; inside and unrelated add nothing; a story candidate never flags', () => {
    const partner = shownPartner(story('p', 5), 'F1', 0.2)
    const got = acceptLink(
      s,
      shown,
      [partner],
      answer([
        yes('O1', { centerMoved: true, signalQuote: 'reached North Kivu and Goma' }),
        no('O2', { scope: 'unrelated', signalQuote: 'Goma' }),
        { ...no('F1'), scope: 'wider', centerMoved: true, signalQuote: 'Goma' },
      ]),
    )
    expect(got.signals).toEqual([{ overviewId: 'A', kind: 'center_moved', quote: 'reached North Kivu and Goma' }])
    expect(acceptLink(s, shown, [], answer([no('O1', { scope: 'wider', centerMoved: true, signalQuote: 'Goma' })])).signals).toEqual([
      { overviewId: 'A', kind: 'wider', quote: 'Goma' },
      { overviewId: 'A', kind: 'center_moved', quote: 'Goma' },
    ])
  })
})

describe('acceptFounding', () => {
  it('founds only when the check agrees on both stories and on a named end event', () => {
    expect(acceptFounding(draft, agree)).toBe('founded')
    expect(acceptFounding(draft, { ...agree, b: { fits: 'no', reason: 'r' } })).toBe('disagreed')
    expect(acceptFounding(draft, { ...agree, endEventConcrete: 'no' })).toBe('disagreed')
    expect(acceptFounding(draft, { ...agree, endEventConcrete: 'none' })).toBe('disagreed')
  })

  it('founds only when the check judges both stories to report an occurrence', () => {
    expect(acceptFounding(draft, { ...agree, a: { ...agree.a, occurred: 'no' } })).toBe('disagreed')
    expect(acceptFounding(draft, { ...agree, b: { ...agree.b, occurred: 'no' } })).toBe('disagreed')
  })

  it('founds a charter that names no end event on the stories alone, and fails on a call that gave nothing', () => {
    const none = { ...draft, charter: { ...draft.charter, endEvent: ' ' } }
    expect(acceptFounding(none, { ...agree, endEventConcrete: 'none' })).toBe('founded')
    // The check's word on an end event the draft did not name does not count
    expect(acceptFounding(none, { ...agree, endEventConcrete: 'no' })).toBe('founded')
    expect(acceptFounding(none, { ...agree, a: { fits: 'no', reason: 'r' } })).toBe('disagreed')
    expect(acceptFounding({ ...draft, title: ' ' }, agree)).toBe('refused')
    expect(acceptFounding(null, agree)).toBe('failed')
    expect(acceptFounding(draft, null)).toBe('failed')
  })

  it('refuses a draft past the charter limits every writer is held to, without its check', () => {
    const past = (over: Partial<typeof draft.charter>, title = draft.title) =>
      acceptFounding({ ...draft, title, charter: { ...draft.charter, ...over } }, agree)
    expect(past({}, 'x'.repeat(config.overviews.maxTitleChars + 1))).toBe('refused')
    expect(past({ in: 'x'.repeat(config.overviews.maxInChars + 1) })).toBe('refused')
    expect(past({ endEvent: 'x'.repeat(config.overviews.maxEndEventChars + 1) })).toBe('refused')
    expect(past({ out: ['x'.repeat(config.overviews.maxOutChars + 1)] })).toBe('refused')
    expect(past({ out: Array.from({ length: config.overviews.maxOutEntries + 1 }, (_, i) => `out ${i}`) })).toBe('refused')
    expect(past({ out: Array.from({ length: config.overviews.maxOutEntries }, (_, i) => `out ${i}`) })).toBe('founded')
  })
})

/** An in-memory world: each story's neighbours, the memberships, the overviews, and scripted model answers. */
function world(options: {
  stories: LinkStory[]
  neighbours?: Record<string, { id: string; distance: number }[]>
  members?: Record<string, Membership>
  lockedOut?: Record<string, string[]>
  overviews?: CandidateOverview[]
  link?: (input: Parameters<LinkDeps['link']>[0]) => LinkAnswer | null
  found?: FoundAnswer | null
  check?: FoundCheckAnswer | null
}) {
  const byId = new Map(options.stories.map(s => [s.id, s]))
  const members = new Map(Object.entries(options.members ?? {}))
  const calls = { link: vi.fn(), found: vi.fn(), foundCheck: vi.fn() }
  const deps: LinkDeps = {
    neighbours: async s =>
      (options.neighbours?.[s.id] ?? []).map((n): Neighbour => ({ id: n.id, distance: n.distance, datePublished: byId.get(n.id)!.datePublished, via: 'near' })),
    memberships: async (): Promise<Memberships> => ({ active: new Map(members), lockedOut: new Map(Object.entries(options.lockedOut ?? {})) }),
    overviews: async ids => (options.overviews ?? []).filter(o => ids.includes(o.id)),
    stories: async ids => ids.flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])),
    link: async input => {
      calls.link(input)
      return { parsed: options.link ? options.link(input) : null, costUsd: 0.001, model: 'small-model' }
    },
    found: async input => {
      calls.found(input)
      return { parsed: options.found === undefined ? draft : options.found, costUsd: 0.02, model: 'large-model' }
    },
    foundCheck: async input => {
      calls.foundCheck(input)
      return { parsed: options.check === undefined ? agree : options.check, costUsd: 0.02, model: 'large-model' }
    },
  }
  return { deps, calls, members }
}

const membership = (overviewId: string, over: Partial<Membership> = {}): Membership => ({
  overviewId,
  scope: 'forming',
  status: 'open',
  closedReason: null,
  frozen: false,
  lastEntryAt: at(1),
  ...over,
})

describe('linkStory', () => {
  it('stores none without a model call when the story has no candidate', async () => {
    const w = world({ stories: [story('s', 10)] })
    const got = await linkStory(story('s', 10), w.deps)
    expect(got.outcome).toBe('none')
    expect(w.calls.link).not.toHaveBeenCalled()
  })

  it('joins the overview the model confirms, with the role and the end-event flag', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8)],
      neighbours: { s: [{ id: 'm', distance: 0.2 }] },
      members: { m: membership('A') },
      overviews: [overview('A')],
      link: () => ({ ...answer([yes('O1', { reportsEndEvent: true })]), role: 'turning_point', roleKind: 'decision' }),
    })
    const got = await linkStory(s, w.deps)
    expect(got).toMatchObject({
      outcome: 'joined',
      role: { role: 'turning_point', roleKind: 'decision' },
      join: { candidate: { id: 'A' }, reportsEndEvent: true },
    })
    expect(got.promptVersion).toMatch(/\S/)
  })

  /** A world where `s` is linked against overview A, `charter` its charter, the model's answer given. */
  const joining = (link: LinkAnswer, charter = overview('A').charter) => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8)],
      neighbours: { s: [{ id: 'm', distance: 0.2 }] },
      members: { m: membership('A') },
      overviews: [overview('A', { charter })],
      link: () => link,
    })
    return linkStory(s, w.deps)
  }

  it("makes a routine story that reports the overview's end event a turning point, a milestone, and records the flag", async () => {
    const got = await joining(answer([yes('O1', { reportsEndEvent: true })]))
    expect(got).toMatchObject({ outcome: 'joined', role: { role: 'turning_point', roleKind: 'milestone' }, join: { reportsEndEvent: true } })
  })

  it('keeps the kind of a turning point that reports the end event', async () => {
    const got = await joining({ ...answer([yes('O1', { reportsEndEvent: true })]), role: 'turning_point', roleKind: 'deescalation' })
    expect(got).toMatchObject({ outcome: 'joined', role: { role: 'turning_point', roleKind: 'deescalation' }, join: { reportsEndEvent: true } })
  })

  it('counts no end-event flag for a join whose end quote was not found, and leaves the role as answered', async () => {
    const got = await joining(
      answer([yes('O1', { reportsEndEvent: true, end: { story: 'the WHO lifts the emergency', other: 'declares the outbreak over' } })]),
    )
    expect(got).toMatchObject({ outcome: 'joined', role: { role: 'routine', roleKind: null }, join: { reportsEndEvent: false, endDropped: true } })
  })

  it('stores a story whose refused yes to an overview blocked its founding as rejected, with no founding call', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8), story('p', 7)],
      neighbours: {
        s: [
          { id: 'm', distance: 0.2 },
          { id: 'p', distance: 0.3 },
        ],
      },
      members: { m: membership('A') },
      overviews: [overview('A')],
      link: () => answer([yes('O1', { place: { story: 'Kivu', other: 'Ituri' } }), yesPartner('F1')]),
    })
    expect(await linkStory(s, w.deps)).toMatchObject({ outcome: 'rejected', founding: null, foundingBlockedBy: 'A' })
    expect(w.calls.found).not.toHaveBeenCalled()
  })

  it('drops the flag on an overview naming no end event, as the call was shown it, and leaves the role as answered', async () => {
    const none = { in: 'The Ebola outbreak in Ituri province.', out: [], endEvent: null }
    const got = await joining(answer([yes('O1', { reportsEndEvent: true, end: { story: '', other: '' } })]), none)
    expect(got).toMatchObject({ outcome: 'joined', role: { role: 'routine', roleKind: null }, join: { reportsEndEvent: false } })
  })

  it('holds a story whose nearest passing overview is frozen, by that overview, with no join', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8)],
      neighbours: { s: [{ id: 'm', distance: 0.2 }] },
      members: { m: membership('A', { frozen: true }) },
      overviews: [overview('A')],
      link: () => answer([yes('O1')]),
    })
    expect(await linkStory(s, w.deps)).toMatchObject({ outcome: 'held', heldBy: 'A', join: null })
  })

  it('never joins an overview closed by an editor, nor one an editor detached the story from', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8), story('n', 9)],
      neighbours: {
        s: [
          { id: 'm', distance: 0.2 },
          { id: 'n', distance: 0.3 },
        ],
      },
      members: { m: membership('A', { status: 'closed', closedReason: 'editor' }), n: membership('B') },
      lockedOut: { s: ['B'] },
      overviews: [overview('A'), overview('B')],
      link: () => answer([yes('O1'), yes('O2')]),
    })
    expect((await linkStory(s, w.deps)).outcome).toBe('none')
    expect(w.calls.link).not.toHaveBeenCalled()
  })

  it('offers a faded overview, so a confirmed story joins it', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8)],
      neighbours: { s: [{ id: 'm', distance: 0.2 }] },
      members: { m: membership('A', { status: 'closed', closedReason: 'faded' }) },
      overviews: [overview('A')],
      link: () => answer([yes('O1')]),
    })
    expect(await linkStory(s, w.deps)).toMatchObject({ outcome: 'joined', join: { candidate: { id: 'A' } } })
  })

  it('stores a yes code refused as rejected', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8)],
      neighbours: { s: [{ id: 'm', distance: 0.2 }] },
      members: { m: membership('A') },
      overviews: [overview('A')],
      link: () => answer([yes('O1', { place: { story: 'Kivu', other: 'Ituri' } })]),
    })
    const got = await linkStory(s, w.deps)
    expect(got.outcome).toBe('rejected')
    expect(got.refusals).toHaveLength(1)
  })

  it('founds with a confirmed partner when both founding calls agree, the earlier story as A', async () => {
    const s = story('s', 10)
    const p = story('p', 5)
    const w = world({ stories: [s, p], neighbours: { s: [{ id: 'p', distance: 0.2 }] }, link: () => answer([yesPartner('F1')]) })
    const got = await linkStory(s, w.deps)
    expect(got.outcome).toBe('founded')
    expect(w.calls.found).toHaveBeenCalledWith({ a: p, b: s })
    // The story is B, so its role is the draft's b
    expect(got.role).toEqual({ role: 'routine', roleKind: null })
    expect(got.founding).toMatchObject({ outcome: 'founded', partner: { id: 'p' }, draft: { title: 'Ebola outbreak in Ituri' } })
  })

  it('founds nothing when the check disagrees, and logs the attempt with the story left alone', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('p', 5)],
      neighbours: { s: [{ id: 'p', distance: 0.2 }] },
      link: () => answer([yesPartner('F1')]),
      check: { ...agree, a: { fits: 'no', reason: 'another outbreak' } },
    })
    const got = await linkStory(s, w.deps)
    expect(got).toMatchObject({ outcome: 'none', founding: { outcome: 'disagreed', draft: null } })
  })

  it('founds a draft that names no end event, its charter storing none, once the check finds both stories fit', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('p', 5)],
      neighbours: { s: [{ id: 'p', distance: 0.2 }] },
      link: () => answer([yesPartner('F1')]),
      found: { ...draft, charter: { ...draft.charter, endEvent: '  ' } },
      check: { ...agree, endEventConcrete: 'none' },
    })
    const got = await linkStory(s, w.deps)
    expect(got).toMatchObject({ outcome: 'founded', founding: { outcome: 'founded' } })
    expect(got.founding?.draft?.charter.endEvent).toBeNull()
    expect(w.calls.foundCheck).toHaveBeenCalledWith(expect.objectContaining({ charter: expect.objectContaining({ endEvent: null }) }))
  })

  describe('a founding refused only because the partner reported no occurrence', () => {
    /** The story s with three passing partners, nearest first; `checks` answers the founding checks in turn. */
    const tried = (checks: FoundCheckAnswer[], foundingCandidates = 3) => {
      const s = story('s', 10)
      const partners = [story('w1', 7), story('w2', 8), story('e', 9)]
      let n = 0
      const w = world({
        stories: [s, ...partners],
        neighbours: { s: partners.map((p, i) => ({ id: p.id, distance: 0.1 * (i + 1) })) },
        link: input => answer(input.partners.map(p => yesPartner(p.ref))),
      })
      const deps: LinkDeps = {
        ...w.deps,
        options: { ...config.overviews, foundingCandidates },
        foundCheck: async input => {
          w.calls.foundCheck(input)
          return { parsed: checks[n++] ?? agree, costUsd: 0.02, model: 'large-model' }
        },
      }
      return { got: linkStory(s, deps), calls: w.calls }
    }
    // The partner is the earlier story, so it is A
    const partnerSilent = { ...agree, a: { ...agree.a, occurred: 'no' as const } }

    it('tries the next passing partner, nearest first, and founds with it, the refused attempt kept', async () => {
      const { got, calls } = tried([partnerSilent, partnerSilent, agree])
      expect(await got).toMatchObject({ outcome: 'founded', founding: { partner: { id: 'e' }, outcome: 'founded' } })
      expect((await got).refusedFoundings.map(f => [f.partner.id, f.outcome])).toEqual([
        ['w1', 'disagreed'],
        ['w2', 'disagreed'],
      ])
      expect(calls.found).toHaveBeenCalledTimes(3)
    })

    it('tries no other partner when the story itself reported none, a story did not fit, or a named end event was vague', async () => {
      for (const check of [
        { ...agree, b: { ...agree.b, occurred: 'no' as const } },
        { ...partnerSilent, b: { ...agree.b, fits: 'no' as const } },
        { ...partnerSilent, endEventConcrete: 'no' as const },
      ]) {
        const { got, calls } = tried([check])
        expect(await got).toMatchObject({ outcome: 'none', founding: { partner: { id: 'w1' }, outcome: 'disagreed' }, refusedFoundings: [] })
        expect(calls.found).toHaveBeenCalledTimes(1)
      }
    })

    it('makes at most foundingCandidates attempts in all', async () => {
      const { got, calls } = tried([partnerSilent, partnerSilent, agree], 2)
      expect(await got).toMatchObject({ outcome: 'none', founding: { partner: { id: 'w2' } } })
      expect(calls.found).toHaveBeenCalledTimes(2)
    })
  })

  it('refuses a draft without a title without asking the check', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('p', 5)],
      neighbours: { s: [{ id: 'p', distance: 0.2 }] },
      link: () => answer([yesPartner('F1')]),
      found: { ...draft, title: '' },
    })
    expect(await linkStory(s, w.deps)).toMatchObject({ outcome: 'none', founding: { outcome: 'refused' } })
    expect(w.calls.foundCheck).not.toHaveBeenCalled()
  })

  it('fails, for the next run, when the link call gives nothing', async () => {
    const s = story('s', 10)
    const w = world({ stories: [s, story('p', 5)], neighbours: { s: [{ id: 'p', distance: 0.2 }] }, link: () => null })
    expect((await linkStory(s, w.deps)).outcome).toBe('failed')
  })
})

describe('linkInOrder', () => {
  /** A writer over the world's memberships: joins and foundings add members, as the lifecycle's do. */
  const memoryWriter =
    (members: Map<string, Membership>, writes: string[]): ApplyLink =>
    async (result, lastTry) => {
      const now: Memberships = { active: members, lockedOut: new Map() }
      if (members.has(result.story.id)) return { kind: 'skipped' }
      if (isStale(result, now)) {
        if (!lastTry) return { kind: 'stale' }
        writes.push(`${result.story.id}:conflict`)
        return { kind: 'written', outcome: 'conflict' }
      }
      if (result.outcome === 'joined') members.set(result.story.id, membership(result.join!.candidate.id))
      if (result.outcome === 'founded') {
        members.set(result.story.id, membership('NEW'))
        members.set(result.founding!.partner.id, membership('NEW'))
      }
      writes.push(`${result.story.id}:${result.outcome}`)
      return { kind: 'written', outcome: result.outcome }
    }

  it('writes in the order given, whatever order the calls end in', async () => {
    const stories = [story('a', 1), story('b', 2), story('c', 3)]
    const w = world({ stories })
    const delays: Record<string, number> = { a: 30, b: 1, c: 10 }
    const slow: LinkDeps = { ...w.deps, neighbours: async s => (await new Promise(r => setTimeout(r, delays[s.id])), []) }
    const writes: string[] = []
    await linkInOrder(stories, slow, memoryWriter(w.members, writes), { concurrency: 3 })
    expect(writes).toEqual(['a:none', 'b:none', 'c:none'])
  })

  it('two stories of one night proposing the same partner found one overview, the second joining it', async () => {
    const p = story('p', 1)
    const s1 = story('s1', 2)
    const s2 = story('s2', 3)
    const stories = [s1, s2]
    const w = world({
      stories: [p, s1, s2],
      neighbours: { s1: [{ id: 'p', distance: 0.2 }], s2: [{ id: 'p', distance: 0.2 }] },
      overviews: [overview('NEW')],
      // Both see p unlinked at first; asked again, s2 sees p's new overview
      link: input => answer(input.overviews.length > 0 ? [yes('O1')] : [yesPartner('F1')]),
    })
    const writes: string[] = []
    const run = await linkInOrder(stories, w.deps, memoryWriter(w.members, writes), { concurrency: 2 })
    expect(writes).toEqual(['s1:founded', 's2:joined'])
    expect(run.outcomes.get('s2')).toBe('joined')
    expect(w.calls.found).toHaveBeenCalledTimes(2) // s2's first founding attempt went stale
    // The stale answer is not counted: each story's final result once, for the item tally
    expect(run.results.map(r => `${r.story.id}:${r.outcome}`)).toEqual(['s1:founded', 's2:joined'])
  })

  it('asks a stale result again at once, before the next story is written, and counts its second answer', async () => {
    const p = story('p', 1)
    const [s1, s2, s3] = [story('s1', 2), story('s2', 3), story('s3', 4)]
    const w = world({
      stories: [p, s1, s2, s3],
      neighbours: { s1: [{ id: 'p', distance: 0.2 }], s2: [{ id: 'p', distance: 0.2 }] },
      overviews: [overview('NEW')],
      link: input => answer(input.overviews.length > 0 ? [yes('O1')] : [yesPartner('F1')]),
    })
    const writes: string[] = []
    const run = await linkInOrder([s1, s2, s3], w.deps, memoryWriter(w.members, writes), { concurrency: 3 })
    expect(writes).toEqual(['s1:founded', 's2:joined', 's3:none'])
    expect(run.results.map(r => `${r.story.id}:${r.outcome}`)).toEqual(['s1:founded', 's2:joined', 's3:none'])
  })

  it('asks a stale result again only while the switch is on', async () => {
    const p = story('p', 1)
    const [s1, s2] = [story('s1', 2), story('s2', 3)]
    const w = world({
      stories: [p, s1, s2],
      neighbours: { s1: [{ id: 'p', distance: 0.2 }], s2: [{ id: 'p', distance: 0.2 }] },
      overviews: [overview('NEW')],
      link: input => answer(input.overviews.length > 0 ? [yes('O1')] : [yesPartner('F1')]),
    })
    const writes: string[] = []
    let asked = 0
    // On for s1's write, s2's first write (stale) and the check after it; off before the re-ask
    const run = await linkInOrder([s1, s2], w.deps, memoryWriter(w.members, writes), { concurrency: 2, keepGoing: async () => asked++ < 3 })
    expect(writes).toEqual(['s1:founded'])
    expect(run.outcomes.has('s2')).toBe(false)
  })

  it('stores a result stale twice as a conflict, left for the next run', async () => {
    const p = story('p', 1)
    const s = story('s', 2)
    const w = world({ stories: [p, s], neighbours: { s: [{ id: 'p', distance: 0.2 }] }, link: () => answer([yesPartner('F1')]) })
    const writes: string[] = []
    // Each read sees p unlinked, and each write finds it linked since
    const unlinkedReads: LinkDeps = { ...w.deps, memberships: async () => ({ active: new Map(), lockedOut: new Map() }) }
    w.members.set('p', membership('OTHER'))
    const run = await linkInOrder([s], unlinkedReads, memoryWriter(w.members, writes), { concurrency: 1 })
    expect(run.outcomes.get('s')).toBe('conflict')
    expect(writes).toEqual(['s:conflict'])
  })

  it('stops writing once the switch is off, leaving the rest owed', async () => {
    const stories = [story('a', 1), story('b', 2)]
    const w = world({ stories })
    const writes: string[] = []
    let calls = 0
    const run = await linkInOrder(stories, w.deps, memoryWriter(w.members, writes), { concurrency: 1, keepGoing: async () => calls++ < 1 })
    expect(writes).toEqual(['a:none'])
    expect(run.outcomes.size).toBe(1)
  })

  it('starts no call once the switch is off, and lets the calls in flight finish before it returns', async () => {
    const stories = [story('a', 1), story('b', 2), story('c', 3), story('d', 4)]
    const w = world({ stories })
    const read = vi.fn()
    let finished = 0
    const slow: LinkDeps = {
      ...w.deps,
      neighbours: async s => {
        read(s.id)
        await new Promise(r => setTimeout(r, 5))
        finished++
        return []
      },
    }
    let asked = 0
    // On after a's write is asked, off from then on: b was in flight already, c and d never start
    await linkInOrder(stories, slow, memoryWriter(w.members, []), { concurrency: 2, keepGoing: async () => asked++ < 1 })
    expect(read.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
    expect(finished).toBe(2)
  })

  it('stores a story whose read threw as failed and goes on', async () => {
    const stories = [story('a', 1), story('b', 2)]
    const w = world({ stories })
    const broken: LinkDeps = { ...w.deps, neighbours: async s => (s.id === 'a' ? Promise.reject(new Error('db gone')) : []) }
    const writes: string[] = []
    const run = await linkInOrder(stories, broken, memoryWriter(w.members, writes), { concurrency: 2 })
    expect(writes).toEqual(['a:failed', 'b:none'])
    expect((run.results[0] as LinkResult).error).toBeInstanceOf(Error)
  })

  it('keeps a story whose write stored nothing out of the stored outcomes, and names it unwritten', async () => {
    const stories = [story('a', 1), story('b', 2)]
    const w = world({ stories })
    const writes: string[] = []
    const write = memoryWriter(w.members, writes)
    const run = await linkInOrder(stories, w.deps, async (result, lastTry) => (result.story.id === 'a' ? { kind: 'unwritten' } : write(result, lastTry)), {
      concurrency: 1,
    })
    expect([...run.outcomes]).toEqual([['b', 'none']])
    expect(run.unwritten).toEqual(['a'])
    // Its call was made: its result counts for the item tally
    expect(run.results.map(r => r.story.id)).toEqual(['a', 'b'])
  })

  it('a backfilled development is founded from its earliest stories, and the later ones join it', async () => {
    const stories = [story('e1', 1), story('e2', 2), story('e3', 3)]
    const w = world({
      stories,
      neighbours: {
        e2: [{ id: 'e1', distance: 0.1 }],
        e3: [
          { id: 'e1', distance: 0.1 },
          { id: 'e2', distance: 0.15 },
        ],
      },
      overviews: [overview('NEW')],
      link: input => answer(input.overviews.length > 0 ? [yes('O1')] : input.partners.map(p => yesPartner(p.ref))),
    })
    const writes: string[] = []
    await linkInOrder(stories, w.deps, memoryWriter(w.members, writes), { concurrency: 1 })
    expect(writes).toEqual(['e1:none', 'e2:founded', 'e3:joined'])
    expect(w.calls.found).toHaveBeenCalledWith({ a: stories[0], b: stories[1] })
  })
})

// The windows count from the story's own date
it('a neighbour dated after the story is never a candidate', async () => {
  const s = story('s', 10)
  const later = story('later', 11)
  const w = world({ stories: [s, later], neighbours: { s: [{ id: 'later', distance: 0.1 }] }, link: () => answer([yesPartner('F1')]) })
  expect((await linkStory(s, w.deps)).outcome).toBe('none')
})
