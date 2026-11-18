import { describe, expect, it, vi } from 'vitest'
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
  confidence: 0.9,
  ...over,
})
const no = (id: string): LinkCandidateAnswer => ({ ...yes(id), belongs: 'no' })
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
const agree: FoundCheckAnswer = { a: { fits: 'yes', reason: 'r' }, b: { fits: 'yes', reason: 'r' }, endEventConcrete: 'yes' }

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

  it('matches quotes after the same normalization the answer keys use', () => {
    const got = acceptLink(s, [shownOverview('A', 'O1', 0.1)], [], answer([yes('O1', { cause: { story: '  EBOLA ', other: 'ebola' } })]))
    expect(got.join).not.toBeNull()
  })
})

describe('acceptFounding', () => {
  it('founds only when the check agrees on both stories and the end event', () => {
    expect(acceptFounding(draft, agree)).toBe('founded')
    expect(acceptFounding(draft, { ...agree, b: { fits: 'no', reason: 'r' } })).toBe('disagreed')
    expect(acceptFounding(draft, { ...agree, endEventConcrete: 'no' })).toBe('disagreed')
  })

  it('refuses a charter without an end event, and fails on a call that gave nothing', () => {
    expect(acceptFounding({ ...draft, charter: { ...draft.charter, endEvent: ' ' } }, agree)).toBe('refused')
    expect(acceptFounding(null, agree)).toBe('failed')
    expect(acceptFounding(draft, null)).toBe('failed')
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

  it('holds a story whose nearest passing overview is frozen', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8)],
      neighbours: { s: [{ id: 'm', distance: 0.2 }] },
      members: { m: membership('A', { frozen: true }) },
      overviews: [overview('A')],
      link: () => answer([yes('O1')]),
    })
    expect((await linkStory(s, w.deps)).outcome).toBe('held')
  })

  it('never joins an overview closed at its end event, nor one an editor detached the story from', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('m', 8), story('n', 9)],
      neighbours: {
        s: [
          { id: 'm', distance: 0.2 },
          { id: 'n', distance: 0.3 },
        ],
      },
      members: { m: membership('A', { status: 'closed', closedReason: 'end_event' }), n: membership('B') },
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

  it('refuses a draft without an end event without asking the check', async () => {
    const s = story('s', 10)
    const w = world({
      stories: [s, story('p', 5)],
      neighbours: { s: [{ id: 'p', distance: 0.2 }] },
      link: () => answer([yesPartner('F1')]),
      found: { ...draft, charter: { ...draft.charter, endEvent: '' } },
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

  it('stores a story whose read threw as failed and goes on', async () => {
    const stories = [story('a', 1), story('b', 2)]
    const w = world({ stories })
    const broken: LinkDeps = { ...w.deps, neighbours: async s => (s.id === 'a' ? Promise.reject(new Error('db gone')) : []) }
    const writes: string[] = []
    const run = await linkInOrder(stories, broken, memoryWriter(w.members, writes), { concurrency: 2 })
    expect(writes).toEqual(['a:failed', 'b:none'])
    expect((run.results[0] as LinkResult).error).toBeInstanceOf(Error)
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
