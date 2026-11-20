/**
 * What a writer may make of an overview's title and charter (`.context/overviews.md`, "Charter
 * limits"; ADR-0071's "who may widen what"), the one rule every writer passes its rights to: a review
 * only narrows (adds OUT entries); an automated re-center may also rewrite IN and END_EVENT, never
 * drop an OUT entry or name again one an editor's Undo locked out; a founding and an editor write the
 * whole charter, and an editor naming a locked-out entry again lifts its lock. Every writer is held to
 * the same limits (`config.overviews`, from shared/overviewCharterLimits.json). Also the rule a review's
 * and a re-center's judgments share: each ref's first judgment is the one that counts. Pure.
 */
import { config } from '../config.js'
import { normalizeQuote } from '../lib/quoteMatch.js'
import { NO_END_EVENT } from '../prompts/overviews.js'
import type { Charter } from './overviewTypes.js'

/** What a writer may do to a charter beyond adding OUT entries. */
export interface CharterRights {
  /** Who it is, in a refusal's words. */
  name: string
  /** Rewrite IN and END_EVENT. */
  rewrite: boolean
  /** Write the OUT list whole, dropping entries; otherwise the current one is kept and added to. */
  dropOut: boolean
  /** Name again an OUT entry an editor's Undo locked out, which lifts its lock. */
  readmitLockedOut: boolean
}

export const REVIEW_RIGHTS: CharterRights = { name: 'a review', rewrite: false, dropOut: false, readmitLockedOut: false }
export const RECENTER_RIGHTS: CharterRights = { name: 'an automated re-center', rewrite: true, dropOut: false, readmitLockedOut: false }
export const FOUNDING_RIGHTS: CharterRights = { name: 'a founding', rewrite: true, dropOut: true, readmitLockedOut: true }
export const EDITOR_RIGHTS: CharterRights = { name: 'an editor', rewrite: true, dropOut: true, readmitLockedOut: true }

export type CharterLimits = Pick<typeof config.overviews, 'maxTitleChars' | 'maxInChars' | 'maxOutEntries' | 'maxOutChars' | 'maxEndEventChars'>

export type CharterField = 'title' | 'in' | 'end_event' | 'out'

export interface CharterRefusal {
  field: CharterField
  reason: string
}

/** What an overview holds that a charter amendment is made on; a founding's is `NO_CHARTER`. */
export interface CharterHolder {
  title: string
  charter: Charter
  lockedOut: readonly string[]
}

export const NO_CHARTER: CharterHolder = { title: '', charter: { in: '', out: [], endEvent: null }, lockedOut: [] }

export interface CharterAmendment {
  /** The title proposed, or the current one when none or a refused one was. */
  title: string
  /**
   * The charter code builds: IN and END_EVENT as proposed where the writer may rewrite them and they
   * are within the limits (else the current ones); the OUT list whole as proposed for a writer that
   * may drop entries, else the current one with the accepted additions after it.
   */
  charter: Charter
  /** The OUT entries it adds that the current charter lacks. */
  outAdded: string[]
  /** The locked-out OUT entries left: those it names again leave the list where the writer may re-admit them. */
  lockedOut: string[]
  /** Everything code refused, in order; a writer applies nothing refused. */
  refusals: CharterRefusal[]
}

/** Two texts the same in other spacing or case. */
export const sameText = (a: string, b: string) => normalizeQuote(a).toLowerCase() === normalizeQuote(b).toLowerCase()

/** An END_EVENT as a model answered it: empty, `none` or the prompt's none is no end event. */
export const answeredEndEvent = (text: string): string | null => {
  const t = text.trim()
  return !t || sameText(t, 'none') || sameText(t, NO_END_EVENT) ? null : t
}

const sameEndEvent = (a: string | null, b: string | null) => (a === null || b === null ? a === b : sameText(a, b))

/**
 * A proposed title and charter held to what the writer may do (`rights`) and to the limits; blank
 * texts are the caller's to refuse (a review's blank title keeps the current one). The proposal's
 * END_EVENT is null for none (`answeredEndEvent` reads a model's).
 */
export function amendCharter(
  current: CharterHolder,
  proposed: { title: string; charter: { in: string; out: readonly string[]; endEvent: string | null } },
  rights: CharterRights,
  limits: CharterLimits = config.overviews,
): CharterAmendment {
  const refusals: CharterRefusal[] = []
  const refuse = (field: CharterField, reason: string) => refusals.push({ field, reason })

  let title = current.title
  const proposedTitle = proposed.title.trim()
  if (proposedTitle.length > limits.maxTitleChars) refuse('title', `a title longer than ${limits.maxTitleChars} characters`)
  else if (proposedTitle) title = proposedTitle

  let within = current.charter.in
  let endEvent = current.charter.endEvent
  const proposedIn = proposed.charter.in.trim()
  const proposedEnd = proposed.charter.endEvent?.trim() || null
  if (rights.rewrite) {
    if (proposedIn.length > limits.maxInChars) refuse('in', `an IN longer than ${limits.maxInChars} characters`)
    else if (proposedIn) within = proposedIn
    if (proposedEnd !== null && proposedEnd.length > limits.maxEndEventChars)
      refuse('end_event', `an END_EVENT longer than ${limits.maxEndEventChars} characters`)
    else endEvent = proposedEnd
  } else {
    if (!sameText(proposedIn, current.charter.in)) refuse('in', `rewrites IN: ${rights.name} only adds to OUT`)
    if (!sameEndEvent(proposedEnd, current.charter.endEvent)) refuse('end_event', `rewrites END_EVENT: ${rights.name} only adds to OUT`)
  }

  const proposedOut = proposed.charter.out.map(o => o.trim()).filter(Boolean)
  const locked = (p: string) => current.lockedOut.some(o => sameText(o, p))
  const known = (list: readonly string[], p: string) => list.some(o => sameText(o, p))
  let out: string[]
  const outAdded: string[] = []
  if (rights.dropOut) {
    out = proposedOut
    const tooLong = out.filter(p => p.length > limits.maxOutChars)
    if (tooLong.length > 0) refuse('out', `an OUT entry longer than ${limits.maxOutChars} characters`)
    if (out.length > limits.maxOutEntries) refuse('out', `more than ${limits.maxOutEntries} OUT entries`)
    if (!rights.readmitLockedOut) for (const p of out.filter(locked)) refuse('out', `names an OUT entry an editor took out: ${p}`)
    outAdded.push(...out.filter(p => !known(current.charter.out, p)))
  } else {
    const dropped = current.charter.out.filter(o => !known(proposedOut, o))
    if (dropped.length > 0) refuse('out', `drops OUT entries, which widens it and only an editor may: ${dropped.join('; ')}`)
    for (const p of proposedOut) {
      if (known([...current.charter.out, ...outAdded], p)) continue
      if (locked(p)) refuse('out', `adds an OUT entry an editor took out: ${p}`)
      else if (p.length > limits.maxOutChars) refuse('out', `adds an OUT entry longer than ${limits.maxOutChars} characters`)
      else if (current.charter.out.length + outAdded.length >= limits.maxOutEntries)
        refuse('out', `adds an OUT entry past ${limits.maxOutEntries} in all: ${p}`)
      else outAdded.push(p)
    }
    out = [...current.charter.out, ...outAdded]
  }
  const lockedOut = rights.readmitLockedOut ? current.lockedOut.filter(x => !known(out, x)) : [...current.lockedOut]
  return { title, charter: { in: within, out, endEvent }, outAdded, lockedOut, refusals }
}

/** Each ref's first judgment, the one that counts, by its trimmed ref; and the refs judged again after it, in order. */
export function firstJudgments<T extends { id: string }>(answers: readonly T[]): { first: Map<string, T>; repeated: string[] } {
  const first = new Map<string, T>()
  const repeated: string[] = []
  for (const a of answers) {
    const id = a.id.trim()
    if (first.has(id)) repeated.push(id)
    else first.set(id, a)
  }
  return { first, repeated }
}
