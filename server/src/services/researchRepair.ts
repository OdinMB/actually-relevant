/**
 * Targeted repair of a checked draft (owner decision 2026-11-13, ADR-0058; `.context/story-research.md`,
 * "Repair"): the items that failed with their problems, the draft with a repair's new texts merged in
 * for those items alone, so an item that passed never changes, the problems once some items were
 * checked again, and the derived fields (title, summary, blurb) that may be written again from the
 * kept story. Pure.
 */
import type { Derived, Draft, Repair } from '../schemas/research.js'
import { draftItems, LABELS, type CitationProblem } from './researchChecks.js'
import { QUOTE_LABEL } from './researchQuote.js'

type Repairable = Pick<Draft, 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb' | 'quote' | 'quoteAttribution' | 'quoteSourceId'>

/** An item a repair round rewrites, as the repair prompt shows it. */
export interface RepairTarget {
  label: string
  text: string
  /** The fact ids it cites; null for an item that carries no citations (the title, summary, blurb and key quote). */
  factIds: string[] | null
  /** Only on the key quote: who it says spoke, and the source it names. */
  quote?: { attribution: string; sourceId: string }
  /** What the checks found in it, one line each. */
  problems: string[]
}

function byLabel(problems: CitationProblem[]): Map<string, string[]> {
  const lines = new Map<string, string[]>()
  for (const p of problems) lines.set(p.label, [...(lines.get(p.label) ?? []), p.problem])
  return lines
}

/** The items a repair round takes up: every item with a problem, once, in the draft's order, the key quote last. */
export function repairTargets(draft: Repairable, problems: CitationProblem[]): RepairTarget[] {
  const lines = byLabel(problems)
  const items = draftItems(draft).flatMap(i => {
    const own = lines.get(i.label)
    return own ? [{ label: i.label, text: i.text, factIds: i.cited ? i.factIds : null, problems: own }] : []
  })
  const quote = lines.get(QUOTE_LABEL)
  if (!quote) return items
  return [
    ...items,
    { label: QUOTE_LABEL, text: draft.quote, factIds: null, quote: { attribution: draft.quoteAttribution, sourceId: draft.quoteSourceId }, problems: quote },
  ]
}

/** Every item of the draft as readers see it, by label, the key quote with its speaker: the repair prompt's context. */
export function storyItems(draft: Repairable): { label: string; text: string }[] {
  const items = draftItems(draft).map(({ label, text }) => ({ label, text }))
  return draft.quote.trim() === '' ? items : [...items, { label: QUOTE_LABEL, text: `${draft.quote} (${draft.quoteAttribution})` }]
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * The draft with a repair's new texts for `targets` alone, and the labels it changed, in the
 * draft's order. Any other label in the answer, a second answer for a label, an empty text and an
 * item the same as before count for nothing, so an item that passed stays as it was, byte for byte.
 * A cited item takes the answer's fact ids; the title, summary and blurb cite nothing.
 */
export function withRepairs<D extends Repairable>(draft: D, answer: Repair, targets: RepairTarget[]): { draft: D; rewritten: string[] } {
  const wanted = new Set(targets.map(t => t.label))
  const answers = new Map<string, Repair['items'][number]>()
  for (const a of answer.items) if (wanted.has(a.label) && !answers.has(a.label)) answers.set(a.label, a)
  const rewritten: string[] = []
  const text = (label: string, old: string): string => {
    const fresh = answers.get(label)?.text.trim() ?? ''
    if (fresh === '' || fresh === old) return old
    rewritten.push(label)
    return fresh
  }
  const cited = (part: keyof typeof LABELS) => (c: { text: string; factIds: string[] }, i: number) => {
    const a = answers.get(LABELS[part](i))
    const fresh = a?.text.trim() ?? ''
    if (!a || fresh === '' || (fresh === c.text && sameIds(a.factIds, c.factIds))) return c
    rewritten.push(LABELS[part](i))
    return { ...c, text: fresh, factIds: a.factIds }
  }
  const next: D = {
    ...draft,
    title: text('Title', draft.title),
    story: draft.story.map(cited('story')),
    whyThisMatters: draft.whyThisMatters.map(cited('whyThisMatters')),
    caveats: draft.caveats.map(cited('caveats')),
    summary: text('Summary', draft.summary),
    marketingBlurb: text('Blurb', draft.marketingBlurb),
  }
  const quote = { quote: answer.quote.trim(), quoteAttribution: answer.quoteAttribution.trim(), quoteSourceId: answer.quoteSourceId.trim() }
  const quoteChanged = quote.quote !== draft.quote || quote.quoteAttribution !== draft.quoteAttribution || quote.quoteSourceId !== draft.quoteSourceId
  if (!wanted.has(QUOTE_LABEL) || quote.quote === '' || !quoteChanged) return { draft: next, rewritten }
  return { draft: { ...next, ...quote }, rewritten: [...rewritten, QUOTE_LABEL] }
}

/** The problems once the `rechecked` items were checked again: theirs from the new pass, every other item's as before. */
export function afterRecheck(previous: CitationProblem[], pass: { problems: CitationProblem[]; rechecked: string[] }): CitationProblem[] {
  const rechecked = new Set(pass.rechecked)
  return [...previous.filter(p => !rechecked.has(p.label)), ...pass.problems]
}

/** The derived fields, by label, with the draft field each is. */
const DERIVED = { Title: 'title', Summary: 'summary', Blurb: 'marketingBlurb' } as const satisfies Record<string, keyof Derived>

/**
 * The title, summary and blurb still failing on copying alone after the repair rounds: these may be
 * written again from the kept story. One with a fact problem may not, and ends the run as before.
 */
export function derivableLabels(problems: CitationProblem[]): string[] {
  return Object.keys(DERIVED).filter(label => {
    const own = problems.filter(p => p.label === label)
    return own.length > 0 && own.every(p => p.kind === 'copying')
  })
}

/** The draft with the derived fields `labels` names taken from the answer, and the labels it changed; an empty or unchanged text counts for nothing. */
export function withDerived<D extends Repairable>(draft: D, answer: Derived, labels: string[]): { draft: D; rewritten: string[] } {
  let next = draft
  const rewritten: string[] = []
  for (const [label, field] of Object.entries(DERIVED)) {
    const fresh = answer[field].trim()
    if (!labels.includes(label) || fresh === '' || fresh === draft[field]) continue
    next = { ...next, [field]: fresh }
    rewritten.push(label)
  }
  return { draft: next, rewritten }
}
