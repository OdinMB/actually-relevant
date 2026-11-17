/**
 * A story's evidence pool as a research pass holds it (`.context/research-passes.md`, "The pool"):
 * its sources, its facts with their verdicts and status, the searches made and the pages read, and
 * the story's current article version. The types the pass pipeline reads and returns, a fact's
 * identity in the pool (`poolFactKey`), the story-level refs a new source or fact takes, and a pool
 * fact seen as research's and context's code reads a fact. No I/O: `passRecords.ts` maps the rows.
 */
import type { ResearchedStory, CitedText } from './researchedStory.js'
import type { ContextSlot } from '../schemas/storyContext.js'
import type { ContextFactData, FactVerdict } from './storyContextChecks.js'
import { normalizedUrl } from './researchFilter.js'
import { factKey } from './storyContextRecords.js'

export type PoolOrigin = 'original' | 'cluster' | 'neighbour' | 'search' | 'earlier'

/** A person a source quotes: the quote word for word, and their position as the extraction read it. */
export interface Voice {
  name: string
  role: string
  quote: string
  stance: string
}

export interface PoolSource {
  /** The row's id; null for a source this pass found. */
  id: string | null
  /** `S0` (the original), `S1`…, or `E1`… for our earlier stories: stable within the story. */
  ref: string
  origin: PoolOrigin
  /** The earlier story an `earlier` source stands for. */
  earlierStoryId: string | null
  /** Empty for an earlier story. */
  url: string
  outlet: string
  title: string
  /** `YYYY-MM-DD`, or null. */
  date: string | null
  kind: string
  country: string
  relation: string
  favicon: string | null
  usedRawContent: boolean
  voices: Voice[]
  optOutChecked: boolean
  firstPassId: string | null
}

/** The fields the structure call (or a gap search's extraction) gives a fact, as context stores them. */
export type StructuredFields = Pick<
  ContextFactData,
  'value' | 'valueHigh' | 'unit' | 'approx' | 'provisional' | 'counted' | 'place' | 'asOf' | 'credited' | 'creditedKind' | 'validity'
>

/** Which model and prompt version gave a judgment. */
export interface Judge {
  model: string
  promptVersion: string
}

export type FactStatus = 'unreviewed' | 'reviewed' | 'demoted'

export interface PoolFact {
  /** The row's id; null for a fact this pass found. */
  id: string | null
  /** `S2F3`: its source's ref and its number within that source, stable within the story. */
  ref: string
  sourceRef: string
  /** A fact offered from a linked earlier story: that story's pool fact. */
  reusedFromId: string | null
  supportingSentence: string
  passage: string | null
  supportFound: boolean
  statement: string
  measures: string
  /** The card slot a gap search's fact was extracted for. */
  slot: ContextSlot | null
  /** Null until a pass structured it. */
  structured: (StructuredFields & { by: Judge }) | null
  extractedBy: Judge
  verdict: FactVerdict
  verdictProblem: string | null
  /** Null while unjudged; a fact is checked once. */
  checkedBy: (Judge & { passId: string | null }) | null
  status: FactStatus
  firstPassId: string | null
  drop: { passId: string | null; reason: 'contradicted' | 'editor'; contradictedBy: string[] } | null
}

export interface PoolSearch {
  kind: 'coverage' | 'gap'
  slot: string | null
  angle: string | null
  query: string
  normalizedQuery: string
  windowStart: string | null
  windowEnd: string | null
  depth: string | null
  credits: number
  results: number
  cached: boolean
  /** Null for a search imported from a legacy run. */
  passId: string | null
}

/** A page a pass read and left out, never read again. */
export interface DroppedSource {
  url: string
  reason: string
  passId: string | null
}

export interface Pool {
  sources: PoolSource[]
  facts: PoolFact[]
  searches: PoolSearch[]
  dropped: DroppedSource[]
}

export const EMPTY_POOL: Pool = { sources: [], facts: [], searches: [], dropped: [] }

/** The text fields a researched version writes into the story's columns. */
export interface VersionFields {
  title: string | null
  titleLabel: string | null
  summary: string | null
  marketingBlurb: string | null
  quote: string | null
  quoteAttribution: string | null
  relevanceReasons: string | null
  antifactors: string | null
  emotionTag: string | null
}

export interface VersionChange {
  section: string
  before: CitedText | null
  after: CitedText | null
}

export interface ArticleVersionData extends VersionFields {
  id: string | null
  number: number
  kind: 'first' | 'update' | 'legacy'
  status: 'current' | 'superseded' | 'reverted'
  passId: string | null
  research: ResearchedStory
  changes: VersionChange[]
  note: CitedText | null
}

/** A fact's identity in its story's pool: context's `factKey` on its page, supporting sentence and statement. */
export const poolFactKey = (f: Pick<PoolFact, 'supportingSentence' | 'statement'>, source: Pick<PoolSource, 'url' | 'earlierStoryId'>): string =>
  factKey({ url: sourceKey(source), supportingSentence: f.supportingSentence, statement: f.statement })

/** A source's identity in its story's pool: its normalized address, or `story:<id>` for an earlier story. */
export const sourceKey = (s: Pick<PoolSource, 'url' | 'earlierStoryId'>): string => (s.earlierStoryId ? `story:${s.earlierStoryId}` : normalizedUrl(s.url))

const numberAfter = (prefix: string) => (ref: string) => {
  const m = new RegExp(`^${prefix}(\\d+)$`).exec(ref)
  return m ? Number(m[1]) : -1
}

/** The next free source ref of a kind: `S<n>` for a page, `E<n>` for an earlier story (`S0` is the original's). */
export function nextSourceRef(refs: readonly string[], earlier: boolean): string {
  const prefix = earlier ? 'E' : 'S'
  const top = Math.max(earlier ? 0 : -1, ...refs.map(numberAfter(prefix)))
  return `${prefix}${top + 1}`
}

/** The next free fact ref of a source: `S2F<n>`. */
export function nextFactRef(sourceRef: string, refs: readonly string[]): string {
  const top = Math.max(0, ...refs.map(numberAfter(`${sourceRef}F`)))
  return `${sourceRef}F${top + 1}`
}

/** A fact that may be shown or offered: supported by its check and not demoted. */
export const usable = (f: Pick<PoolFact, 'verdict' | 'status'>): boolean => f.verdict === 'supported' && f.status !== 'demoted'
