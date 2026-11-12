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

function sentenceProblems(s: DraftSentence, facts: ReadonlyMap<string, PoolFact>): string[] {
  const unknown = s.factIds.filter(id => !facts.has(id))
  const cited = s.factIds.flatMap(id => {
    const f = facts.get(id)
    return f ? [`${f.statement}\n${f.supportingSentence}\n${f.measures}`] : []
  })
  const numbers = findUnsupportedNumbers(s.text, cited.join('\n')).unsupported
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
