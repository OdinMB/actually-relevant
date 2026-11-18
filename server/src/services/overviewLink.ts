/**
 * One story's linking over injected I/O (`.context/overviews.md`, "How a story is linked"), the same
 * in production (`jobs/linkOverviews.ts`) and in the eval's sandbox: its candidates (`groupCandidates`), the
 * link confirmation, the acceptance rules (`acceptLink`: cosine proposes, a model confirms, code
 * checks the quotes), and a founding (two large calls that must agree, `acceptFounding`). Then the
 * ordered run (`linkInOrder`): calls in flight at once, writes one story at a time in date order, a
 * stale answer asked again once. Pure: nothing here reads or writes the database.
 */
import { quoteFound } from '../lib/quoteMatch.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { OVERVIEW_PROMPT_VERSIONS, type FoundCheckInput, type FoundInput, type LinkInput } from '../prompts/overviews.js'
import type { FoundAnswer, FoundCheckAnswer, LinkAnswer, LinkCandidateAnswer } from '../schemas/overviews.js'
import { groupCandidates, type CandidateOptions, type Neighbour, type RankedOverview } from './overviewCandidates.js'
import type { CandidateOverview, Charter, FoundingOutcome, LinkOutcome, LinkStory, Memberships, Role, Shared } from './overviewTypes.js'

/** A model call's result, as `structuredCall` gives it. */
export interface ModelCall<T> {
  parsed: T | null
  costUsd: number
  model: string
}

/** What linking reads and calls: production's from the tables and the models, the sandbox's in memory. */
export interface LinkDeps {
  /** The story's neighbours as of its date (`nearestPublished`). */
  neighbours(story: LinkStory): Promise<Neighbour[]>
  /** The stories' memberships as they stand now, each overview's last entry as of `asOf`, the story's date (`membershipsOf`). */
  memberships(storyIds: string[], asOf: Date): Promise<Memberships>
  /** The overviews as the prompt shows them, their entries those published on or before `asOf` (`candidateOverviews`). */
  overviews(ids: string[], asOf: Date): Promise<CandidateOverview[]>
  /** Stories as linking reads them (`linkStories`). */
  stories(ids: string[]): Promise<LinkStory[]>
  link(input: LinkInput): Promise<ModelCall<LinkAnswer>>
  found(input: FoundInput): Promise<ModelCall<FoundAnswer>>
  foundCheck(input: FoundCheckInput): Promise<ModelCall<FoundCheckAnswer>>
  options?: CandidateOptions
}

/** A candidate as the prompt names it: the overview or the founding partner, under its ref. */
export interface ShownOverview extends CandidateOverview {
  ref: string
  distance: number
  frozen: boolean
}
export interface ShownPartner extends LinkStory {
  ref: string
  distance: number
}

/** A join or a founding partner code accepted: the candidate and the model's answer for it. */
export interface Accepted<C> {
  candidate: C
  answer: LinkCandidateAnswer
  shared: Shared
}

/** Why code refused a candidate the model said yes to. */
export interface Refusal {
  id: string
  reason: string
}

export interface Acceptance {
  /** The nearest overview that passed; null when none did. */
  join: Accepted<ShownOverview> | null
  /** The nearest passing founding partner, considered only when no overview passed. */
  partner: Accepted<ShownPartner> | null
  /** Candidates the model said yes to (joins proposed). */
  proposed: number
  refusals: Refusal[]
}

const SIDES = ['cause', 'place', 'end'] as const

const sharedOf = (a: LinkCandidateAnswer): Shared => ({
  cause: { story: a.cause.story, other: a.cause.other },
  place: { story: a.place.story, other: a.place.other },
  end: { story: a.end.story, other: a.end.other },
})

const storyTexts = (s: LinkStory) => [s.title, s.label, s.summary]
/** An overview's side of a quote: its title, its charter's IN and its END_EVENT. Never its OUT list, which names what does not belong. */
const overviewTexts = (o: CandidateOverview) => [o.title, o.charter.in, o.charter.endEvent]

/** Why a yes is refused: a shared field left empty, or a quote not found on its side; null when it passes. */
function refusalOf(answer: LinkCandidateAnswer, story: readonly string[], other: readonly string[]): string | null {
  for (const side of SIDES) {
    const pair = answer[side]
    if (!pair.story.trim() || !pair.other.trim()) return `no ${side} on both sides`
    if (!quoteFound(pair.story, story)) return `${side}: the story's quote is not in its text`
    if (!quoteFound(pair.other, other)) return `${side}: the candidate's quote is not in its text`
  }
  return null
}

/**
 * Which candidate the story joins or may found with (`.context/overviews.md`, "How a story is linked",
 * step 2): a yes passes only with all three shared fields filled on both sides and each quote found in
 * its side's text (the story's title, label or summary; the overview's title, IN or END_EVENT; the
 * partner's title, label or summary). `unsure` is no. The nearest passing overview wins (a story joins one at
 * most); a founding partner is considered only when no overview passed, the nearest passing first.
 */
export function acceptLink(story: LinkStory, overviews: readonly ShownOverview[], partners: readonly ShownPartner[], answer: LinkAnswer): Acceptance {
  const byRef = new Map(answer.candidates.map(c => [c.id.trim(), c]))
  const refusals: Refusal[] = []
  let proposed = 0
  const pick = <C extends { ref: string }>(candidates: readonly C[], texts: (c: C) => string[]): Accepted<C> | null => {
    let chosen: Accepted<C> | null = null
    for (const candidate of candidates) {
      const a = byRef.get(candidate.ref)
      if (a?.belongs !== 'yes') continue
      proposed++
      const reason = refusalOf(a, storyTexts(story), texts(candidate))
      if (reason) refusals.push({ id: candidate.ref, reason })
      else chosen ??= { candidate, answer: a, shared: sharedOf(a) }
    }
    return chosen
  }
  const join = pick(overviews, overviewTexts)
  const partner = pick(partners, storyTexts)
  return { join, partner: join ? null : partner, proposed, refusals }
}

/** A founding's charter, title and roles, on agreement. */
export interface FoundingDraft {
  title: string
  charter: Charter
  /** Roles of the earlier story (`a`) and the later (`b`). */
  roles: { a: Role; b: Role }
}

/** A draft that names no end event, no title or no IN founds nothing, and the check is not asked. */
export const draftRefused = (draft: FoundAnswer): boolean => !draft.charter.endEvent.trim() || !draft.title.trim() || !draft.charter.in.trim()

/**
 * Whether the two founding calls agree (`.context/overviews.md`, "How a story is linked", step 3):
 * `refused` for a draft `draftRefused` refuses; `founded` only when the check finds both stories fit
 * and the end event concrete, `disagreed` otherwise; `failed` for a call that gave no answer.
 */
export function acceptFounding(draft: FoundAnswer | null, check: FoundCheckAnswer | null): FoundingOutcome {
  if (!draft) return 'failed'
  if (draftRefused(draft)) return 'refused'
  if (!check) return 'failed'
  return check.a.fits === 'yes' && check.b.fits === 'yes' && check.endEventConcrete === 'yes' ? 'founded' : 'disagreed'
}

/** A founding attempt: the partner, both calls' answers, and on agreement the draft. */
export interface FoundingAttempt {
  partner: LinkStory
  outcome: FoundingOutcome
  draft: FoundingDraft | null
  answers: { draft: FoundAnswer | null; check: FoundCheckAnswer | null }
  /** The join answer for the partner: the shared cause, place and end, and the stated probability. */
  shared: Shared
  confidence: number
  costUsd: number
  model: string | null
}

/** One story's linking, for the writer (`applyLink`) or the sandbox to apply. */
export interface LinkResult {
  story: LinkStory
  /** joined, founded, none, rejected, held or failed; the writer turns a stale or refused write into `conflict`. */
  outcome: Exclude<LinkOutcome, 'conflict'>
  /** The story's role, from the link answer (a join, or alone) or the founding draft. */
  role: Role | null
  join: (Accepted<ShownOverview> & { reportsEndEvent: boolean }) | null
  founding: FoundingAttempt | null
  /** The candidates shown, by ref; the stale check reads the partners' memberships again. */
  shown: { overviews: { ref: string; id: string; distance: number }[]; partners: { ref: string; id: string; distance: number }[] }
  answer: LinkAnswer | null
  proposed: number
  refusals: Refusal[]
  /** The link call's model and the prompt's version; null with no call. */
  model: string | null
  promptVersion: string | null
  /** The link call's cost (a founding's is its own). */
  costUsd: number
  /** What a read threw, for a `failed` result with no call. */
  error?: unknown
}

/** A role as a model answered it: a routine entry has no kind. */
export const roleOf = (r: { role: Role['role']; roleKind: Role['roleKind'] }): Role => ({ role: r.role, roleKind: r.role === 'routine' ? null : r.roleKind })

const blank = (story: LinkStory, outcome: LinkResult['outcome']): LinkResult => ({
  story,
  outcome,
  role: null,
  join: null,
  founding: null,
  shown: { overviews: [], partners: [] },
  answer: null,
  proposed: 0,
  refusals: [],
  model: null,
  promptVersion: null,
  costUsd: 0,
})

async function found(story: LinkStory, partner: Accepted<ShownPartner>, deps: LinkDeps): Promise<FoundingAttempt> {
  const { ref: _ref, distance: _distance, ...partnerStory } = partner.candidate
  // The earlier story is A, so the timeline reads in date order
  const [a, b] = partnerStory.datePublished.getTime() <= story.datePublished.getTime() ? [partnerStory, story] : [story, partnerStory]
  const draftCall = await deps.found({ a, b })
  const draft = draftCall.parsed ? unescapeXmlDeep(draftCall.parsed) : null
  const checkCall = draft && !draftRefused(draft) ? await deps.foundCheck({ charter: draft.charter, a, b }) : null
  const check = checkCall?.parsed ? unescapeXmlDeep(checkCall.parsed) : null
  const outcome = acceptFounding(draft, check)
  const forStory = (roles: FoundAnswer['roles']) => ({ a: roleOf(roles.a), b: roleOf(roles.b) })
  return {
    partner: partnerStory,
    outcome,
    draft:
      outcome === 'founded' && draft
        ? {
            title: draft.title.trim(),
            charter: { in: draft.charter.in.trim(), out: draft.charter.out.map(o => o.trim()).filter(Boolean), endEvent: draft.charter.endEvent.trim() },
            roles: forStory(draft.roles),
          }
        : null,
    answers: { draft, check },
    shared: partner.shared,
    confidence: partner.answer.confidence,
    costUsd: draftCall.costUsd + (checkCall?.costUsd ?? 0),
    model: draftCall.model,
  }
}

/**
 * Links one story: its candidates from its neighbours as they stand now, the link call (none with no
 * candidate), the acceptance rules, and a founding when no overview passed and a partner did. A frozen
 * overview that passes first holds the story for the next run, so a story never settles elsewhere
 * while an editor's freeze stands.
 */
export async function linkStory(story: LinkStory, deps: LinkDeps): Promise<LinkResult> {
  const neighbours = await deps.neighbours(story)
  const memberships = await deps.memberships([story.id, ...neighbours.map(n => n.id)], story.datePublished)
  const grouped = groupCandidates(story, neighbours, memberships, deps.options)
  const overviewDetails = new Map(
    (
      await deps.overviews(
        grouped.overviews.map(o => o.overviewId),
        story.datePublished,
      )
    ).map(o => [o.id, o]),
  )
  const partnerDetails = new Map((await deps.stories(grouped.partners.map(p => p.id))).map(s => [s.id, s]))
  const overviews: ShownOverview[] = grouped.overviews
    .flatMap((o: RankedOverview) => {
      const details = overviewDetails.get(o.overviewId)
      return details ? [{ ...details, distance: o.distance, frozen: o.frozen }] : []
    })
    .map((o, i) => ({ ...o, ref: `O${i + 1}` }))
  const partners: ShownPartner[] = grouped.partners
    .flatMap(p => {
      const details = partnerDetails.get(p.id)
      return details ? [{ ...details, distance: p.distance }] : []
    })
    .map((p, i) => ({ ...p, ref: `F${i + 1}` }))
  const shown = {
    overviews: overviews.map(o => ({ ref: o.ref, id: o.id, distance: o.distance })),
    partners: partners.map(p => ({ ref: p.ref, id: p.id, distance: p.distance })),
  }
  if (overviews.length === 0 && partners.length === 0) return { ...blank(story, 'none'), shown }

  const call = await deps.link({ story, overviews, partners })
  const base = { ...blank(story, 'failed'), shown, model: call.model, promptVersion: OVERVIEW_PROMPT_VERSIONS.link, costUsd: call.costUsd }
  if (!call.parsed) return base
  const answer = unescapeXmlDeep(call.parsed)
  const accepted = acceptLink(story, overviews, partners, answer)
  const role = roleOf(answer)
  const settled = { ...base, answer, proposed: accepted.proposed, refusals: accepted.refusals, role }
  const alone = accepted.refusals.length > 0 ? 'rejected' : 'none'
  if (accepted.join) {
    if (accepted.join.candidate.frozen) return { ...settled, outcome: 'held' }
    return { ...settled, outcome: 'joined', join: { ...accepted.join, reportsEndEvent: accepted.join.answer.reportsEndEvent } }
  }
  if (!accepted.partner) return { ...settled, outcome: alone }
  const founding = await found(story, accepted.partner, deps)
  if (founding.outcome === 'failed') return { ...settled, outcome: 'failed', founding }
  if (founding.outcome !== 'founded' || !founding.draft) return { ...settled, outcome: alone, founding }
  const storyIsA = founding.partner.datePublished.getTime() > story.datePublished.getTime()
  return { ...settled, outcome: 'founded', founding, role: storyIsA ? founding.draft.roles.a : founding.draft.roles.b }
}

/**
 * Whether a result is stale against the memberships as they stand at its write: a founding partner it
 * was shown has joined or founded an overview since its candidates were read (two stories of one
 * night proposing the same partner). Asked again once, it sees that overview.
 */
export const isStale = (result: LinkResult, memberships: Memberships): boolean => result.shown.partners.some(p => memberships.active.has(p.id))

/** What writing a result did: written (with the outcome stored), stale (asked again), or skipped (the story was linked meanwhile, as a founding partner). */
export type ApplyOutcome = { kind: 'written'; outcome: LinkOutcome } | { kind: 'stale' } | { kind: 'skipped' }

/** The writer of one result: production's lifecycle, the sandbox's memory. `lastTry` turns a stale result into `conflict`. */
export type ApplyLink = (result: LinkResult, lastTry: boolean) => Promise<ApplyOutcome>

export interface OrderedRun {
  /** Each story's stored outcome (none for a story skipped as linked meanwhile). */
  outcomes: Map<string, LinkOutcome>
  /** Each story's final result, once: a stale answer asked again counts by its second answer only. */
  results: LinkResult[]
}

/**
 * Links the stories in the order given (oldest first): link calls `concurrency` at a time, writes one
 * story at a time in that order. A stale result is asked again after the others, once; stale again,
 * it is stored as a conflict and retried at the next run. `keepGoing` is asked before each write and
 * before any call starts after the first ones (the switch, a budget); once it says no, no call starts
 * and nothing more is written: the calls already in flight finish, their answers unwritten, and the
 * rest stay owed.
 */
export async function linkInOrder(
  stories: readonly LinkStory[],
  deps: LinkDeps,
  apply: ApplyLink,
  { concurrency, keepGoing = async () => true }: { concurrency: number; keepGoing?: () => Promise<boolean> },
): Promise<OrderedRun> {
  const outcomes = new Map<string, LinkOutcome>()
  const results: LinkResult[] = []
  const pending: Promise<LinkResult>[] = new Array(stories.length)
  let next = 0
  let written = 0
  let stopped = false
  const going = async (): Promise<boolean> => {
    if (!stopped && !(await keepGoing())) stopped = true
    return !stopped
  }
  const start = () => {
    while (next < stories.length && next - written < concurrency) {
      pending[next] = safeLinkStory(stories[next]!, deps)
      next++
    }
  }
  const again: LinkStory[] = []
  const write = async (result: LinkResult, lastTry: boolean): Promise<void> => {
    const done = await apply(result, lastTry)
    if (done.kind === 'stale') {
      again.push(result.story)
      return
    }
    results.push(result)
    if (done.kind === 'written') outcomes.set(result.story.id, done.outcome)
  }
  start()
  for (let i = 0; i < stories.length; i++) {
    const result = await pending[i]!
    written++
    if (!(await going())) break
    await write(result, false)
    if (!(await going())) break
    start()
  }
  for (const story of again) {
    if (!(await going())) break
    await write(await safeLinkStory(story, deps), true)
  }
  // Calls already in flight finish inside the run, so their cost is the run's
  await Promise.all(pending.slice(written, next))
  return { outcomes, results }
}

/** `linkStory`, with a read that threw (the database, an injected dep) stored as `failed`, so the story is retried at the next run and the others go on. */
const safeLinkStory = (story: LinkStory, deps: LinkDeps): Promise<LinkResult> =>
  linkStory(story, deps).catch((error: unknown) => ({ ...blank(story, 'failed'), error }))
