/**
 * Deterministic judgments on a research draft: the citation check (every fact id exists, every
 * story sentence cites one, every number a sentence states appears in its cited facts), whether a
 * fact's supporting sentence occurs in its source text (a fidelity number for the report), and
 * the gate that turns a checked draft into a verdict. Pure.
 */
import { findUnsupportedNumbers } from '../lib/numbers.js'
import type { Draft } from '../schemas/research.js'

export interface PoolFact {
  /** `S2F3`: source 2, fact 3; `E1F2` for our own earlier stories. */
  id: string
  statement: string
  supportingSentence: string
  measures: string
}

export type DraftPart = 'story' | 'whyThisMatters' | 'caveats'

export interface DraftSentence {
  part: DraftPart
  /** Where it sits, for the rewrite prompt and the drafts file. */
  label: string
  text: string
  factIds: string[]
}

export interface CitationProblem {
  label: string
  text: string
  problem: string
  /** The fact check's judgment that the unsupported claim is the main development itself. */
  key?: boolean
}

type DraftParts = Pick<Draft, 'story' | 'whyThisMatters' | 'caveats'>

export function draftSentences(draft: DraftParts): DraftSentence[] {
  return [
    ...draft.story.flatMap((p, pi) =>
      p.sentences.map((s, si) => ({ part: 'story' as const, label: `Story paragraph ${pi + 1}, sentence ${si + 1}`, text: s.text, factIds: s.factIds })),
    ),
    ...draft.whyThisMatters.map((b, i) => ({ part: 'whyThisMatters' as const, label: `Why This Matters ${i + 1}`, text: b.text, factIds: b.factIds })),
    ...draft.caveats.map((b, i) => ({ part: 'caveats' as const, label: `Caveat ${i + 1}`, text: b.text, factIds: b.factIds })),
  ]
}

const sourceOf = (factId: string) => factId.replace(/F\d+$/, '')

/**
 * What a sentence may rest on: its cited facts first, then the other facts of the sources they
 * come from. Readers see one citation per source, so a sentence its cited sources support is
 * supported. Unknown ids add nothing.
 */
export function evidenceFor(factIds: string[], facts: ReadonlyMap<string, PoolFact>): PoolFact[] {
  const cited = factIds.flatMap(id => facts.get(id) ?? [])
  const sources = new Set(cited.map(f => sourceOf(f.id)))
  const citedIds = new Set(cited.map(f => f.id))
  return [...cited, ...[...facts.values()].filter(f => sources.has(sourceOf(f.id)) && !citedIds.has(f.id))]
}

function sentenceProblems(s: DraftSentence, facts: ReadonlyMap<string, PoolFact>): string[] {
  const unknown = s.factIds.filter(id => !facts.has(id))
  const evidence = evidenceFor(s.factIds, facts).map(f => `${f.statement}\n${f.supportingSentence}\n${f.measures}`)
  const numbers = findUnsupportedNumbers(s.text, evidence.join('\n')).unsupported
  return [
    ...unknown.map(id => `cites ${id}, which is not among the facts`),
    ...(s.part === 'story' && s.factIds.length === 0 ? ['cites no fact'] : []),
    ...numbers.map(n => `states "${n}", which none of its cited facts states`),
  ]
}

/** Every story sentence cites a fact; bullets may judge without one, but no number goes uncited. */
export function checkCitations(draft: DraftParts, facts: ReadonlyMap<string, PoolFact>): CitationProblem[] {
  return draftSentences(draft).flatMap(s => sentenceProblems(s, facts).map(problem => ({ label: s.label, text: s.text, problem })))
}

/**
 * A source's publication date as a fact (id `S2F0`), so a sentence may date the development from
 * it: the sources often say only "Wednesday", and the date is the one thing we know for sure.
 */
export function publishedFact(sourceId: string, outlet: string, date: string | null): PoolFact[] {
  const day = date ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : null
  if (!day || Number.isNaN(day.getTime())) return []
  const when = day.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  return [{ id: `${sourceId}F0`, statement: `${outlet} published this on ${when}.`, supportingSentence: '', measures: '' }]
}

/**
 * After the rewrite: the draft without its failing sentences, or why it cannot be saved: a key
 * claim (the main development itself, as the fact check judges it) is unsupported, or a part was
 * left empty. Any other failing sentence, the opening one included, is only dropped.
 */
export function dropFailing<D extends DraftParts>(draft: D, problems: CitationProblem[]): { draft: D } | { failed: string } {
  const key = problems.find(p => p.key)
  if (key) return { failed: `a key claim failed the check after one rewrite (${key.label})` }
  const failing = new Set(problems.map(p => p.label))
  const story = draft.story
    .map((p, pi) => ({ ...p, sentences: p.sentences.filter((_, si) => !failing.has(`Story paragraph ${pi + 1}, sentence ${si + 1}`)) }))
    .filter(p => p.sentences.length > 0)
  const whyThisMatters = draft.whyThisMatters.filter((_, i) => !failing.has(`Why This Matters ${i + 1}`))
  const caveats = draft.caveats.filter((_, i) => !failing.has(`Caveat ${i + 1}`))
  if (story.length === 0) return { failed: 'no story sentence passed the check after one rewrite' }
  if (whyThisMatters.length === 0) return { failed: 'no Why This Matters bullet passed the check after one rewrite' }
  if (caveats.length === 0) return { failed: 'no caveat passed the check after one rewrite' }
  return { draft: { ...draft, story, whyThisMatters, caveats } }
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

export type GateVerdict =
  | { kind: 'keep' }
  | { kind: 'research-rating'; rating: number }
  | { kind: 'stale'; firstHappened: string }
  | { kind: 'contradicted'; factIds: string[] }
  | { kind: 'fallback'; reason: string }

export type GateKind = GateVerdict['kind']
export const GATE_KINDS: GateKind[] = ['keep', 'research-rating', 'stale', 'contradicted', 'fallback']

/**
 * The design's gate, in its order: a rating below the publish bar, then old news, then a
 * contradicted main claim; a story whose research failed falls back to today's format.
 */
export function decideGate(outcome: { failed: string } | { draft: Pick<Draft, 'rating' | 'oldNews' | 'contradicted'> }, relevanceMin: number): GateVerdict {
  if ('failed' in outcome) return { kind: 'fallback', reason: outcome.failed }
  const { rating, oldNews, contradicted } = outcome.draft
  if (rating < relevanceMin) return { kind: 'research-rating', rating }
  if (oldNews.isOld) return { kind: 'stale', firstHappened: oldNews.firstHappened }
  if (contradicted.isContradicted) return { kind: 'contradicted', factIds: contradicted.factIds }
  return { kind: 'keep' }
}
