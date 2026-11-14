/**
 * Deterministic judgments on a research draft: its items, the citation check (every fact id
 * exists, every story paragraph cites one), each item's evidence and the numbers it states that its
 * evidence does not state digit for digit (hints for the fact check, never problems: ADR-0057), the
 * fact check's answer read back as problems, what the rewrite leaves of a draft, whether a fact's supporting
 * sentence occurs in its source text (a fidelity number for the report), and the gate that turns a
 * checked draft into a verdict. The copying check is `researchCopying.ts`. Pure.
 */
import { findUnsupportedNumbers } from '../lib/numbers.js'
import type { Draft, FactCheck } from '../schemas/research.js'
import { againstOf, type CopiedFrom, type SourceLine } from './researchCopying.js'

export interface PoolFact {
  /** `S2F3`: source 2, fact 3; `E1F2` for our own earlier stories. */
  id: string
  statement: string
  supportingSentence: string
  measures: string
}

export type DraftPart = 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb' | 'quote'

/**
 * One written field the checks read: a story paragraph, a bullet, the title, the summary or the
 * blurb (`draftItems`); or the key quote (`checkedQuote`, `researchQuote.ts`), which only the fact
 * check reads.
 */
export interface DraftItem {
  part: DraftPart
  /** Where it sits (`Story paragraph 2`, `Caveat 1`, `Title`): the problems, the rewrite prompt and the drops key on it. */
  label: string
  text: string
  /** Whether it carries citations: story paragraphs and bullets do; the title, summary and blurb never do. */
  cited: boolean
  factIds: string[]
}

export interface CitationProblem {
  label: string
  text: string
  problem: string
  /** `fact`: a claim its cited facts do not state. `copying`: wording too close to a source's. */
  kind: 'fact' | 'copying'
  /** Which check found it: the code checks, or the fact-check model. */
  by: 'code' | 'judge'
  /**
   * The fact check's judgment that the unsupported claim is the main development itself. Recorded
   * on any item, it ends the run only on one the draft cannot do without (`UNDROPPABLE`): only those
   * carry the main development, so a later paragraph or a bullet judged key is dropped as any other.
   */
  key?: boolean
  /** Copying: the source the item is too close to; none for a quoted span. */
  sourceId?: string
  /** The code's copying check: what of the source the run is shared with. */
  against?: CopiedFrom
  /** The judge's copying: the id of the source sentence, quote or title the item renders closely. */
  copiedSentence?: string
}

type DraftParts = Pick<Draft, 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb'>

/** The label of the cited item at index `i` of each part: the problems, repairs and drops key on it. */
export const LABELS = {
  story: (i: number) => `Story paragraph ${i + 1}`,
  whyThisMatters: (i: number) => `Why This Matters ${i + 1}`,
  caveats: (i: number) => `Caveat ${i + 1}`,
}

/** The items in the order the fact check reads them: title, story paragraphs, bullets, summary, blurb. */
export function draftItems(draft: DraftParts): DraftItem[] {
  const uncited = (part: DraftPart, label: string, text: string): DraftItem => ({ part, label, text, cited: false, factIds: [] })
  const cited = (part: keyof typeof LABELS) => (c: { text: string; factIds: string[] }, i: number) => ({
    part,
    label: LABELS[part](i),
    text: c.text,
    cited: true,
    factIds: c.factIds,
  })
  return [
    uncited('title', 'Title', draft.title),
    ...draft.story.map(cited('story')),
    ...draft.whyThisMatters.map(cited('whyThisMatters')),
    ...draft.caveats.map(cited('caveats')),
    uncited('summary', 'Summary', draft.summary),
    uncited('marketingBlurb', 'Blurb', draft.marketingBlurb),
  ]
}

const sourceOf = (factId: string) => factId.replace(/F\d+$/, '')

/**
 * What an item may rest on: its cited facts first, then the other facts of the sources they
 * come from. Readers see one citation per source, so an item its cited sources support is
 * supported. Unknown ids add nothing.
 */
export function evidenceFor(factIds: string[], facts: ReadonlyMap<string, PoolFact>): PoolFact[] {
  const cited = factIds.flatMap(id => facts.get(id) ?? [])
  const sources = new Set(cited.map(f => sourceOf(f.id)))
  const citedIds = new Set(cited.map(f => f.id))
  return [...cited, ...[...facts.values()].filter(f => sources.has(sourceOf(f.id)) && !citedIds.has(f.id))]
}

/** What the key quote claims, as the fact check judges it (`checkedQuote`). */
export interface QuoteCheck {
  /** The source it names (`quoteSourceId`), always one of the run's sources. */
  sourceId: string
  /** Who it says spoke (`quoteAttribution`). */
  attribution: string
  /** Whether code found its words in that source's quotes and sentences as they stand: a hint, never a finding. */
  found: boolean
}

/** An item as the fact check reads it. */
export interface CheckedDraftItem {
  item: DraftItem
  /**
   * What it may rest on: `evidenceFor` its cited facts (none for a bullet that cites nothing); every
   * fact of the pool for the title, summary and blurb (`againstPool`); none for the key quote.
   */
  evidence: PoolFact[]
  /**
   * The title, summary and blurb: they carry no citations yet state the development, so the fact
   * check judges them against every fact of the pool (2026-11-13, ADR-0057's amendment "headline,
   * summary and blurb"), which its prompt shows once (`<POOL>`), not per item.
   */
  againstPool?: boolean
  /**
   * The numbers the item states that its evidence does not state digit for digit (every number of
   * a bullet that cites nothing, which has no evidence): a reworded, rounded or converted number
   * lands here too, so it is a hint for the fact check, which judges it, and fails nothing by itself.
   */
  numberHints: string[]
  /** The key quote's claim; only on the key quote, judged for faithfulness to its source and never for copying. */
  quote?: QuoteCheck
}

const evidenceText = (evidence: PoolFact[]) => evidence.map(f => `${f.statement}\n${f.supportingSentence}\n${f.measures}`).join('\n')

const numberHints = (text: string, evidence: PoolFact[]) => findUnsupportedNumbers(text, evidenceText(evidence)).unsupported

/**
 * Every item of a draft, in `draftItems` order, with its evidence and its number hints: a story
 * paragraph or bullet against its cited facts' sources (`evidenceFor`), the title, summary and blurb,
 * which carry no citations, against every fact of the pool.
 */
export function checkedItems(draft: DraftParts, facts: ReadonlyMap<string, PoolFact>): CheckedDraftItem[] {
  const pool = [...facts.values()]
  return draftItems(draft).map(item => {
    if (!item.cited) return { item, evidence: pool, againstPool: true, numberHints: numberHints(item.text, pool) }
    const evidence = evidenceFor(item.factIds, facts)
    return { item, evidence, numberHints: numberHints(item.text, evidence) }
  })
}

function citationProblems(item: DraftItem, facts: ReadonlyMap<string, PoolFact>): string[] {
  const unknown = item.factIds.filter(id => !facts.has(id))
  return [...unknown.map(id => `cites ${id}, which is not among the facts`), ...(item.part === 'story' && item.factIds.length === 0 ? ['cites no fact'] : [])]
}

/**
 * The citations' structure: every cited id is a fact, and every story paragraph cites one; bullets
 * may judge without one. Numbers are the fact check's (`checkedItems`). The title, summary and
 * blurb cite nothing and are not checked here.
 */
export function checkCitations(draft: DraftParts, facts: ReadonlyMap<string, PoolFact>): CitationProblem[] {
  return draftItems(draft)
    .filter(item => item.cited)
    .flatMap(item =>
      citationProblems(item, facts).map(problem => ({ label: item.label, text: item.text, problem, kind: 'fact' as const, by: 'code' as const })),
    )
}

/** The first id-shaped token of a judge's answer (it may add punctuation), when it is one of `known`. */
function knownId(value: string, pattern: RegExp, known: ReadonlySet<string>): string | null {
  const id = pattern.exec(value)?.[0]
  return id && known.has(id) ? id : null
}

/**
 * Whether every fact an item cites comes from one source (its date fact `S2F0` included): the item
 * then follows that source's order by nature, which is not copying (owner decision 2026-11-13).
 */
const citesOneSource = (item: DraftItem) => new Set(item.factIds.map(sourceOf)).size === 1

/**
 * The fact check's answer as problems, by item number (its place in `items`): an unsupported claim
 * of an item that has evidence (for the title, summary and blurb, every fact of the pool) or number
 * hints, with its key judgment (`fact`); and on any item, a
 * source line it renders closely, quoted so the rewrite sees what it echoed, or a source whose
 * order it follows, unless the item cites that one source alone (`copying`, never key). A support
 * verdict on an item with neither, and an id the prompt did not give, count for nothing. The key
 * quote fails only as unfaithful to its source (`fact`, never key), never for copying.
 */
export function judgedProblems(answer: FactCheck, items: CheckedDraftItem[], lines: SourceLine[]): CitationProblem[] {
  const wording = new Map(lines.filter(line => againstOf(line) === 'wording').map(line => [line.id, line]))
  const sourceIds = new Set(lines.map(line => line.sourceId))
  return answer.items.flatMap((v): CitationProblem[] => {
    const at = items[v.number - 1]
    if (!at) return []
    const { label, text } = at.item
    if (at.quote)
      return v.supported
        ? []
        : [{ label, text, problem: `fails the fact check: ${v.problem || 'its source does not say it'}`, kind: 'fact', by: 'judge', key: false }]
    const copiedId = knownId(v.copiedSentence, /S\d+(?:F\d+|Q\d+|T)?/, new Set(wording.keys()))
    const copied = copiedId ? wording.get(copiedId) : undefined
    const follows = citesOneSource(at.item) ? null : knownId(v.followsSource, /S\d+/, sourceIds)
    return [
      ...(!v.supported && (at.evidence.length > 0 || at.numberHints.length > 0)
        ? [
            {
              label,
              text,
              problem: `fails the fact check: ${v.problem || (at.againstPool ? 'no fact states it' : 'its cited facts do not state it')}`,
              kind: 'fact' as const,
              by: 'judge' as const,
              key: v.key,
            },
          ]
        : []),
      ...(copied
        ? [
            {
              label,
              text,
              problem: `renders ${copied.id} ("${copied.text}") closely`,
              kind: 'copying' as const,
              by: 'judge' as const,
              sourceId: copied.sourceId,
              copiedSentence: copied.id,
            },
          ]
        : []),
      ...(follows
        ? [{ label, text, problem: `follows ${follows}'s order and wording`, kind: 'copying' as const, by: 'judge' as const, sourceId: follows }]
        : []),
    ]
  })
}

/**
 * The labels of the items the fact check's answer gives no verdict for (no entry with their
 * number). They are recorded, never failed: the code checks still ran on them.
 */
export function unjudgedLabels(answer: FactCheck, items: { item: DraftItem }[]): string[] {
  const judged = new Set(answer.items.map(v => v.number))
  return items.filter((_, i) => !judged.has(i + 1)).map(({ item }) => item.label)
}

/**
 * The day a source was published, `YYYY-MM-DD`: an ISO date's own day, else the UTC day of any date
 * `Date.parse` reads, as the source filter reads it (search gives `Thu, 12 Nov 2026 08:00:00 GMT`);
 * null when unknown or unreadable. The write prompt shows it on each source, the newest-information
 * rule's evidence of which report is later.
 */
export function publishedDay(date: string | null): string | null {
  if (!date) return null
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(date)?.[0]
  const time = Date.parse(iso ? `${iso}T00:00:00Z` : date)
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10)
}

/**
 * A source's publication date as a fact (id `S2F0`), so a paragraph may date the development from
 * it: the sources often say only "Wednesday", and the date is the one thing we know for sure.
 */
export function publishedFact(sourceId: string, outlet: string, date: string | null): PoolFact[] {
  const day = publishedDay(date)
  if (!day) return []
  const when = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  return [{ id: `${sourceId}F0`, statement: `${outlet} published this on ${when}.`, supportingSentence: '', measures: '' }]
}

/**
 * The items a draft cannot do without, so one still failing after repair ends the run instead
 * of being dropped; the only items a key judgment counts on. The fact-check prompt's key rule and
 * the `key` description in `factCheckSchema` name the same labels: keep them in step.
 */
const UNDROPPABLE = ['Title', LABELS.story(0), 'Summary', 'Blurb']

/**
 * The parts paragraphs and bullets are dropped from, each with the label `failedOn` gives it when
 * the draft has nothing in it: a part's name, as an item's label names the item.
 */
const DROPPABLE_PARTS: { part: keyof typeof LABELS; label: string; noun: string }[] = [
  { part: 'story', label: 'Story', noun: 'story paragraph' },
  { part: 'whyThisMatters', label: 'Why This Matters', noun: 'Why This Matters bullet' },
  { part: 'caveats', label: 'Caveats', noun: 'caveat' },
]

/**
 * The repaired draft without its failing paragraphs and bullets, or why it cannot be saved,
 * with the item it failed on: a key claim (the main development itself, as the fact check judges
 * it) is unsupported in an item that cannot be dropped (the opening paragraph, the title, the
 * summary, the blurb; a key judgment on any other item counts for nothing), such an item still
 * fails, every item of a part failed (`failedOn` its first item), or the draft has nothing in a
 * part at all (`failedOn` the part's name, `Story`, `Why This Matters` or `Caveats`), with or
 * without problems: a researched story always has all three.
 */
export function dropFailing<D extends DraftParts>(draft: D, problems: CitationProblem[]): { draft: D } | { failed: string; failedOn: string } {
  const key = problems.find(p => p.key && UNDROPPABLE.includes(p.label))
  if (key) return { failed: `a key claim failed the check after repair (${key.label})`, failedOn: key.label }
  const failing = new Set(problems.map(p => p.label))
  const whole = UNDROPPABLE.find(label => failing.has(label))
  if (whole) return { failed: `an item that cannot be dropped failed the check after repair (${whole})`, failedOn: whole }
  const items = draftItems(draft)
  for (const { part, label, noun } of DROPPABLE_PARTS) {
    const [first, ...rest] = items.filter(i => i.part === part)
    if (!first) return { failed: `the draft has no ${noun}`, failedOn: label }
    if ([first, ...rest].every(i => failing.has(i.label))) return { failed: `no ${noun} passed the check after repair`, failedOn: first.label }
  }
  const keep = (part: keyof typeof LABELS) => (_: unknown, i: number) => !failing.has(LABELS[part](i))
  return {
    draft: {
      ...draft,
      story: draft.story.filter(keep('story')),
      whyThisMatters: draft.whyThisMatters.filter(keep('whyThisMatters')),
      caveats: draft.caveats.filter(keep('caveats')),
    },
  }
}

/** A bracketed or parenthesised list of fact ids a writer left in its text: " [S1F7, S0F1]". */
const INLINE_IDS = /\s*[[(](?:\s*[SE]\d+F\d+\s*[,;]?)+[\])]/g

/** Every string of a draft without inline fact ids, which belong in `factIds` alone. */
export function withoutInlineIds<T>(value: T): T {
  if (typeof value === 'string') return value.replace(INLINE_IDS, '') as T
  if (Array.isArray(value)) return value.map(v => withoutInlineIds(v)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutInlineIds(v)])) as T
  return value
}

/** One line per problem, as the rewrite prompt and the drafts file show it. */
export function describeProblem(p: CitationProblem): string {
  return `${p.label} ("${p.text}") ${p.problem}`
}

const QUOTE_MARKS = /['"‘’‚‛“”„‟′″`´«»]/g

function normalized(text: string): string {
  return text.normalize('NFKC').replace(/­/g, '').replace(QUOTE_MARKS, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Whether a supporting sentence occurs in its source text, ignoring case, whitespace, quote marks and a final stop. */
export function supportFound(sentence: string, text: string): boolean {
  const needle = normalized(sentence).replace(/[.!?…]+$/, '')
  return needle !== '' && normalized(text).includes(needle)
}

/**
 * Why a run fell back to today's format, recorded with it so the owner can count them (owner's
 * request 2026-11-12); no verdict or write depends on it. `no_other_coverage`: no other report
 * survived the opt-out checks and the source filter. `not_confirmed`: other reports survived it,
 * but the extraction kept none as reporting the story (each unreadable, about another development,
 * or an opinion piece or press release beside a news report). `draft_failed_check`: an item the
 * draft cannot do without failed the checks after repair (a key claim in it or any other
 * problem), or a part of the draft was left empty or had nothing in it. `technical`: anything else
 * (a failed model call or search, the run's budget, an error).
 */
export const FALLBACK_CATEGORIES = ['no_other_coverage', 'not_confirmed', 'draft_failed_check', 'technical'] as const
export type FallbackCategory = (typeof FALLBACK_CATEGORIES)[number]

export type GateVerdict =
  | { kind: 'keep' }
  | { kind: 'research-rating'; rating: number }
  | { kind: 'stale'; firstHappened: string }
  | { kind: 'contradicted'; factIds: string[] }
  | { kind: 'fallback'; reason: string; category: FallbackCategory }

export type GateKind = GateVerdict['kind']
export const GATE_KINDS: GateKind[] = ['keep', 'research-rating', 'stale', 'contradicted', 'fallback']

/**
 * The gate: what research found comes first, old news, then a contradicted main claim; then a
 * rating below the publish bar (`research-rating`), which is recorded for evaluation and rejects
 * nothing (owner decision 2026-11-12: a re-evaluation that comes out lower is no reason). A story
 * whose research failed falls back to today's format, with the reason and its category.
 */
export function decideGate(
  outcome: { failed: string; category: FallbackCategory } | { draft: Pick<Draft, 'rating' | 'oldNews' | 'contradicted'> },
  relevanceMin: number,
): GateVerdict {
  if ('failed' in outcome) return { kind: 'fallback', reason: outcome.failed, category: outcome.category }
  const { rating, oldNews, contradicted } = outcome.draft
  if (oldNews.isOld) return { kind: 'stale', firstHappened: oldNews.firstHappened }
  if (contradicted.isContradicted) return { kind: 'contradicted', factIds: contradicted.factIds }
  if (rating < relevanceMin) return { kind: 'research-rating', rating }
  return { kind: 'keep' }
}
