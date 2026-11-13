/**
 * The draft's key quote (`quote`, `quoteAttribution`, `quoteSourceId`; owner decision 2026-11-13,
 * ADR-0057's amendment): the one place a source's exact words belong, so neither copying check
 * reads it. The fact check judges it, as its last item, faithful to a quote or sentence of the
 * source it names, with code's hint whether its words stand there as they are; a source id that is
 * not one of the run's sources fails it in code. One still failing after the rewrite is dropped,
 * never the run (`.context/story-research.md`, "Own words"). Pure.
 */
import type { Draft } from '../schemas/research.js'
import type { CheckedDraftItem, CitationProblem } from './researchChecks.js'
import { wordTokens, type SourceLine } from './researchCopying.js'

/** The key quote's label, as the problems, the rewrite's problem lines and the drop name it. */
export const QUOTE_LABEL = 'Key quote'

type QuoteParts = Pick<Draft, 'quote' | 'quoteAttribution' | 'quoteSourceId'>

/** "[T]he": bracketed letters that only change a word's case stay part of the word. */
const BRACKETED_CASE = /\[(\p{L}+)\](?=\p{L})/gu

/** A bracketed insertion ("[the ministry]", "[…]") or an ellipsis: any words of the source may stand in its place, or none. */
const GAP = /\[[^\]]*\]|…|\.\s?\.\s?\./g

/** The quote's words as runs that must stand in a line in this order, one run between each two gaps. */
function runsOf(quote: string): string[][] {
  return quote
    .replace(BRACKETED_CASE, '$1')
    .split(GAP)
    .map(wordTokens)
    .filter(run => run.length > 0)
}

/** Where `run` first stands in `tokens` from `from` on; -1 where it does not. */
function indexOfRun(tokens: string[], run: string[], from: number): number {
  for (let i = from; i + run.length <= tokens.length; i++) if (run.every((token, j) => tokens[i + j] === token)) return i
  return -1
}

function inOrder(runs: string[][], tokens: string[]): boolean {
  let from = 0
  for (const run of runs) {
    const at = indexOfRun(tokens, run, from)
    if (at < 0) return false
    from = at + run.length
  }
  return true
}

/**
 * Whether the quote's words stand in one of `lines` as they are, compared as `wordTokens` reads
 * them (case, quote marks and punctuation aside), each bracketed insertion or ellipsis a gap. A
 * translation is never found, so this is a hint for the fact check, never a finding.
 */
export function quoteFound(quote: string, lines: string[]): boolean {
  const runs = runsOf(quote)
  return runs.length > 0 && lines.some(line => inOrder(runs, wordTokens(line)))
}

const hasQuote = (draft: QuoteParts) => draft.quote.trim() !== ''

/**
 * The key quote as the fact check's item, with the claim it judges: the source it names, who it
 * says spoke, and whether its words stand in that source's quotes or supporting sentences (never
 * its title or the extractor's statements). None for an empty quote, nor for one whose source is
 * not among `sourceIds`, which `quoteProblems` fails in code.
 */
export function checkedQuote(draft: QuoteParts, lines: SourceLine[], sourceIds: ReadonlySet<string>): CheckedDraftItem | null {
  if (!hasQuote(draft) || !sourceIds.has(draft.quoteSourceId)) return null
  const own = lines.filter(line => line.sourceId === draft.quoteSourceId && (line.role === 'quote' || line.role === 'sentence')).map(line => line.text)
  return {
    item: { part: 'quote', label: QUOTE_LABEL, text: draft.quote, cited: false, factIds: [] },
    evidence: [],
    numberHints: [],
    quote: { sourceId: draft.quoteSourceId, attribution: draft.quoteAttribution, found: quoteFound(draft.quote, own) },
  }
}

/** The key quote's structure: the source it names is one of the run's (`S…`), never an earlier story of ours or a quote's id. */
export function quoteProblems(draft: QuoteParts, sourceIds: ReadonlySet<string>): CitationProblem[] {
  if (!hasQuote(draft) || sourceIds.has(draft.quoteSourceId)) return []
  return [
    {
      label: QUOTE_LABEL,
      text: draft.quote,
      problem: `names "${draft.quoteSourceId}" as its source, which is not one of the sources`,
      kind: 'fact',
      by: 'code',
    },
  ]
}

/** The draft without its key quote when the last check still failed it, so the story has none. */
export function withoutFailedQuote<D extends QuoteParts>(draft: D, problems: CitationProblem[]): D {
  return problems.some(p => p.label === QUOTE_LABEL) ? { ...draft, quote: '', quoteAttribution: '', quoteSourceId: '' } : draft
}
