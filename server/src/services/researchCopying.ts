/**
 * The copying engine of story research (`.context/story-research.md`, "Own words"): what the writer
 * reads of each outside source, the words of a text as the check compares them, quoted spans, and
 * the code's copying check over a draft's items, with each item's longest shared run. Pure.
 */
import type { CitationProblem, DraftItem, PoolFact } from './researchChecks.js'

/** Copying problems compare against a source's own words (title, supporting sentences, quotes) or its facts' statements. */
export type CopiedFrom = 'wording' | 'statement'

/** What a source contributes to the copying checks. */
export interface WordingSource {
  id: string
  title: string
  facts: Pick<PoolFact, 'id' | 'statement' | 'supportingSentence'>[]
  voices: { name: string; role: string; quote: string }[]
}

export interface SourceLine {
  /** `S2T` the title, `S2F3` a fact's sentence (and its statement), `S2Q1` a voice's quote. */
  id: string
  sourceId: string
  role: 'title' | 'sentence' | 'quote' | 'statement'
  text: string
  /** A quote's speaker, with their role when the source gives one, so the fact check can hold the key quote's attribution to it. */
  speaker?: string
}

/** Outside sources (`S…`); our earlier stories (`E…`) are our own text. */
const isOutside = (sourceId: string) => /^S\d+$/.test(sourceId)

export const againstOf = (line: Pick<SourceLine, 'role'>): CopiedFrom => (line.role === 'statement' ? 'statement' : 'wording')

/** The id of a source's `index`th voice's quote (from 0), as the write prompt and both checks name it. */
export const quoteId = (sourceId: string, index: number) => `${sourceId}Q${index + 1}`

/**
 * What the writer reads of each outside source: its title, each fact's supporting sentence and each
 * voice's quote, in the source's language, then each fact's statement, the extractor's English.
 * Both copying checks compare the draft against these lines; empty ones are left out.
 */
export function sourceLines(sources: WordingSource[]): SourceLine[] {
  return sources
    .filter(s => isOutside(s.id))
    .flatMap((s): SourceLine[] => [
      { id: `${s.id}T`, sourceId: s.id, role: 'title', text: s.title },
      ...s.facts.map(f => ({ id: f.id, sourceId: s.id, role: 'sentence' as const, text: f.supportingSentence })),
      ...s.voices.map((v, i) => ({
        id: quoteId(s.id, i),
        sourceId: s.id,
        role: 'quote' as const,
        text: v.quote,
        speaker: [v.name, v.role].filter(part => part.trim() !== '').join(', '),
      })),
      ...s.facts.map(f => ({ id: f.id, sourceId: s.id, role: 'statement' as const, text: f.statement })),
    ])
    .filter(line => line.text.trim() !== '')
}

/** A `,`, `.`, `'`, `’`, space, no-break space or narrow no-break space between two digits. */
const DIGIT_GROUP = /(?<=\p{N})[,.'’   ](?=\p{N})/gu
const WORD_APOSTROPHE = /(?<=\p{L})['’](?=\p{L})/gu
const TOKEN = /[\p{L}\p{M}]+|\p{N}+|[%\p{Sc}]/gu

/**
 * The words of a text as the copying check compares them: NFKC, soft hyphens gone, lowercase; a
 * token is a run of letters (with their marks) or of digits, or a `%` or currency symbol alone.
 * Digit groups join ("1,200", "1.200" and "1 200" give `1200`), an apostrophe inside a word goes
 * ("Pakistan's" gives `pakistans`), and everything else separates, hyphens and quote marks included.
 */
export function wordTokens(text: string): string[] {
  const normalized = text.normalize('NFKC').replace(/­/g, '').toLowerCase().replace(DIGIT_GROUP, '').replace(WORD_APOSTROPHE, '')
  return normalized.match(TOKEN) ?? []
}

const DOUBLE_QUOTES = '“”„"«»'
const SINGLE_QUOTES = "‘’‚'‹›"
const OPENERS = '“„«»‹›‚‘"'
const CLOSERS = '”“»«›‹’‘"'
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c)

/**
 * The texts between quote marks: from an opener to the nearest closer of the same family (double
 * or single), so „…“, «…», »…« and “…” all count. A straight `'` opens only at a word's start and
 * closes only at its end, and an apostrophe inside a word never opens or closes.
 */
export function quotedSpans(text: string): string[] {
  const spans: string[] = []
  let open: { family: string; start: number } | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const before = text[i - 1]
    const after = text[i + 1]
    if ("'’‘".includes(c) && isLetter(before) && isLetter(after)) continue
    const family = DOUBLE_QUOTES.includes(c) ? DOUBLE_QUOTES : SINGLE_QUOTES.includes(c) ? SINGLE_QUOTES : null
    if (!family) continue
    if (open) {
      const closes = c === "'" ? after === undefined || /[\s.,;:!?)\]]/.test(after) : CLOSERS.includes(c)
      if (open.family === family && closes) {
        spans.push(text.slice(open.start, i))
        open = null
      }
    } else if (c === "'" ? (before === undefined || /[\s([]/.test(before)) && isLetter(after) : OPENERS.includes(c)) {
      open = { family, start: i + 1 }
    }
  }
  return spans
}

/** The longest run of consecutive tokens `a` shares with `b`. */
function longestRun(a: string[], b: string[]): string[] {
  let best = { length: 0, end: 0 }
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue
      row[j] = previous[j - 1]! + 1
      if (row[j]! > best.length) best = { length: row[j]!, end: i }
    }
    previous = row
  }
  return a.slice(best.end - best.length, best.end)
}

/** A quoted span this long or longer is a source's words outside the key quote. */
const QUOTED_SPAN_WORDS = 4

/** Each item's longest run of words shared with one source, per kind, recorded below the threshold too (the shadow week's distribution). */
export interface LongestRun {
  label: string
  sourceId: string
  against: CopiedFrom
  words: number
}

/**
 * The code's copying check: for every item (`draftItems`) and every outside source, the longest run
 * of words the item shares with any one of that source's lines (each line compared on its own, so a
 * run never crosses from one into the next), per kind; a run of `minWords` or more is a problem. A
 * quoted span of four words or more in any item is one too, since a person's words go only in the
 * key quote. The key quote itself is never read: it is the one place a source's exact words belong
 * (`researchQuote.ts`).
 */
export function checkCopying(items: DraftItem[], sources: WordingSource[], minWords: number): { problems: CitationProblem[]; longestRuns: LongestRun[] } {
  const lines = sourceLines(sources).map(line => ({ ...line, tokens: wordTokens(line.text) }))
  const outside = sources.map(s => s.id).filter(isOutside)
  const problems: CitationProblem[] = []
  const longestRuns: LongestRun[] = []
  for (const item of items) {
    if (item.part === 'quote') continue
    const tokens = wordTokens(item.text)
    const at = { label: item.label, text: item.text, kind: 'copying' as const, by: 'code' as const }
    for (const sourceId of outside) {
      for (const against of ['wording', 'statement'] as const) {
        const run = lines
          .filter(line => line.sourceId === sourceId && againstOf(line) === against)
          .map(line => longestRun(tokens, line.tokens))
          .reduce<string[]>((best, r) => (r.length > best.length ? r : best), [])
        longestRuns.push({ label: item.label, sourceId, against, words: run.length })
        if (run.length >= minWords) {
          const of = against === 'wording' ? `${sourceId}'s own words` : `the fact statements of ${sourceId}`
          problems.push({ ...at, sourceId, against, problem: `repeats ${run.length} words in a row from ${of}: "${run.join(' ')}"` })
        }
      }
    }
    for (const span of quotedSpans(item.text)) {
      if (wordTokens(span).length >= QUOTED_SPAN_WORDS)
        problems.push({ ...at, problem: `quotes a source ("${span}"); a person's words go only in the key quote` })
    }
  }
  return { problems, longestRuns }
}
