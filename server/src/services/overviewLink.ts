/**
 * One story's linking over injected I/O (`.context/overviews.md`, "How a story is linked"), the same
 * in production (`jobs/linkOverviews.ts`) and in the eval's sandbox: its candidates (`groupCandidates`), the
 * link confirmation, the acceptance rules (`acceptLink`: cosine proposes, a model confirms, code
 * checks the quotes), and a founding (two large calls that must agree, `acceptFounding`). Then the
 * ordered run (`linkInOrder`): calls in flight at once, writes one story at a time in date order, a
 * stale answer asked again at once. Pure: nothing here reads or writes the database.
 */
import { config } from '../config.js'
import { quoteFound, quoteNearlyFound } from '../lib/quoteMatch.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { OVERVIEW_PROMPT_VERSIONS, type FoundCheckInput, type FoundInput, type LinkInput } from '../prompts/overviews.js'
import type { FoundAnswer, FoundCheckAnswer, LinkAnswer, LinkCandidateAnswer } from '../schemas/overviews.js'
import { groupCandidates, type CandidateOptions, type Neighbour, type RankedOverview } from './overviewCandidates.js'
import { amendCharter, FOUNDING_RIGHTS, NO_CHARTER, type CharterLimits } from './overviewCharterRules.js'
import { mayWaitForRecenter } from './overviewOwed.js'
import {
  endEventOf,
  type CandidateOverview,
  type Charter,
  type FoundingOutcome,
  type LinkOutcome,
  type LinkStory,
  type Memberships,
  type Role,
  type Shared,
} from './overviewTypes.js'

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
  /**
   * The run's clock (production's run `now`, the sandbox's clock in the eval): a story past
   * `recenterLookbackDays` of it never waits for a re-center (`mayWaitForRecenter`, ADR-0078), as its wait
   * would already be over.
   */
  now(): Date
  options?: CandidateOptions
}

/** A candidate as the prompt names it: the overview or the founding partner, under its ref. */
export interface ShownOverview extends CandidateOverview {
  ref: string
  distance: number
  frozen: boolean
  /** A story that points past it waits for its re-center (`holdsForRecenter`: established, and automation may still re-center it; ADR-0078). */
  mayHold: boolean
}
export interface ShownPartner extends LinkStory {
  ref: string
  distance: number
}

/**
 * A join or a founding partner code accepted: the candidate and the model's answer for it, the shared
 * fields as stored (an end whose quote was not found is cleared, `endDropped`), and whether a cause or
 * place quote passed only by the near match (`quoteNearlyFound`), which the eval's diagnostics count.
 */
export interface Accepted<C> {
  candidate: C
  answer: LinkCandidateAnswer
  shared: Shared
  endDropped: boolean
  nearMatch: boolean
}

/** Why code refused a candidate the model said yes to. */
export interface Refusal {
  id: string
  reason: string
}

/**
 * A re-center signal (`.context/overviews.md`, "Re-centering"): the link call judged the story `wider`
 * than an overview's charter (the same broader development, outside its IN), or reporting that the
 * development's center itself moved, quoting the story's words that show it.
 */
export interface Signal {
  overviewId: string
  kind: 'wider' | 'center_moved'
  quote: string
}

export interface Acceptance {
  /** The nearest overview that passed; null when none did. */
  join: Accepted<ShownOverview> | null
  /** The nearest passing founding partner, considered only when no overview passed, no yes to an overview was refused and the story waits for no re-center. */
  partner: Accepted<ShownPartner> | null
  /** Every passing founding partner, nearest first, under the same conditions: a founding the partner's lack of an occurrence refused tries the next (`linkStory`). */
  partners: Accepted<ShownPartner>[]
  /**
   * The overview whose re-center the story waits for (ADR-0078), when no overview passed: the nearest
   * shown that may hold it (`mayHold`: established, with at least `recenterHoldMinEntries` active
   * entries, and automation may still re-center it), that has not held the story before, and for which
   * a re-center signal of the story was kept (`signals`); null otherwise. It considers no founding partner.
   */
  heldFor: string | null
  /** The nearest overview the model said yes to and code refused, when it kept a passing founding partner from founding (a confident claim that the story belongs to an open overview); null otherwise. */
  blockedBy: string | null
  /** Candidates the model said yes to (joins proposed). */
  proposed: number
  refusals: Refusal[]
  /** The re-center flags whose quote code found in the story, per overview shown; which of them count is the link record's (`countedSignals`). */
  signals: Signal[]
}

/** The shared fields a yes needs filled on both sides, for every candidate: the cause and the place decide. */
const REQUIRED_SIDES = ['cause', 'place'] as const

const sharedOf = (a: LinkCandidateAnswer): Shared => ({
  cause: { story: a.cause.story, other: a.cause.other },
  place: { story: a.place.story, other: a.place.other },
  end: { story: a.end.story, other: a.end.other },
})

/** The texts a story's quotes are found in: its title, label and summary. */
export const storyTexts = (s: LinkStory) => [s.title, s.label, s.summary]
/** An overview's side of a quote: its title, its charter's IN and its END_EVENT when it names one. Never its OUT list, which names what does not belong. */
const overviewTexts = (o: CandidateOverview) => [o.title, o.charter.in, ...(o.charter.endEvent === null ? [] : [o.charter.endEvent])]

/** How a quote given is found on its side: exactly, only by the near match (`quoteNearlyFound`), or not at all. */
const howFound = (quote: string, texts: readonly string[]): 'exact' | 'near' | 'no' =>
  quoteFound(quote, texts) ? 'exact' : quoteNearlyFound(quote, texts) ? 'near' : 'no'

/** What code makes of a yes: why it is refused, or that it passes, with its end dropped or not and whether a quote passed only nearly. */
type Judged = { refused: string } | { endDropped: boolean; nearMatch: boolean }

/**
 * Whether a yes passes: refused for the cause or the place left empty on a side or a quote of theirs
 * not found on its side; it passes otherwise, its end dropped when an end quote given is not found
 * (the end never decides, and an end that is not real must not mark the end event).
 */
function judgeYes(answer: LinkCandidateAnswer, story: readonly string[], other: readonly string[]): Judged {
  let nearMatch = false
  for (const side of REQUIRED_SIDES) {
    const pair = answer[side]
    if (!pair.story.trim() || !pair.other.trim()) return { refused: `no ${side} on both sides` }
    const [s, o] = [howFound(pair.story, story), howFound(pair.other, other)]
    if (s === 'no') return { refused: `${side}: the story's quote is not in its text` }
    if (o === 'no') return { refused: `${side}: the candidate's quote is not in its text` }
    nearMatch ||= s === 'near' || o === 'near'
  }
  const { end } = answer
  const endDropped = (end.story.trim() !== '' && !quoteNearlyFound(end.story, story)) || (end.other.trim() !== '' && !quoteNearlyFound(end.other, other))
  return { endDropped, nearMatch }
}

/**
 * Which candidate the story joins or may found with (`.context/overviews.md`, "How a story is linked",
 * step 3), by one rule for every candidate, overview or founding partner: a yes passes only with the
 * cause and the place filled on both sides and each quote found in its side's text (the story's title,
 * label or summary; the overview's title, IN or END_EVENT; the partner's title, label or summary),
 * exactly or by the near match (small misspellings in long words, `quoteNearlyFound`). The end may be
 * left empty, on either side; an end quote not found drops the end (cleared from the shared fields, and
 * its end-event flag not counted) rather than refusing the yes. `unsure` is no. The nearest passing
 * overview wins (a story joins one at most); a founding partner is considered only when no overview
 * passed and the model said yes to no overview that code refused (`blockedBy`: a confident claim that
 * the story belongs to an open overview is evidence against founding a second one), the nearest
 * passing first. Also the re-center flags for each overview shown, `wider` and `centerMoved`, each
 * kept only with its quote found in the story's text. A story with no passing overview and a flag kept
 * for an overview that may hold it (`mayHold`: an established one, at least `recenterHoldMinEntries`
 * active entries, that automation may still re-center) waits for that overview's re-center (`heldFor`,
 * the owner's rule of 2026-11-23, ADR-0078: a story that points past an established open overview makes
 * it widen instead of founding a second one; against a younger one it may found) and considers no
 * founding partner; an overview in `hold.before`
 * held it once already, so it holds it no more, and a story that may no longer wait at all
 * (`hold.mayWait` false: past `recenterLookbackDays` of the run's clock, `mayWaitForRecenter`) is held by none.
 */
export function acceptLink(
  story: LinkStory,
  overviews: readonly ShownOverview[],
  partners: readonly ShownPartner[],
  answer: LinkAnswer,
  hold: { before?: ReadonlySet<string>; mayWait?: boolean } = {},
): Acceptance {
  const heldBefore = hold.before ?? new Set<string>()
  const byRef = new Map(answer.candidates.map(c => [c.id.trim(), c]))
  const refusals: Refusal[] = []
  let proposed = 0
  /** The candidates that pass, in the order shown (nearest first), and those whose yes code refused. */
  const pick = <C extends { ref: string; id: string }>(candidates: readonly C[], texts: (c: C) => string[]): { passed: Accepted<C>[]; refused: C[] } => {
    const passed: Accepted<C>[] = []
    const refused: C[] = []
    for (const candidate of candidates) {
      const a = byRef.get(candidate.ref)
      if (a?.belongs !== 'yes') continue
      proposed++
      const judged = judgeYes(a, storyTexts(story), texts(candidate))
      if ('refused' in judged) {
        refusals.push({ id: candidate.ref, reason: judged.refused })
        refused.push(candidate)
        continue
      }
      const shared = sharedOf(a)
      passed.push({ candidate, answer: a, shared: judged.endDropped ? { ...shared, end: { story: '', other: '' } } : shared, ...judged })
    }
    return { passed, refused }
  }
  const overviewPick = pick(overviews, overviewTexts)
  const partnerPick = pick(partners, storyTexts)
  const join = overviewPick.passed[0] ?? null
  const refusedOverview = join ? null : (overviewPick.refused[0]?.id ?? null)
  const signals = signalsOf(story, overviews, byRef)
  const heldFor =
    join || hold.mayWait === false ? null : (overviews.find(o => o.mayHold && !heldBefore.has(o.id) && signals.some(s => s.overviewId === o.id))?.id ?? null)
  const passing = join || refusedOverview || heldFor ? [] : partnerPick.passed
  return {
    join,
    partner: passing[0] ?? null,
    partners: passing,
    heldFor,
    blockedBy: refusedOverview && partnerPick.passed.length > 0 ? refusedOverview : null,
    proposed,
    refusals,
    signals,
  }
}

/** The re-center flags of each overview shown whose quote is found in the story's title, label or summary. */
function signalsOf(story: LinkStory, overviews: readonly ShownOverview[], byRef: ReadonlyMap<string, LinkCandidateAnswer>): Signal[] {
  return overviews.flatMap(o => {
    const a = byRef.get(o.ref)
    const quote = a?.signalQuote.trim() ?? ''
    if (!a || !quote || !quoteNearlyFound(quote, storyTexts(story))) return []
    const kinds: Signal['kind'][] = [...(a.scope === 'wider' ? ['wider' as const] : []), ...(a.centerMoved ? ['center_moved' as const] : [])]
    return kinds.map(kind => ({ overviewId: o.id, kind, quote }))
  })
}

/** A founding's charter, title and roles, on agreement. */
export interface FoundingDraft {
  title: string
  charter: Charter
  /** Roles of the earlier story (`a`) and the later (`b`). */
  roles: { a: Role; b: Role }
}

/** A founding draft's title and charter as stored, and as the check reads them: trimmed, an empty END_EVENT none. */
export const foundingCharter = (draft: FoundAnswer): { title: string; charter: Charter } => ({
  title: draft.title.trim(),
  charter: { in: draft.charter.in.trim(), out: draft.charter.out.map(o => o.trim()).filter(Boolean), endEvent: endEventOf(draft.charter.endEvent) },
})

/**
 * A draft with no title or no IN, or past the limits on a charter (`amendCharter`, `FOUNDING_RIGHTS`: a
 * title, IN, END_EVENT or OUT entry too long, or too many OUT entries), founds nothing, and the check
 * is not asked. An end event is not required: most developments have none and close by fading.
 */
export const draftRefused = (draft: FoundAnswer, options: CharterLimits = config.overviews): boolean => {
  const { title, charter } = foundingCharter(draft)
  return !title || !charter.in || amendCharter(NO_CHARTER, { title, charter }, FOUNDING_RIGHTS, options).refusals.length > 0
}

/**
 * Whether the two founding calls agree (`.context/overviews.md`, "How a story is linked", step 4):
 * `refused` for a draft `draftRefused` refuses; `founded` only when the check finds both stories fit,
 * both report an occurrence (the owner's rule of 2026-11-23: a development is founded only from stories
 * reporting something that happened, never from a warning, a forecast or a reaction, ADR-0075) and,
 * when the draft names an end event, finds it concrete; `disagreed` otherwise; `failed` for a call that
 * gave no answer.
 */
export function acceptFounding(draft: FoundAnswer | null, check: FoundCheckAnswer | null): FoundingOutcome {
  if (!draft) return 'failed'
  if (draftRefused(draft)) return 'refused'
  if (!check) return 'failed'
  const endEventHolds = endEventOf(draft.charter.endEvent) === null || check.endEventConcrete === 'yes'
  const both = (side: FoundCheckAnswer['a']) => side.fits === 'yes' && side.occurred === 'yes'
  return both(check.a) && both(check.b) && endEventHolds ? 'founded' : 'disagreed'
}

/**
 * Whether a founding was refused only because the partner reported no occurrence: both stories fit, the
 * story itself occurred and a named end event is concrete. Then the next passing partner is tried
 * (`linkStory`); any other refusal ends the founding.
 */
export function onlyPartnerSilent(attempt: FoundingAttempt, story: Pick<LinkStory, 'datePublished'>): boolean {
  const { draft, check } = attempt.answers
  if (attempt.outcome !== 'disagreed' || !draft || !check) return false
  // The earlier story is A; on a tie, the partner
  const partnerIsA = attempt.partner.datePublished.getTime() <= story.datePublished.getTime()
  const [partner, own] = partnerIsA ? [check.a, check.b] : [check.b, check.a]
  const endEventHolds = endEventOf(draft.charter.endEvent) === null || check.endEventConcrete === 'yes'
  return partner.fits === 'yes' && own.fits === 'yes' && own.occurred === 'yes' && partner.occurred === 'no' && endEventHolds
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
  /** joined, founded, none, rejected, held, waiting or failed; the writer turns a stale or refused write into `conflict`. */
  outcome: Exclude<LinkOutcome, 'conflict'>
  /**
   * The story's role, from the link answer (a join, or alone) or the founding draft; for a join that
   * reports the end event (`join.reportsEndEvent`) a routine answer becomes a turning point, a milestone.
   */
  role: Role | null
  /**
   * The overview joined; `reportsEndEvent` settled here: the answer's flag, counted only when the
   * charter the call was shown names an end event.
   */
  join: (Accepted<ShownOverview> & { reportsEndEvent: boolean }) | null
  /** For a `held` story, the frozen overview that passed first: its decision names it, so the story waits on that freeze. */
  heldBy: string | null
  /** For a `waiting` story, the overview whose re-center it waits for (`acceptLink`'s `heldFor`, ADR-0078): its decision names it. */
  heldForRecenter: string | null
  /** The overviews that held the story for their re-center before (`Memberships.heldBefore`): none holds it again, and its link record keeps no signal for them. */
  heldBefore: string[]
  /** Unlinked neighbours left out as founding partners because they wait for an overview's re-center (`groupCandidates`). */
  heldPartners: string[]
  founding: FoundingAttempt | null
  /** Earlier founding attempts refused only because their partner reported no occurrence, in the order tried; the writer stores each as its own `found` decision. */
  refusedFoundings: FoundingAttempt[]
  /** Unlinked neighbours left out as founding partners because a founding check judged them to report no occurrence (`groupCandidates`). */
  excludedPartners: string[]
  /** The overview whose refused yes kept a passing founding partner from founding (`acceptLink`'s `blockedBy`), when one did. */
  foundingBlockedBy: string | null
  /** The candidates shown, by ref; the stale check reads the partners' memberships again. */
  shown: { overviews: { ref: string; id: string; distance: number }[]; partners: { ref: string; id: string; distance: number }[] }
  answer: LinkAnswer | null
  proposed: number
  refusals: Refusal[]
  /** The re-center flags code found quoted (`acceptLink`); the link record keeps those that count (`countedSignals`). */
  signals: Signal[]
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

/** A joined story's role once code reads its end-event flag: a routine story that reports the end event is a turning point, a milestone; a turning point keeps its kind. */
const endEventRole = (role: Role, reports: boolean): Role => (reports && role.role === 'routine' ? { role: 'turning_point', roleKind: 'milestone' } : role)

const blank = (story: LinkStory, outcome: LinkResult['outcome']): LinkResult => ({
  story,
  outcome,
  role: null,
  join: null,
  heldBy: null,
  heldForRecenter: null,
  heldBefore: [],
  heldPartners: [],
  founding: null,
  refusedFoundings: [],
  excludedPartners: [],
  foundingBlockedBy: null,
  shown: { overviews: [], partners: [] },
  answer: null,
  proposed: 0,
  refusals: [],
  signals: [],
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
  const charter: Charter | null = draft ? foundingCharter(draft).charter : null
  const checkCall = draft && charter && !draftRefused(draft) ? await deps.foundCheck({ charter, a, b }) : null
  const check = checkCall?.parsed ? unescapeXmlDeep(checkCall.parsed) : null
  const outcome = acceptFounding(draft, check)
  const forStory = (roles: FoundAnswer['roles']) => ({ a: roleOf(roles.a), b: roleOf(roles.b) })
  return {
    partner: partnerStory,
    outcome,
    draft: outcome === 'founded' && draft && charter ? { title: foundingCharter(draft).title, charter, roles: forStory(draft.roles) } : null,
    answers: { draft, check },
    shared: partner.shared,
    confidence: partner.answer.confidence,
    costUsd: draftCall.costUsd + (checkCall?.costUsd ?? 0),
    model: draftCall.model,
  }
}

/**
 * Links one story: its candidates from its neighbours as they stand now, the link call (none with no
 * candidate), the acceptance rules, and a founding when no overview passed and a partner did; a
 * founding refused only because the partner reported no occurrence tries the next passing partner,
 * nearest first, at most `foundingCandidates` attempts in all, the refused ones kept
 * (`refusedFoundings`) so each is stored and its partner no longer takes a partner's slot. A frozen
 * overview that passes first holds the story for the next run, so a story never settles elsewhere
 * while an editor's freeze stands; a story with no passing overview that points past an established one
 * automation may still re-center (`mayHold`) waits for that re-center (`waiting`, ADR-0078) and founds nothing, unless it is past
 * `recenterLookbackDays` of the run's clock (`deps.now`), where no re-center would take it in. A joined story that reports the end event of an overview whose
 * charter names one becomes a turning point (`endEventRole`); the flag follows the charter the call
 * was shown, so an editor's re-center between the call and the write that changes the END_EVENT
 * leaves the turning point the old one marked (accepted: an editor sets the role in one click).
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
      return details ? [{ ...details, distance: o.distance, frozen: o.frozen, mayHold: o.mayHold }] : []
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
  const { excludedPartners, heldPartners } = grouped
  const heldBefore = [...(memberships.heldBefore?.get(story.id) ?? [])]
  const read = { shown, excludedPartners, heldPartners, heldBefore }
  if (overviews.length === 0 && partners.length === 0) return { ...blank(story, 'none'), ...read }

  const call = await deps.link({ story, overviews, partners })
  const base = { ...blank(story, 'failed'), ...read, model: call.model, promptVersion: OVERVIEW_PROMPT_VERSIONS.link, costUsd: call.costUsd }
  if (!call.parsed) return base
  const answer = unescapeXmlDeep(call.parsed)
  const accepted = acceptLink(story, overviews, partners, answer, {
    before: new Set(heldBefore),
    mayWait: mayWaitForRecenter(story.datePublished, deps.now()),
  })
  const role = roleOf(answer)
  const settled = { ...base, answer, proposed: accepted.proposed, refusals: accepted.refusals, signals: accepted.signals, role }
  const alone = accepted.refusals.length > 0 ? 'rejected' : 'none'
  if (accepted.join) {
    if (accepted.join.candidate.frozen) return { ...settled, outcome: 'held', heldBy: accepted.join.candidate.id }
    // The flag counts only for a charter that names an end event, the charter the call was shown, and only with the end the model quoted found
    const reportsEndEvent = accepted.join.answer.reportsEndEvent && !accepted.join.endDropped && accepted.join.candidate.charter.endEvent !== null
    return { ...settled, outcome: 'joined', role: endEventRole(role, reportsEndEvent), join: { ...accepted.join, reportsEndEvent } }
  }
  // It points past an open overview: it waits for that overview's re-center and founds nothing (ADR-0078)
  if (accepted.heldFor) return { ...settled, outcome: 'waiting', heldForRecenter: accepted.heldFor, foundingBlockedBy: accepted.blockedBy }
  if (accepted.partners.length === 0) return { ...settled, outcome: alone, foundingBlockedBy: accepted.blockedBy }
  // A founding refused only for the partner's lack of an occurrence tries the next passing partner, nearest first, at most foundingCandidates attempts
  const limit = (deps.options ?? config.overviews).foundingCandidates
  const refusedFoundings: FoundingAttempt[] = []
  let founding = await found(story, accepted.partners[0]!, deps)
  for (const next of accepted.partners.slice(1, limit)) {
    if (!onlyPartnerSilent(founding, story)) break
    refusedFoundings.push(founding)
    founding = await found(story, next, deps)
  }
  const tried = { ...settled, refusedFoundings }
  if (founding.outcome === 'failed') return { ...tried, outcome: 'failed', founding }
  if (founding.outcome !== 'founded' || !founding.draft) return { ...tried, outcome: alone, founding }
  const storyIsA = founding.partner.datePublished.getTime() > story.datePublished.getTime()
  return { ...tried, outcome: 'founded', founding, role: storyIsA ? founding.draft.roles.a : founding.draft.roles.b }
}

/**
 * Whether a result is stale against the memberships as they stand at its write: a founding partner it
 * was shown has joined or founded an overview since its candidates were read (two stories of one
 * night proposing the same partner), or, for a founding, a partner it was shown waits for a re-center
 * by now (its wait written after the candidates were read: a waiting story is no founding partner,
 * ADR-0078). Asked again once, it sees that overview, or no longer that partner.
 */
export const isStale = (result: LinkResult, memberships: Memberships): boolean =>
  result.shown.partners.some(p => memberships.active.has(p.id) || (result.outcome === 'founded' && (memberships.heldForRecenter?.has(p.id) ?? false)))

/**
 * What writing a result did: written (with the outcome stored), stale (asked again), skipped (the story
 * was linked meanwhile, as a founding partner), or unwritten (the write threw and was rolled back:
 * nothing is stored, so the story is owed as it was before the run).
 */
export type ApplyOutcome = { kind: 'written'; outcome: LinkOutcome } | { kind: 'stale' } | { kind: 'skipped' } | { kind: 'unwritten' }

/** The writer of one result: production's lifecycle, the sandbox's memory. `lastTry` turns a stale result into `conflict`. */
export type ApplyLink = (result: LinkResult, lastTry: boolean) => Promise<ApplyOutcome>

export interface OrderedRun {
  /** Each story's stored outcome (none for a story skipped as linked meanwhile, or whose write stored nothing). */
  outcomes: Map<string, LinkOutcome>
  /** The stories whose write threw and stored nothing, in the order written. */
  unwritten: string[]
  /** Each story's final result, once: a stale answer asked again counts by its second answer only. */
  results: LinkResult[]
}

/**
 * Whether a partner's own result, written after a founding with it, would keep it from being a founding
 * partner (ADR-0079): it joins an open overview (the founding would make a second one of that
 * development), it is held by one (its passing join is to a frozen overview, still open: taken first as
 * a partner, its held decision would never be written), or it waits for an established overview's
 * re-center (a waiting story is no founding partner, ADR-0078).
 */
export const takesPartnerAway = (result: Pick<LinkResult, 'outcome'>): boolean =>
  result.outcome === 'joined' || result.outcome === 'held' || result.outcome === 'waiting'

/**
 * Links the stories in the order given (oldest first): link calls `concurrency` at a time, writes one
 * story at a time in that order. A stale result is asked again at once, before the next story is
 * written (so it sees the overview its partner joined while the development's later stories still
 * wait); stale again, it is stored as a conflict and retried at the next run. **A founding whose
 * partner comes later in the order** (a story of the same day, unwritten) is stale too when the
 * partner's own result is still pending or is in and takes the partner away (`takesPartnerAway`, the
 * owner's of 2026-11-23, ADR-0079): it is held back until the partner is written and then asked again
 * at once, as its last try, so it sees the overview the partner joined or no longer sees the partner.
 * Once per story: the second answer is written as it comes (stale, a conflict), so nothing loops.
 * `keepGoing` is asked before each write and before any call starts after the first ones (the switch, a
 * budget); once it says no, no call starts and nothing more is written: the calls already in flight
 * finish, their answers unwritten, and the rest stay owed (a founding held back for its partner too).
 */
export async function linkInOrder(
  stories: readonly LinkStory[],
  deps: LinkDeps,
  apply: ApplyLink,
  { concurrency, keepGoing = async () => true }: { concurrency: number; keepGoing?: () => Promise<boolean> },
): Promise<OrderedRun> {
  const outcomes = new Map<string, LinkOutcome>()
  const unwritten: string[] = []
  const results: LinkResult[] = []
  const pending: Promise<LinkResult>[] = new Array(stories.length)
  /** Each story's result once its call is in, by its place in the order. */
  const arrived: (LinkResult | undefined)[] = new Array(stories.length)
  const placeOf = new Map(stories.map((s, i) => [s.id, i]))
  /** The foundings held back until their partner, at that place in the order, is written. */
  const heldBack = new Map<number, LinkResult[]>()
  let next = 0
  let written = 0
  let stopped = false
  const going = async (): Promise<boolean> => {
    if (!stopped && !(await keepGoing())) stopped = true
    return !stopped
  }
  const start = () => {
    while (next < stories.length && next - written < concurrency) {
      const at = next
      pending[at] = safeLinkStory(stories[at]!, deps).then(r => {
        arrived[at] = r
        return r
      })
      next++
    }
  }
  /** The place of a founding's partner later in the order whose own result is still pending or takes it away (ADR-0079); null otherwise. */
  const partnerAhead = (result: LinkResult, i: number): number | null => {
    const j = result.outcome === 'founded' && result.founding ? placeOf.get(result.founding.partner.id) : undefined
    if (j === undefined || j <= i) return null
    const theirs = arrived[j]
    return theirs === undefined || takesPartnerAway(theirs) ? j : null
  }
  const record = (result: LinkResult, done: ApplyOutcome) => {
    results.push(result)
    if (done.kind === 'written') outcomes.set(result.story.id, done.outcome)
    if (done.kind === 'unwritten') unwritten.push(result.story.id)
  }
  /** Asks a stale story again at once, with fresh candidates, and writes the answer as its last try. */
  const askAgain = async (story: LinkStory): Promise<void> => {
    if (!(await going())) return
    const result = await safeLinkStory(story, deps)
    record(result, await apply(result, true))
  }
  /** Writes the result at place `i`; a stale one is asked again at once, a founding whose partner is ahead once that partner is written. */
  const write = async (result: LinkResult, i: number): Promise<void> => {
    const j = partnerAhead(result, i)
    if (j !== null) {
      heldBack.set(j, [...(heldBack.get(j) ?? []), result])
      return
    }
    const done = await apply(result, false)
    if (done.kind === 'stale') await askAgain(result.story)
    else record(result, done)
  }
  start()
  for (let i = 0; i < stories.length; i++) {
    const result = await pending[i]!
    written++
    if (!(await going())) break
    await write(result, i)
    for (const back of heldBack.get(i) ?? []) await askAgain(back.story)
    heldBack.delete(i)
    if (!(await going())) break
    start()
  }
  // Calls already in flight finish inside the run, so their cost is the run's
  await Promise.all(pending.slice(written, next))
  return { outcomes, unwritten, results }
}

/** `linkStory`, with a read that threw (the database, an injected dep) stored as `failed`, so the story is retried at the next run and the others go on. */
const safeLinkStory = (story: LinkStory, deps: LinkDeps): Promise<LinkResult> =>
  linkStory(story, deps).catch((error: unknown) => ({ ...blank(story, 'failed'), error }))
