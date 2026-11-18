/**
 * One story's context, steps 2-12 (`.context/story-context.md`, "What one story goes through"):
 * structure research's facts, the gap list, the searches with the opt-out and source filter, one
 * extraction per new source, the fact check, the write, the box checks and the response check. On a
 * story with earlier runs (`ContextInput.earlier`) it builds on them: their facts carried over, their
 * judged research facts, queries, response angles and read pages not repeated. No I/O
 * of its own, as `researchStory` has none: model calls, search and the opt-out policy are injected
 * (`storyContextRuns.ts` in production, the eval's deps in eval:overviews). It writes nothing.
 */
import type { z } from 'zod'
import { config } from '../config.js'
import type { LlmCallOutcome, LlmTokenUsage } from '../lib/llmUsage.js'
import type { Prompt } from '../lib/promptCache.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { promptVersionOf as versionOf } from '../prompts/promptVersion.js'
import { buildFactCheckPrompt } from '../prompts/research.js'
import { buildBoxesPrompt, buildContextExtractionPrompt, buildGapListPrompt, buildStructurePrompt, type StoryText } from '../prompts/storyContext.js'
import { factCheckSchema, type FactCheck } from '../schemas/research.js'
import {
  boxesSchema,
  contextExtractionSchema,
  gapListSchema,
  structureSchema,
  type ContextSlot,
  type GapList,
  type StructuredFact,
} from '../schemas/storyContext.js'
import { publishedDay, supportFound } from './researchChecks.js'
import { sourceLines, type WordingSource } from './researchCopying.js'
import { domainOf, dropOptedOut, type CandidateSource, type SourcePolicy } from './researchFilter.js'
import {
  applyBoxVerdicts,
  boxCheckItems,
  boxCopying,
  factCheckItems,
  factVerdicts,
  itemTally,
  promptItems,
  renderFact,
  resolveVisuals,
  structuralBoxes,
  wordingSources,
  type BoxDrop,
  type BoxItem,
  type ContextFactData,
  type DraftBox,
  type FactSource,
} from './storyContextChecks.js'
import { layoutSpots, type StoryLayout } from './storyContextLayout.js'
import { boxRefs, factKey } from './storyContextRecords.js'
import { normalizedQuery, passageAround, pickNewSources, type ContextSearchAnswer, type ContextSearchRequest, type SourceDrop } from './storyContextSources.js'
import { isCurrent, normalizeAsOf, type ValidityWindows } from './storyContextVisuals.js'

export const CONTEXT_STEPS = ['structure', 'gap-list', 'extract', 'fact-check', 'write', 'box-check'] as const
export type ContextStep = (typeof CONTEXT_STEPS)[number]

/** The starting tier of each step: small throughout, the write at medium, as research's write. The eval moves a step up. */
export const CONTEXT_STEP_TIERS: Record<ContextStep, 'small' | 'medium'> = {
  structure: 'small',
  'gap-list': 'small',
  extract: 'small',
  'fact-check': 'small',
  write: 'medium',
  'box-check': 'small',
}

export interface ContextCallResult<T> {
  parsed: T | null
  outcome: LlmCallOutcome
  usage: LlmTokenUsage
  costUsd: number
  model: string
  /** An `error` that may pass on a later attempt (a timeout, a lost connection, a rate limit, a server error), as the caller judged it. */
  transient?: boolean
}

export type ContextCall = <T>(step: ContextStep, schema: z.ZodType<T>, prompt: Prompt) => Promise<ContextCallResult<T>>

export interface ContextDeps {
  call: ContextCall
  search(request: ContextSearchRequest): Promise<ContextSearchAnswer>
  /** Publishers' AI opt-outs, checked on every search result, cached ones included. Unset: not checked (recorded). */
  sourcePolicy?: SourcePolicy
  /** Whether an error a dep threw (a search's) may pass on a later attempt. Unset: none may. */
  transient?(err: unknown): boolean
}

/** One of research's sources with its facts, as the step loads it (`loadContextInput`). */
export interface ContextResearchSource {
  /** `S0`, `S2` … */
  id: string
  url: string
  title: string
  outlet: string
  /** As research recorded it. */
  date: string | null
  kind: string
  facts: { id: string; statement: string; supportingSentence: string; measures: string; found: boolean }[]
  voices: { name: string; role: string; quote: string }[]
}

/** An earlier story's supported, current context fact, offered again (step 1); or, in `EarlierWork`, a fact of this story's own earlier run. */
export type ReusableFact = ContextFactData & { id: string }

/** One of the two angles of the `response` searches (ADR-0065's amendment). */
export type ResponseAngle = keyof GapList['responseSearches']

/**
 * What the story's earlier completed context runs did, for a run that builds on them
 * (`.context/story-context.md`, "On demand"; `loadEarlierWork`). Production's runs load it; the eval
 * does not, so it measures a first run.
 */
export interface EarlierWork {
  /** Their supported facts no one demoted, as found (copies of reused facts left out), newest first, each once (`factKey`). */
  facts: ReusableFact[]
  /** `factKey` of every research fact they judged (supported or rejected): not structured or checked again. */
  judged: string[]
  /** Every query they made (`normalizedQuery`). */
  queries: string[]
  /** The `response` angles they searched. */
  angles: ResponseAngle[]
  /** Every URL they picked to read, or a fact of theirs cites. */
  read: string[]
}

const NO_EARLIER_WORK: EarlierWork = { facts: [], judged: [], queries: [], angles: [], read: [] }

export interface ContextInput {
  storyId: string
  title: string
  summary: string
  /** The day the story was published, `YYYY-MM-DD`: facts are judged current on it. */
  storyDay: string
  layout: StoryLayout
  researchRunId: string
  sources: ContextResearchSource[]
  reusable: ReusableFact[]
  /** The story's earlier runs, for a run that builds on them; none for a first run. */
  earlier?: EarlierWork
}

export interface ContextCallRecord {
  step: ContextStep
  outcome: LlmCallOutcome
  usage: LlmTokenUsage
  costUsd: number
  model: string
}

export interface SearchRecord {
  slot: ContextSlot
  wanted: string
  query: string
  /** A `response` search's angle; absent on the other slots' and on records stored before 2026-11-17. */
  angle?: ResponseAngle
  recent: boolean
  cached: boolean
  credits: number
  results: number
  kept: string[]
}

/** What the run did, stored as `story_context_runs.result` and shown in the admin's "What the run did". */
export interface ContextRunRecord {
  slots: GapList['slots']
  /** The story's own sentence that reports the response, when the gap list found one in it. */
  responseInStory: string | null
  /** The `response` search was added from the title, the gap list having listed none. */
  responseFallback: boolean
  searches: SearchRecord[]
  /** Searches not made because an earlier run of the story made them (the query, or for `response` its angle). */
  skippedSearches: { slot: ContextSlot; query: string }[]
  sourceDrops: SourceDrop[]
  /** Search sources whose extraction failed or found them unusable. */
  extractionDrops: { url: string; reason: 'unusable' | LlmCallOutcome }[]
  /** `research`: research facts structured this run; `carried`: facts taken over from the story's earlier runs, not checked again. */
  facts: { research: number; leftOut: number; search: number; reused: number; carried: number; supported: number; rejected: number; unjudged: number }
  /** Each fact the check rejected or left unjudged, with its problem. */
  droppedFacts: { ref: string; text: string; verdict: 'rejected' | 'unjudged'; problem: string | null }[]
  boxDrops: BoxDrop[]
  numberHints: { label: string; numbers: string[] }[]
  /** `response` was searched for, the story does not report it, and nothing supported answers it: no card says so. */
  responseNotFound: boolean
  tally: { checked: number; failed: number }
  calls: ContextCallRecord[]
  optOutChecked: boolean
}

export type ContextOutcome = 'built' | 'none-kept' | 'no-research' | 'technical'

export interface StoryContextResult {
  status: 'completed' | 'skipped' | 'failed'
  outcome: ContextOutcome
  /** Every fact to store, with its verdict: research's and the search's, and the reused facts a kept box cites. */
  facts: ContextFactData[]
  /** The kept boxes in order. */
  boxes: DraftBox[]
  /** The model and prompt version the boxes were written with; null without a write. */
  writer: { model: string; promptVersion: string } | null
  credits: number
  modelUsd: number
  record: ContextRunRecord
  /** Why the run failed, safe to store: our own step messages and Tavily's sanitized ones only. */
  error: string | null
  /** A technical failure that may pass on a later attempt (`ContextDeps.transient`, `ContextCallResult.transient`); false otherwise. */
  transient: boolean
}

// ---------------------------------------------------------------------------
// Prompt versions: a hash of each step's prompt on a fixed input, and its schema
// ---------------------------------------------------------------------------

const CANONICAL_STORY: StoryText = {
  title: 'Title',
  date: '2026-01-01',
  paragraphs: [{ id: 'P1', text: 'Paragraph.' }],
  points: [{ id: 'W1', text: 'Point.' }],
  caveats: ['Caveat.'],
}
const CANONICAL_ITEM = {
  label: 'Fact S1F1',
  text: 'Text.',
  facts: [{ id: 'S1F1', statement: 'Fact.', supportingSentence: 'Sentence.', measures: '' }],
  numbersNotFound: [],
}

/** Computed once at load, so a changed template or `.describe()` changes the version with no hand-kept number. */
export const CONTEXT_PROMPT_VERSIONS: Record<ContextStep, string> = {
  structure: versionOf(
    buildStructurePrompt({
      facts: [
        {
          id: 'S1F1',
          statement: 'Fact.',
          supportingSentence: 'Sentence.',
          measures: '',
          source: { outlet: 'Outlet', date: '2026-01-01', kind: 'news-report' },
        },
      ],
    }),
    structureSchema,
  ),
  'gap-list': versionOf(buildGapListPrompt({ story: CANONICAL_STORY, facts: [{ id: 'S1F1', text: 'Fact.', current: true }] }), gapListSchema),
  extract: versionOf(
    buildContextExtractionPrompt({
      story: { title: 'Title', summary: 'Summary.' },
      wanted: [{ slot: 'compared', wanted: 'Wanted.' }],
      source: { outlet: 'Outlet', url: 'https://example.com/', date: '2026-01-01', title: 'Title', text: 'Text.' },
    }),
    contextExtractionSchema,
  ),
  'fact-check': versionOf(buildFactCheckPrompt([CANONICAL_ITEM], [], []), factCheckSchema),
  write: versionOf(
    buildBoxesPrompt({
      story: CANONICAL_STORY,
      facts: [{ id: 'S1F1', text: 'Fact.', outlet: 'Outlet', date: '2026-01-01', current: true }],
      needed: [{ slot: 'compared', covered: 'no' }],
      responseInStory: false,
    }),
    boxesSchema,
  ),
  'box-check': versionOf(buildFactCheckPrompt([CANONICAL_ITEM], [{ id: 'S1T', sourceId: 'S1', role: 'title', text: 'Title' }], []), factCheckSchema),
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/** Ends a story's run as a technical failure; its message is safe to store. */
class Stop extends Error {
  constructor(
    message: string,
    readonly transient = false,
  ) {
    super(message)
  }
}

/** A failure safe to store: our own step messages and Tavily's sanitized ones, else the error's name. */
function errorText(err: unknown): string {
  if (err instanceof Stop) return err.message
  if (err instanceof Error && err.name === 'TavilyError') return err.message
  if (!(err instanceof Error)) return 'unexpected error'
  const code = (err as { code?: unknown }).code
  return `unexpected error (${err.name}${typeof code === 'string' ? ` ${code}` : ''})`
}

function required<T>(res: { parsed: T | null; outcome: LlmCallOutcome; transient?: boolean }, step: ContextStep): T {
  if (res.parsed === null) throw new Stop(`${step}: ${res.outcome}`, res.transient === true)
  return res.parsed
}

const WINDOWS = (): ValidityWindows => ({ fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays })

const sourceNumber = (id: string) => Number(/^S(\d+)$/.exec(id)?.[1] ?? -1)

/**
 * The structured fields as stored: an as-of read only when valid, nobody credited as null, and a
 * range whose ends are equal as a single value (a chart draws no range).
 */
export function structured(
  a: StructuredFact,
): Pick<ContextFactData, 'value' | 'valueHigh' | 'unit' | 'approx' | 'provisional' | 'counted' | 'place' | 'asOf' | 'credited' | 'creditedKind' | 'validity'> {
  return {
    value: a.value,
    valueHigh: a.value !== null && a.valueHigh !== a.value ? a.valueHigh : null,
    unit: a.unit.trim(),
    approx: a.approx,
    provisional: a.provisional,
    counted: a.counted.trim(),
    place: a.place.trim(),
    asOf: normalizeAsOf(a.asOf),
    credited: a.credited.trim(),
    creditedKind: a.credited.trim() && a.creditedKind !== 'none' ? a.creditedKind : null,
    validity: a.validity,
  }
}

const unverified = { verdict: 'unjudged' as const, verdictProblem: null }

function sourceOf(s: { id: string; url: string; outlet: string; title: string; date: string | null; kind: string }): FactSource {
  return { id: s.id, url: s.url, outlet: s.outlet, title: s.title, date: publishedDay(s.date), kind: s.kind }
}

export interface PlannedSearch {
  slot: ContextSlot
  wanted: string
  query: string
  angle?: ResponseAngle
  recent: boolean
}

/**
 * The two angles of the `response` searches (owner decision 2026-11-17, ADR-0065): what is being
 * done about this problem, and what has worked against it elsewhere. Each falls back to a query from
 * the story's title when the gap list gives none.
 */
export const RESPONSE_ANGLES: { angle: ResponseAngle; wanted: string; fallback: (title: string[]) => string[] }[] = [
  {
    angle: 'action',
    wanted: 'Who is responding to the problem and what is being done about it: responses under way and solutions being tried.',
    fallback: title => [...title.slice(0, 9), 'response'],
  },
  {
    angle: 'elsewhere',
    wanted: 'What has worked against the same problem in other places or at other times.',
    fallback: title => [...title.slice(0, 6), 'solutions', 'that', 'worked', 'elsewhere'],
  },
]

/**
 * The searches to make (step 3's code checks), in order, at most `maxSearches`: while the story
 * neither reports the response nor has facts covering it, the two `response` searches first, then
 * the gap list's searches for the other needed, uncovered slots. A repeated query runs once. On a
 * story with earlier runs (`made`), a query they made and a `response` angle they searched are
 * skipped and listed, and take no place among the `maxSearches`.
 */
export function planSearches(
  gap: GapList,
  story: { title: string; text: string },
  made: Pick<EarlierWork, 'queries' | 'angles'> = NO_EARLIER_WORK,
  maxSearches: number = config.storyContext.maxSearches,
) {
  const slot = new Map(gap.slots.map(s => [s.slot, s]))
  const covered = (s: ContextSlot) => slot.get(s)?.covered ?? 'no'
  const quote = gap.responseInStory.trim()
  const storyReports = quote !== '' && supportFound(quote, story.text)
  const responseOpen = !storyReports && covered('response') !== 'yes'
  const madeQueries = new Set(made.queries.map(normalizedQuery))
  const seen = new Set<string>()
  const skipped: { slot: ContextSlot; query: string }[] = []
  const fresh = (s: PlannedSearch) => {
    const key = normalizedQuery(s.query)
    if (!key || seen.has(key)) return false
    seen.add(key)
    if (madeQueries.has(key) || (s.angle !== undefined && made.angles.includes(s.angle))) {
      skipped.push({ slot: s.slot, query: s.query })
      return false
    }
    return true
  }
  const title = story.title.split(/\s+/).filter(Boolean)
  const fallbacks = new Set<string>()
  const response = (responseOpen ? RESPONSE_ANGLES : []).map((a): PlannedSearch => {
    const given = gap.responseSearches[a.angle].trim()
    const query = given || a.fallback(title).join(' ')
    if (!given) fallbacks.add(query)
    return { slot: 'response', wanted: a.wanted, query, angle: a.angle, recent: false }
  })
  const others = gap.searches.filter(s => (slot.get(s.slot)?.needed ?? false) && covered(s.slot) !== 'yes')
  const searches = [...response, ...others].filter(fresh).slice(0, maxSearches)
  return {
    searches,
    skipped,
    storyReports: storyReports ? quote : null,
    fallback: searches.some(s => fallbacks.has(s.query)),
    responseSearched: searches.some(s => s.slot === 'response'),
    /** Searched for this run, or skipped as an earlier run searched it. */
    responseLookedFor: searches.some(s => s.slot === 'response') || skipped.some(s => s.slot === 'response'),
  }
}

const asCandidate = (r: ContextSearchAnswer['results'][number]): CandidateSource => ({
  origin: 'search',
  url: r.url,
  title: r.title,
  outlet: '',
  date: r.date,
  passages: r.text,
  rawContent: null,
  favicon: null,
})

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/** A step call as the stages make it, recorded and its answer unescaped (`stepCaller`). */
export type ContextStepCall = <T>(
  step: ContextStep,
  schema: z.ZodType<T>,
  prompt: Prompt,
) => Promise<{ parsed: T | null; outcome: LlmCallOutcome; model: string; transient?: boolean }>

/** The stages' caller: each call recorded in `calls`, its answer unescaped (the prompts escape every fetched text, and the model copies the escapes). */
export function stepCaller(call: ContextCall, calls: ContextCallRecord[]): ContextStepCall {
  return async (step, schema, prompt) => {
    const res = await call(step, schema, prompt)
    calls.push({ step, outcome: res.outcome, usage: res.usage, costUsd: res.costUsd, model: res.model })
    return { parsed: res.parsed === null ? null : unescapeXmlDeep(res.parsed), outcome: res.outcome, model: res.model, transient: res.transient }
  }
}

/** A run's record before its first step. */
export function emptyContextRecord(optOutChecked: boolean): ContextRunRecord {
  return {
    slots: [],
    responseInStory: null,
    responseFallback: false,
    searches: [],
    skippedSearches: [],
    sourceDrops: [],
    extractionDrops: [],
    facts: { research: 0, leftOut: 0, search: 0, reused: 0, carried: 0, supported: 0, rejected: 0, unjudged: 0 },
    droppedFacts: [],
    boxDrops: [],
    numberHints: [],
    responseNotFound: false,
    tally: { checked: 0, failed: 0 },
    calls: [],
    optOutChecked,
  }
}

/** What a failed stage leaves to store: our own step messages and Tavily's sanitized ones, and whether a later attempt may pass. */
export function contextFailure(err: unknown, transient?: (err: unknown) => boolean): { error: string; transient: boolean } {
  return { error: errorText(err), transient: err instanceof Stop ? err.transient : (transient?.(err) ?? false) }
}

/** A fact to structure (step 2): research's statement and sentence, and its source as the prompt shows it. */
export interface FactToStructure {
  id: string
  statement: string
  supportingSentence: string
  measures: string
  source: { outlet: string; date: string | null; kind: string }
}

/** Step 2: each fact's structured fields, by its id, answers for ids not asked ignored; no call for none. A failed call throws. */
export async function structureFacts(
  facts: FactToStructure[],
  call: ContextStepCall,
): Promise<{ answers: Map<string, ReturnType<typeof structured>>; model: string }> {
  const answers = new Map<string, ReturnType<typeof structured>>()
  if (facts.length === 0) return { answers, model: '' }
  const asked = new Set(facts.map(f => f.id))
  const res = await call('structure', structureSchema, buildStructurePrompt({ facts }))
  for (const a of required(res, 'structure').facts) if (asked.has(a.id) && !answers.has(a.id)) answers.set(a.id, structured(a))
  return { answers, model: res.model }
}

export interface GapStageInput {
  story: StoryText
  /** The story's text the response check looks in. */
  storyText: string
  title: string
  summary: string
  storyDay: string
  /** The facts the gap list reads. */
  facts: ContextFactData[]
  /** Pages not picked again: those known, their domains, and those read before. */
  known: { urls: string[]; domains: string[]; read: string[] }
  /** The searches the gap list leaves (`planSearches`, with what was searched before skipped). */
  plan: (gap: GapList, story: { title: string; text: string }) => ReturnType<typeof planSearches>
  /** The number the first new source takes (`S<n>`). */
  firstSource: number
}

export interface GapStageResult {
  gap: GapList
  plan: ReturnType<typeof planSearches>
  /** The search facts extracted, unchecked. */
  facts: ContextFactData[]
}

/**
 * Steps 3-7: the gap list, the searches it leaves, the opt-out and source filter, one extraction per
 * new source. Every search is waited for: one that failed after its retries throws, but those that
 * completed were billed, so their credits are added to `spent` and their records kept first.
 */
export async function gapStage(
  input: GapStageInput,
  deps: Pick<ContextDeps, 'search' | 'sourcePolicy'>,
  call: ContextStepCall,
  record: ContextRunRecord,
  spent: { credits: number },
): Promise<GapStageResult> {
  const windows = WINDOWS()
  const gapFacts = input.facts.map(f => ({ id: f.ref, text: renderFact(f), current: isCurrent({ ...f, sourceDate: f.source.date }, input.storyDay, windows) }))
  const gap = required(await call('gap-list', gapListSchema, buildGapListPrompt({ story: input.story, facts: gapFacts })), 'gap-list')
  record.slots = gap.slots
  const plan = input.plan(gap, { title: input.title, text: input.storyText })
  record.responseInStory = plan.storyReports
  record.responseFallback = plan.fallback
  record.skippedSearches = plan.skipped

  const facts: ContextFactData[] = []
  if (plan.searches.length === 0) return { gap, plan, facts }
  const settled = await Promise.allSettled(plan.searches.map(s => deps.search({ query: s.query, recent: s.recent, endDate: input.storyDay })))
  const completed = settled.flatMap((r, i) => (r.status === 'fulfilled' ? [{ i, answer: r.value }] : []))
  const searchRecord = (i: number, answer: ContextSearchAnswer, kept: string[]): SearchRecord => ({
    ...plan.searches[i]!,
    cached: answer.cached,
    credits: answer.credits,
    results: answer.results.length,
    kept,
  })
  spent.credits += completed.reduce((sum, { answer }) => sum + answer.credits, 0)
  record.searches = completed.map(({ i, answer }) => searchRecord(i, answer, []))
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failure) throw failure.reason
  const found = completed.map(({ answer }) => answer)
  const allowed = await Promise.all(
    found.map(async (a, i) => {
      const { search, dropped } = await dropOptedOut({ own: [], search: a.results.map(asCandidate) }, deps.sourcePolicy)
      record.sourceDrops.push(...dropped.map(d => ({ url: d.url, search: i, reason: 'opt-out' as const })))
      const urls = new Set(search.map(c => c.url))
      return { results: a.results.filter(r => urls.has(r.url)) }
    }),
  )
  const { picked, drops } = pickNewSources(allowed, input.known)
  record.sourceDrops.push(...drops)
  const kept = (i: number) => picked.filter(p => p.search === i).map(p => p.result.url)
  record.searches = completed.map(({ i, answer }) => searchRecord(i, answer, kept(i)))

  const wanted = plan.searches.map(s => ({ slot: s.slot, wanted: s.wanted }))
  const extracted = await Promise.all(
    picked.map(async (p, k) => {
      const id = `S${input.firstSource + k}`
      const res = await call(
        'extract',
        contextExtractionSchema,
        buildContextExtractionPrompt({
          story: { title: input.title, summary: input.summary },
          wanted,
          source: { outlet: domainOf(p.result.url), url: p.result.url, date: publishedDay(p.result.date), title: p.result.title, text: p.result.text },
        }),
      )
      return { id, p, res }
    }),
  )
  for (const { id, p, res } of extracted) {
    if (res.parsed === null) {
      record.extractionDrops.push({ url: p.result.url, reason: res.outcome })
      continue
    }
    if (!res.parsed.usable) {
      record.extractionDrops.push({ url: p.result.url, reason: 'unusable' })
      continue
    }
    const source: FactSource = {
      id,
      url: p.result.url,
      outlet: res.parsed.outlet.trim() || domainOf(p.result.url),
      title: p.result.title,
      date: publishedDay(p.result.date),
      kind: res.parsed.kind,
    }
    res.parsed.facts.slice(0, 5).forEach((f, j) => {
      // Step 7: a fact without a statement or a sentence fails its structure
      if (!f.statement.trim() || !f.supportingSentence.trim()) {
        record.facts.leftOut++
        return
      }
      facts.push({
        ref: `${id}F${j + 1}`,
        origin: 'search',
        reusedFromId: null,
        slot: f.slot,
        source,
        supportingSentence: f.supportingSentence,
        passage: passageAround(p.result.text, f.supportingSentence),
        supportFound: supportFound(f.supportingSentence, p.result.text),
        statement: f.statement,
        ...structured(f),
        ...unverified,
        model: res.model,
        promptVersion: CONTEXT_PROMPT_VERSIONS.extract,
      })
    })
  }
  record.facts.search = facts.length
  return { gap, plan, facts }
}

/** Step 8: the fact check, research's prompt, at most `checkBatchSize` items a call; each fact with its verdict, counted and its drops recorded. */
export async function checkFacts(toCheck: ContextFactData[], call: ContextStepCall, record: ContextRunRecord): Promise<ContextFactData[]> {
  const verdictOf = new Map<string, { verdict: ContextFactData['verdict']; problem: string | null }>()
  const checkedTexts = new Map<string, string>()
  for (const batch of chunks(toCheck, config.storyContext.checkBatchSize)) {
    const items = factCheckItems(batch)
    for (const it of items) {
      checkedTexts.set(it.item.factIds[0]!, it.item.text)
      if (it.numberHints.length > 0) record.numberHints.push({ label: it.item.label, numbers: it.numberHints })
    }
    const answer: FactCheck = required(await call('fact-check', factCheckSchema, buildFactCheckPrompt(promptItems(items), [], [])), 'fact-check')
    for (const [ref, v] of factVerdicts(answer, items)) verdictOf.set(ref, v)
  }
  const facts: ContextFactData[] = toCheck.map(f => {
    const v = verdictOf.get(f.ref) ?? { verdict: 'unjudged' as const, problem: null }
    return { ...f, verdict: v.verdict, verdictProblem: v.problem }
  })
  for (const f of facts) {
    record.facts[f.verdict]++
    if (f.verdict !== 'supported')
      record.droppedFacts.push({ ref: f.ref, text: checkedTexts.get(f.ref) ?? renderFact(f), verdict: f.verdict, problem: f.verdictProblem })
  }
  return facts
}

export interface BoxStageInput {
  story: StoryText
  layout: StoryLayout
  storyDay: string
  /** The facts the cards may cite: supported, current or not. */
  supported: ContextFactData[]
  slots: GapList['slots']
  responseInStory: boolean
  /** Each source's voices, by source id, for the copying check. */
  voices: ReadonlyMap<string, WordingSource['voices']>
}

export interface BoxStageResult {
  boxes: DraftBox[]
  writer: { model: string; promptVersion: string } | null
  structural: number
  judged: number
  failed: number
}

/** Steps 9-11: the write, the box code checks and the box check, no repair (ADR-0061). No facts, no write. */
export async function writeBoxes(input: BoxStageInput, call: ContextStepCall, record: ContextRunRecord): Promise<BoxStageResult> {
  if (input.supported.length === 0) return { boxes: [], writer: null, structural: 0, judged: 0, failed: 0 }
  const windows = WINDOWS()
  const factMap = new Map(input.supported.map(f => [f.ref, f]))
  const write = await call(
    'write',
    boxesSchema,
    buildBoxesPrompt({
      story: input.story,
      facts: input.supported.map(f => ({
        id: f.ref,
        text: renderFact(f),
        outlet: f.source.outlet,
        date: f.source.date,
        current: isCurrent({ ...f, sourceDate: f.source.date }, input.storyDay, windows),
      })),
      needed: input.slots.filter(s => s.needed || s.slot === 'response').map(s => ({ slot: s.slot, covered: s.covered })),
      responseInStory: input.responseInStory,
    }),
  )
  const writer = { model: write.model, promptVersion: CONTEXT_PROMPT_VERSIONS.write }
  const structural = structuralBoxes(required(write, 'write'), new Set(factMap.keys()), layoutSpots(input.layout))
  const resolved = resolveVisuals(structural.boxes, factMap, input.storyDay, windows)
  record.boxDrops.push(...structural.drops, ...resolved.drops)
  const items = boxCheckItems(resolved.boxes, factMap, input.storyDay, windows)
  for (const it of items) if (it.checked.numberHints.length > 0) record.numberHints.push({ label: it.checked.item.label, numbers: it.checked.numberHints })
  const wording = wordingSources(input.supported, input.voices)
  const lines = sourceLines(wording)
  const answers: { answer: FactCheck; items: BoxItem[] }[] = []
  for (const batch of chunks(items, config.storyContext.checkBatchSize)) {
    const answer = required(await call('box-check', factCheckSchema, buildFactCheckPrompt(promptItems(batch.map(b => b.checked)), lines, [])), 'box-check')
    answers.push({ answer, items: batch })
  }
  const verdicts = applyBoxVerdicts(resolved.boxes, items, answers, lines, boxCopying(resolved.boxes, wording, config.research.copiedRunWords))
  record.boxDrops.push(...verdicts.drops)
  return { boxes: verdicts.boxes, writer, structural: structural.structural, judged: verdicts.judged, failed: verdicts.failed }
}

/** Step 12: `response` looked for and the story does not report it, and nothing sourced answers it. The run records it; no card says so (owner decision 2026-11-17, ADR-0065). */
export const responseNotFound = (
  plan: Pick<ReturnType<typeof planSearches>, 'responseLookedFor' | 'storyReports'>,
  facts: ContextFactData[],
  boxes: DraftBox[],
): boolean =>
  plan.responseLookedFor &&
  plan.storyReports === null &&
  !(facts.some(f => f.slot === 'response' && f.verdict === 'supported') || boxes.some(b => b.type === 'response'))

export async function buildStoryContext(input: ContextInput, deps: ContextDeps): Promise<StoryContextResult> {
  const record = emptyContextRecord(deps.sourcePolicy !== undefined)
  const calls = record.calls
  const spent = { credits: 0 }
  const totals = () => ({ credits: spent.credits, modelUsd: calls.reduce((sum, c) => sum + c.costUsd, 0), record })
  const call = stepCaller(deps.call, calls)

  const research = input.sources.flatMap(s => s.facts.map(f => ({ s, f })))
  if (research.length === 0)
    return { status: 'skipped', outcome: 'no-research', facts: [], boxes: [], writer: null, error: null, transient: false, ...totals() }

  const story: StoryText = {
    title: input.title,
    date: input.storyDay,
    paragraphs: input.layout.paragraphs,
    points: input.layout.points,
    caveats: input.layout.caveats,
  }
  const storyText = [input.title, ...input.layout.paragraphs.map(p => p.text), ...input.layout.points.map(p => p.text), ...input.layout.caveats].join('\n')

  const earlier = input.earlier ?? NO_EARLIER_WORK
  // A research fact an earlier run of the story judged is neither structured nor checked again
  const judged = new Set(earlier.judged)
  const toStructure = research.filter(({ s, f }) => !judged.has(factKey({ url: s.url, ...f })))

  try {
    // Step 2: structure research's facts; answers only for the ids asked. None left: no call
    const { answers, model: structureModel } = await structureFacts(
      toStructure.map(({ s, f }) => ({ ...f, source: { outlet: s.outlet, date: publishedDay(s.date), kind: s.kind } })),
      call,
    )
    const pass1 = toStructure.flatMap(({ s, f }): ContextFactData[] => {
      const a = answers.get(f.id)
      if (!a) return []
      return [
        {
          ref: f.id,
          origin: 'research',
          reusedFromId: null,
          slot: null,
          source: sourceOf(s),
          supportingSentence: f.supportingSentence,
          passage: null,
          supportFound: f.found,
          statement: f.statement,
          ...a,
          ...unverified,
          model: structureModel,
          promptVersion: CONTEXT_PROMPT_VERSIONS.structure,
        },
      ]
    })
    record.facts.research = toStructure.length
    record.facts.leftOut = toStructure.length - pass1.length

    // The facts this story's earlier runs found, then step 1's reusable facts: each page under a new
    // id after research's, neither checked again; stored with the run only when a kept box cites them
    let next = Math.max(...input.sources.map(s => sourceNumber(s.id)), 0) + 1
    const offeredIds = new Map<string, string>()
    const offeredCount = new Map<string, number>()
    const offered = (f: ReusableFact): ContextFactData => {
      const key = f.source.url
      if (!offeredIds.has(key)) offeredIds.set(key, `S${next++}`)
      const id = offeredIds.get(key)!
      const n = (offeredCount.get(id) ?? 0) + 1
      offeredCount.set(id, n)
      const { id: earlierId, ...rest } = f
      return { ...rest, ref: `${id}F${n}`, reusedFromId: f.reusedFromId ?? earlierId, source: { ...f.source, id }, verdict: 'supported', verdictProblem: null }
    }
    const carried = earlier.facts.map(offered)
    const reused = [...carried, ...input.reusable.map(offered)]
    record.facts.carried = carried.length
    record.facts.reused = reused.length - carried.length

    // Steps 3-7: the gap list, the searches it leaves, filter, extract
    const {
      gap,
      plan,
      facts: pass2,
    } = await gapStage(
      {
        story,
        storyText,
        title: input.title,
        summary: input.summary,
        storyDay: input.storyDay,
        facts: [...pass1, ...reused],
        known: {
          urls: [...input.sources.map(s => s.url), ...reused.map(f => f.source.url)],
          domains: input.sources.map(s => domainOf(s.url)),
          read: earlier.read,
        },
        plan: (gap, text) => planSearches(gap, text, earlier),
        firstSource: next,
      },
      deps,
      call,
      record,
      spent,
    )

    // Step 8: the fact check
    const facts = await checkFacts([...pass1, ...pass2], call, record)

    // Steps 9-11: the write, the box code checks and the box check
    const supported = [...facts.filter(f => f.verdict === 'supported'), ...reused]
    const {
      boxes,
      writer,
      structural: boxStructural,
      judged: boxJudged,
      failed: boxFailed,
    } = await writeBoxes(
      {
        story,
        layout: input.layout,
        storyDay: input.storyDay,
        supported,
        slots: gap.slots,
        responseInStory: plan.storyReports !== null,
        voices: new Map(input.sources.map(s => [s.id, s.voices])),
      },
      call,
      record,
    )

    // Step 12: the response searched for (this run, or an earlier one) and nothing sourced answers it
    record.responseNotFound = responseNotFound(plan, facts, boxes)

    // The reused facts a kept box cites are stored with this run, so its boxes resolve within it
    const cited = new Set(boxes.flatMap(boxRefs))
    const stored = [...facts, ...reused.filter(f => cited.has(f.ref))]
    record.tally = itemTally({
      supported: record.facts.supported,
      rejected: record.facts.rejected,
      unjudged: record.facts.unjudged,
      leftOut: record.facts.leftOut,
      boxStructural,
      boxJudged,
      boxFailed,
    })
    return { status: 'completed', outcome: boxes.length > 0 ? 'built' : 'none-kept', facts: stored, boxes, writer, error: null, transient: false, ...totals() }
  } catch (err) {
    return { status: 'failed', outcome: 'technical', facts: [], boxes: [], writer: null, ...contextFailure(err, deps.transient), ...totals() }
  }
}
