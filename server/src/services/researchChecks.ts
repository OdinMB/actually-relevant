/**
 * Deterministic judgments on a research draft: the citation check (every fact id exists, every
 * story paragraph cites one, every number an item states appears in its cited facts), the copying
 * check (runs of a source's words, quoted spans), the fact check's answer read back as problems,
 * whether a fact's supporting sentence occurs in its source text (a fidelity number for the
 * report), and the gate that turns a checked draft into a verdict. Pure.
 */
import { findUnsupportedNumbers } from '../lib/numbers.js'
import type { Draft, FactCheck } from '../schemas/research.js'

export interface PoolFact {
  /** `S2F3`: source 2, fact 3; `E1F2` for our own earlier stories. */
  id: string
  statement: string
  supportingSentence: string
  measures: string
}

export type DraftPart = 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb'

/** One written field the checks read: a story paragraph, a bullet, the title, the summary or the blurb. */
export interface DraftItem {
  part: DraftPart
  /** Where it sits (`Story paragraph 2`, `Caveat 1`, `Title`): the problems, the rewrite prompt and the drops key on it. */
  label: string
  text: string
  /** Whether it carries citations: story paragraphs and bullets do; the title, summary and blurb never do. */
  cited: boolean
  factIds: string[]
}

/** Copying problems compare against a source's own words (title, supporting sentences, quotes) or its facts' statements. */
export type CopiedFrom = 'wording' | 'statement'

export interface CitationProblem {
  label: string
  text: string
  problem: string
  /** `fact`: a claim its cited facts do not state. `copying`: wording too close to a source's. */
  kind: 'fact' | 'copying'
  /** Which check found it: the code checks, or the fact-check model. */
  by: 'code' | 'judge'
  /** The fact check's judgment that the unsupported claim is the main development itself. */
  key?: boolean
  /** Copying: the source the item is too close to; none for a quoted span. */
  sourceId?: string
  /** The code's copying check: what of the source the run is shared with. */
  against?: CopiedFrom
  /** The judge's copying: the id of the source sentence, quote or title the item renders closely. */
  copiedSentence?: string
}

type DraftParts = Pick<Draft, 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb'>

const LABELS = {
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

function citationProblems(item: DraftItem, facts: ReadonlyMap<string, PoolFact>): string[] {
  const unknown = item.factIds.filter(id => !facts.has(id))
  const evidence = evidenceFor(item.factIds, facts).map(f => `${f.statement}\n${f.supportingSentence}\n${f.measures}`)
  const numbers = findUnsupportedNumbers(item.text, evidence.join('\n')).unsupported
  return [
    ...unknown.map(id => `cites ${id}, which is not among the facts`),
    ...(item.part === 'story' && item.factIds.length === 0 ? ['cites no fact'] : []),
    ...numbers.map(n => `states "${n}", which none of its cited facts states`),
  ]
}

/** Every story paragraph cites a fact; bullets may judge without one, but no number goes uncited. The title, summary and blurb cite nothing and are not checked here. */
export function checkCitations(draft: DraftParts, facts: ReadonlyMap<string, PoolFact>): CitationProblem[] {
  return draftItems(draft)
    .filter(item => item.cited)
    .flatMap(item =>
      citationProblems(item, facts).map(problem => ({ label: item.label, text: item.text, problem, kind: 'fact' as const, by: 'code' as const })),
    )
}

// ---------------------------------------------------------------------------
// Copying: what the writer reads of the sources, and the code's check against it
// ---------------------------------------------------------------------------

/** What a source contributes to the copying checks. */
export interface WordingSource {
  id: string
  title: string
  facts: Pick<PoolFact, 'id' | 'statement' | 'supportingSentence'>[]
  voices: { quote: string }[]
}

export interface SourceLine {
  /** `S2T` the title, `S2F3` a fact's sentence (and its statement), `S2Q1` a voice's quote. */
  id: string
  sourceId: string
  role: 'title' | 'sentence' | 'quote' | 'statement'
  text: string
}

/** Outside sources (`S…`); our earlier stories (`E…`) are our own text. */
const isOutside = (sourceId: string) => /^S\d+$/.test(sourceId)

export const againstOf = (line: Pick<SourceLine, 'role'>): CopiedFrom => (line.role === 'statement' ? 'statement' : 'wording')

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
      ...s.voices.map((v, i) => ({ id: `${s.id}Q${i + 1}`, sourceId: s.id, role: 'quote' as const, text: v.quote })),
      ...s.facts.map(f => ({ id: f.id, sourceId: s.id, role: 'statement' as const, text: f.statement })),
    ])
    .filter(line => line.text.trim() !== '')
}

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
 * The code's copying check: for every item and every outside source, the longest run of words the
 * item shares with any one of that source's lines (each line compared on its own, so a run never
 * crosses from one into the next), per kind; a run of `minWords` or more is a problem. A quoted
 * span of four words or more in any item is one too, since a person's words go only in the key quote.
 */
export function checkCopying(draft: DraftParts, sources: WordingSource[], minWords: number): { problems: CitationProblem[]; longestRuns: LongestRun[] } {
  const lines = sourceLines(sources).map(line => ({ ...line, tokens: wordTokens(line.text) }))
  const outside = sources.map(s => s.id).filter(isOutside)
  const problems: CitationProblem[] = []
  const longestRuns: LongestRun[] = []
  for (const item of draftItems(draft)) {
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

/** The source of a line id: `S2` of `S2T`, `S2F3` and `S2Q1`. */
const lineSource = (lineId: string) => lineId.replace(/(?:F\d+|Q\d+|T)$/, '')

/** The first id-shaped token of a judge's answer (it may add punctuation), when it is one of `known`. */
function knownId(value: string, pattern: RegExp, known: ReadonlySet<string>): string | null {
  const id = pattern.exec(value)?.[0]
  return id && known.has(id) ? id : null
}

/**
 * The fact check's answer as problems, by item number (its place in `items`): an unsupported claim
 * of an item that has evidence, with its key judgment (`fact`); and on any item, a source line it
 * renders closely or a source whose order it follows (`copying`, never key). A support verdict on
 * an item without evidence, and an id the prompt did not give, count for nothing.
 */
export function judgedProblems(answer: FactCheck, items: { item: DraftItem; evidence: PoolFact[] }[], lines: SourceLine[]): CitationProblem[] {
  const wordingIds = new Set(lines.filter(line => againstOf(line) === 'wording').map(line => line.id))
  const sourceIds = new Set(lines.map(line => line.sourceId))
  return answer.items.flatMap((v): CitationProblem[] => {
    const at = items[v.number - 1]
    if (!at) return []
    const { label, text } = at.item
    const copied = knownId(v.copiedSentence, /S\d+(?:F\d+|Q\d+|T)?/, wordingIds)
    const follows = knownId(v.followsSource, /S\d+/, sourceIds)
    return [
      ...(!v.supported && at.evidence.length > 0
        ? [
            {
              label,
              text,
              problem: `fails the fact check: ${v.problem || 'its cited facts do not state it'}`,
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
              problem: `renders ${copied} closely`,
              kind: 'copying' as const,
              by: 'judge' as const,
              sourceId: lineSource(copied),
              copiedSentence: copied,
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
 * A source's publication date as a fact (id `S2F0`), so a paragraph may date the development from
 * it: the sources often say only "Wednesday", and the date is the one thing we know for sure.
 */
export function publishedFact(sourceId: string, outlet: string, date: string | null): PoolFact[] {
  const day = date ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : null
  if (!day || Number.isNaN(day.getTime())) return []
  const when = day.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  return [{ id: `${sourceId}F0`, statement: `${outlet} published this on ${when}.`, supportingSentence: '', measures: '' }]
}

/** The items a draft cannot do without, so one still failing after the rewrite ends the run instead of being dropped. */
const UNDROPPABLE = ['Title', LABELS.story(0), 'Summary', 'Blurb']

const DROPPABLE_PARTS: [keyof typeof LABELS, string][] = [
  ['story', 'story paragraph'],
  ['whyThisMatters', 'Why This Matters bullet'],
  ['caveats', 'caveat'],
]

/**
 * After the rewrite: the draft without its failing paragraphs and bullets, or why it cannot be
 * saved, with the item it failed on: a key claim (the main development itself, as the fact check
 * judges it) is unsupported, an item that cannot be dropped still fails (the opening paragraph, the
 * title, the summary, the blurb), or a part was left empty.
 */
export function dropFailing<D extends DraftParts>(draft: D, problems: CitationProblem[]): { draft: D } | { failed: string; failedOn: string } {
  const key = problems.find(p => p.key)
  if (key) return { failed: `a key claim failed the check after one rewrite (${key.label})`, failedOn: key.label }
  const failing = new Set(problems.map(p => p.label))
  const whole = UNDROPPABLE.find(label => failing.has(label))
  if (whole) return { failed: `an item that cannot be dropped failed the check after one rewrite (${whole})`, failedOn: whole }
  const items = draftItems(draft)
  for (const [part, noun] of DROPPABLE_PARTS) {
    const ofPart = items.filter(i => i.part === part)
    if (ofPart.every(i => failing.has(i.label))) return { failed: `no ${noun} passed the check after one rewrite`, failedOn: ofPart[0]?.label ?? noun }
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
 * or an opinion piece or press release beside a news report). `draft_failed_check`: a key claim,
 * or an item the draft cannot do without, failed the checks after the rewrite, or a part of the
 * draft was left empty. `technical`: anything else (a failed model call or search, the run's
 * budget, an error).
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
