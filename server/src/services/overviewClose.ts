/**
 * Closing at the end event (`.context/overviews.md`, "Status, closing and reviews"), over injected
 * calls, the same in production and in the eval's sandbox: when a story joined with the link call's
 * flag that it reports its overview's end event, two large calls must agree that the event has
 * happened, `overview-close` with the charter and the newest entries, then `overview-close-check`
 * with the end event against the story alone. The first call's quote must be the story's own words.
 * On agreement the overview starts closing; the status machine (`overviewStatus.ts`) does the rest.
 * Pure.
 */
import { quoteFound } from '../lib/quoteMatch.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { OVERVIEW_PROMPT_VERSIONS, type CloseCheckInput, type CloseInput } from '../prompts/overviews.js'
import type { CloseAnswer, CloseCheckAnswer } from '../schemas/overviews.js'
import type { ModelCall } from './overviewLink.js'
import type { Charter, LinkStory } from './overviewTypes.js'

export interface CloseDeps {
  close(input: CloseInput): Promise<ModelCall<CloseAnswer>>
  closeCheck(input: CloseCheckInput): Promise<ModelCall<CloseCheckAnswer>>
}

/** A story the link flagged as reporting its overview's end event, with what the calls are shown. */
export interface CloseCase {
  overviewId: string
  charter: Charter
  story: LinkStory
  /** The overview's other newest active entries, newest first: titles and days. */
  entries: { title: string; date: string }[]
}

/**
 * `closing` on agreement; `not_happened` when the first call says no (the check is not asked);
 * `unquoted` when its quote is not the story's words; `disagreed` when the check says no; `failed`
 * when a call gave nothing, which the next run asks again. Every other outcome settles the story.
 */
export const CLOSE_OUTCOMES = ['closing', 'not_happened', 'unquoted', 'disagreed', 'failed'] as const
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number]

export interface CloseResult {
  outcome: CloseOutcome
  answers: { close: CloseAnswer | null; check: CloseCheckAnswer | null }
  costUsd: number
  /** The first call's model; null when it was not made. */
  model: string | null
  promptVersion: string
}

/** The two answers judged: the first must say yes and quote the story, the check must agree. */
export function acceptClosing(close: CloseAnswer, check: CloseCheckAnswer | null, story: Pick<LinkStory, 'title' | 'label' | 'summary'>): CloseOutcome {
  if (close.happened !== 'yes') return 'not_happened'
  if (!quoteFound(close.quote, [story.title, story.label, story.summary])) return 'unquoted'
  if (!check) return 'failed'
  return check.happened === 'yes' ? 'closing' : 'disagreed'
}

/** Asks whether the flagged story reports the end event: the first call, and the check only when it said yes with the story's words. */
export async function checkClosing(c: CloseCase, deps: CloseDeps): Promise<CloseResult> {
  const promptVersion = `${OVERVIEW_PROMPT_VERSIONS.close}+${OVERVIEW_PROMPT_VERSIONS.closeCheck}`
  const first = await deps.close({ charter: c.charter, story: c.story, entries: c.entries })
  const close = first.parsed ? unescapeXmlDeep(first.parsed) : null
  const result = (outcome: CloseOutcome, check: CloseCheckAnswer | null, costUsd: number): CloseResult => ({
    outcome,
    answers: { close, check },
    costUsd,
    model: first.model,
    promptVersion,
  })
  if (!close) return result('failed', null, first.costUsd)
  const early = acceptClosing(close, { happened: 'yes', reason: '' }, c.story)
  if (early !== 'closing') return result(early, null, first.costUsd)
  const second = await deps.closeCheck({ endEvent: c.charter.endEvent, story: c.story })
  const check = second.parsed ? unescapeXmlDeep(second.parsed) : null
  return result(acceptClosing(close, check, c.story), check, first.costUsd + second.costUsd)
}
