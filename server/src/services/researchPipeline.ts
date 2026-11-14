/**
 * The research steps for one story (design, "The pipeline", steps 1-8; `.context/story-research.md`):
 * own sources with the neighbours production's dedup prompt confirms, queries, Tavily, publishers'
 * opt-outs and the deterministic filter, one extraction per source, earlier coverage, the
 * re-assess-and-write call, then the citation and copying checks, the fact check, the repair rounds
 * on the failing items alone and the gate. No I/O of its own: model calls, searches, the budget and the opt-out policy are injected
 * (`services/researchCalls.ts` in production, the eval context in eval:research). It writes nothing.
 */
import type { z } from 'zod'
import { config } from '../config.js'
import type { LlmCallOutcome, LlmTokenUsage } from '../lib/llmUsage.js'
import type { TavilyResult, TavilySearch } from '../lib/tavily.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { buildDedupPrompt } from '../prompts/dedup.js'
import {
  buildDerivePrompt,
  buildEarlierPrompt,
  buildExtractionPrompt,
  buildFactCheckPrompt,
  buildQueriesPrompt,
  buildRepairPrompt,
  buildWritePrompt,
  queryCount,
  type CheckedItem,
  type WriteInput,
} from '../prompts/research.js'
import { dedupConfirmationSchema } from '../schemas/llm.js'
import {
  deriveSchema,
  earlierSchema,
  extractionSchema,
  factCheckSchema,
  queriesSchema,
  repairSchema,
  writeSchema,
  type Draft,
  type Earlier,
  type Extraction,
  type FactCheck,
} from '../schemas/research.js'
import {
  checkCitations,
  checkedItems,
  decideGate,
  dropFailing,
  judgedProblems,
  publishedFact,
  supportFound,
  unjudgedLabels,
  withoutInlineIds,
  type CitationProblem,
  type FallbackCategory,
  type GateVerdict,
  type PoolFact,
} from './researchChecks.js'
import { checkCopying, sourceLines, type LongestRun } from './researchCopying.js'
import { checkedQuote, quoteProblems, withoutFailedQuote } from './researchQuote.js'
import { afterRecheck, derivableLabels, repairTargets, storyItems, withDerived, withRepairs } from './researchRepair.js'
import {
  anchorDate,
  domainOf,
  dropOptedOut,
  filterCandidates,
  keepExtracted,
  searchWindow,
  type CandidateSource,
  type DropReason,
  type ExtractDropReason,
  type SearchWindow,
  type SourcePolicy,
} from './researchFilter.js'
import type { EarlierStory, ResearchStory, SourceText } from './researchInput.js'

/**
 * The steps, each recorded with its calls. `rewrite` is a repair round (since 2026-11-13; before,
 * the one rewrite of the whole draft), `derive` a title, summary or blurb written again from the kept story.
 */
export const STEPS = ['confirm', 'queries', 'extract', 'earlier', 'write', 'fact-check', 'rewrite', 'derive'] as const
export type StepName = (typeof STEPS)[number]

/** The model tier each step runs on (production resolves it through `config.llm.models`). */
export const STEP_TIERS: Record<StepName, 'small' | 'medium'> = {
  confirm: 'small',
  queries: 'small',
  extract: 'small',
  earlier: 'small',
  write: 'medium',
  'fact-check': 'small',
  rewrite: 'medium',
  derive: 'medium',
}

export type StepOutcome = LlmCallOutcome
export type StepUsage = LlmTokenUsage

/** The article text the queries prompt reads. */
const QUERY_CONTENT_CHARS = 2000
const MAX_FACTS_PER_SOURCE = 8
const MAX_VOICES_PER_SOURCE = 4
const MAX_FACTS_PER_EARLIER = 3

export interface StepCall {
  step: StepName
  outcome: StepOutcome
  usage: StepUsage
  costUsd: number
  /** The model id that answered (or would have answered a skipped call). */
  model: string
}

/** What one step call returned; `parsed` is null unless the outcome is `ok`. */
export interface StepResult<T> {
  parsed: T | null
  outcome: StepOutcome
  usage: StepUsage
  costUsd: number
  model: string
}

/** One metered structured-output call for a step. A `skipped` outcome means the budget is used up. */
export type ResearchCall = <T>(step: StepName, schema: z.ZodType<T>, prompt: string) => Promise<StepResult<T>>

export interface ResearchSearchAnswer {
  results: TavilyResult[]
  credits: number
  /** Answered from the eval's cache; production never caches. */
  cached?: boolean
}

/** A call a batch is about to make, for the budget check before the batch starts. */
export interface PlannedStep {
  step: StepName
  prompt: string
}

/** Thrown by a search the budget refuses; the run ends as `fallback: budget`. */
export class BudgetExhaustedError extends Error {
  constructor() {
    super('budget')
    this.name = 'BudgetExhaustedError'
  }
}

export interface SearchRecord {
  query: string
  language: string
  results: number
  credits: number
  cached: boolean
}

export type ResearchOrigin = 'original' | CandidateSource['origin']

export type ResearchFact = PoolFact & { found: boolean }

export interface ResearchSource {
  /** `S0` is the original article. */
  id: string
  origin: ResearchOrigin
  url: string
  title: string
  outlet: string
  date: string | null
  favicon: string | null
  usedRawContent: boolean
  kind: Extraction['kind']
  country: string
  relation: Extraction['relation']
  facts: ResearchFact[]
  voices: Extraction['voices']
}

export interface ResearchEarlier {
  id: string
  storyId: string
  slug: string | null
  title: string
  date: string
  relation: Earlier['stories'][number]['relation']
  facts: ResearchFact[]
}

export type DropKind = DropReason | ExtractDropReason | 'extraction-failed'

/** What one pass of the checks found, recorded for the shadow week's tally (`.context/story-research.md`, "Own words"). */
export interface CheckPass {
  problems: CitationProblem[]
  /** Each item's longest run of words shared with each outside source, per kind, below the threshold too. */
  longestRuns: LongestRun[]
  /** The items the fact check's answer left out: no support or copying verdict from it, the code checks only. */
  unjudged: string[]
  /** The items whose numbers the code did not find in their evidence, each with those numbers: the hints the fact check judged (ADR-0057). */
  numberHints: { label: string; numbers: string[] }[]
  /** A repair round's or the derived fields' pass: the items it checked again, the rest kept from before. Absent on the first pass, which checks every item. */
  rechecked?: string[]
}

export interface StoryResearch {
  storyId: string
  calls: StepCall[]
  /** Tavily credits of this story's searches, cached answers included (what the research costs). */
  credits: number
  searches: SearchRecord[]
  /** Own sources and search results the filter saw. */
  candidates: number
  drops: Partial<Record<DropKind, number>>
  sources: ResearchSource[]
  earlier: ResearchEarlier[]
  /** The last draft checked, also when it failed the check. */
  draft: Draft | null
  /** Whether a repair was asked for: a repair round's or the derived fields' call ran (not skipped by the budget), whatever it answered. */
  rewritten: boolean
  /** What the checks found in each item as it stands, its last pass's problems; empty for a draft that passed. */
  problems: CitationProblem[]
  /** One entry per check pass: the first draft's, then each repair round's and the derived fields', which recheck their items alone. */
  checks: CheckPass[]
  /** The item a `draft_failed_check` fallback failed on (`dropFailing`); null otherwise. */
  failedOn: string | null
  /** Supporting sentences found in their source text, of all facts. */
  support: { facts: number; found: number }
  /** Whether publishers' AI opt-outs were checked (a `sourcePolicy` was given). */
  optOutChecked: boolean
  verdict: GateVerdict
}

export interface ResearchDeps {
  call: ResearchCall
  tavily: { search(request: TavilySearch): Promise<ResearchSearchAnswer> }
  /**
   * Whether a batch of parallel calls (the extractions beside the earlier-coverage call) may start,
   * judged against the batch's estimate. Unset: always. Refused, the run ends as `fallback: budget`.
   */
  admit?: (batch: PlannedStep[]) => Promise<boolean>
  /** Publish bar for the gate (`config.selection.relevanceMin`). */
  relevanceMin: number
  /** Caps the search window's end (the eval's sampling time). */
  latestDate?: string
  /** Publishers' AI opt-outs, applied to own and search candidates before the filter. Unset: not checked. */
  sourcePolicy?: SourcePolicy
}

/** Ends a story's research early; its message is the fallback reason, recorded with its category (`technical` unless the stop says otherwise). */
class Stop extends Error {
  constructor(
    reason: string,
    readonly category: FallbackCategory = 'technical',
  ) {
    super(reason)
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

interface StepAnswer<T> {
  parsed: T | null
  outcome: StepOutcome
}

type Call = <T>(step: StepName, schema: z.ZodType<T>, prompt: string) => Promise<StepAnswer<T>>

/** A budget skip ends the story; any other failure of a step the story cannot do without does too. */
function required<T>(res: StepAnswer<T>, step: StepName): T {
  if (res.outcome === 'skipped') throw new Stop('budget')
  if (res.parsed === null) throw new Stop(`${step}: ${res.outcome}`)
  return res.parsed
}

function optional<T>(res: StepAnswer<T>): T | null {
  if (res.outcome === 'skipped') throw new Stop('budget')
  return res.parsed
}

const ownCandidate =
  (origin: 'cluster' | 'neighbour') =>
  (s: SourceText): CandidateSource => ({
    origin,
    url: s.url,
    title: s.title,
    outlet: s.outlet,
    date: s.datePublished ?? s.dateCrawled,
    passages: s.content,
    rawContent: null,
    favicon: null,
    storyId: s.storyId,
  })

/** Step 1: the cluster members, and the ±14-day neighbours that production's dedup prompt confirms. */
async function ownSources(story: ResearchStory, call: Call): Promise<CandidateSource[]> {
  const cluster = story.clusterMembers.map(ownCandidate('cluster'))
  if (story.neighbours.length === 0) return cluster
  const prompt = buildDedupPrompt(
    { title: story.published.title, summary: story.published.summary },
    story.neighbours.map(n => ({ id: n.storyId, ...n.assessed })),
  )
  const parsed = optional(await call('confirm', dedupConfirmationSchema, prompt))
  const confirmed = new Set((parsed?.assessments ?? []).filter(a => a.isDuplicate).map(a => a.candidateNumber))
  return [...cluster, ...story.neighbours.filter((_, i) => confirmed.has(i + 1)).map(ownCandidate('neighbour'))]
}

/** Steps 2-3: the queries, and one Tavily search each. */
async function searchCoverage(
  story: ResearchStory,
  articleDate: string,
  window: SearchWindow,
  call: Call,
  deps: ResearchDeps,
  r: StoryResearch,
): Promise<CandidateSource[]> {
  const o = story.original
  const prompt = buildQueriesPrompt({
    title: o.title,
    content: o.content.slice(0, QUERY_CONTENT_CHARS),
    publisher: o.outlet,
    date: articleDate,
    language: o.language,
  })
  const queries = required(await call('queries', queriesSchema, prompt), 'queries')
    .queries.map(q => ({ query: q.query.trim(), language: q.language }))
    .filter(q => q.query !== '')
    .slice(0, queryCount(o.language))
  if (queries.length === 0) throw new Stop('queries: none written')

  const found: CandidateSource[] = []
  for (const q of queries) {
    let res: ResearchSearchAnswer
    try {
      res = await deps.tavily.search({ query: q.query, startDate: window.start, endDate: window.end })
    } catch (err) {
      throw new Stop(err instanceof BudgetExhaustedError ? 'budget' : `tavily: ${messageOf(err)}`)
    }
    r.credits += res.credits
    r.searches.push({ ...q, results: res.results.length, credits: res.credits, cached: res.cached ?? false })
    found.push(
      ...res.results.map(x => ({
        origin: 'search' as const,
        url: x.url,
        title: x.title,
        outlet: domainOf(x.url) || x.url,
        date: x.publishedDate,
        passages: x.content,
        rawContent: x.rawContent,
        favicon: x.favicon,
      })),
    )
  }
  return found
}

interface ExtractInput {
  origin: ResearchOrigin
  isOriginal: boolean
  url: string
  title: string
  outlet: string
  date: string | null
  favicon: string | null
  usedRawContent: boolean
  text: string
}

/** Longest outlet name a search source takes from its extraction; a longer answer is taken for a misreading. */
const MAX_OUTLET_CHARS = 60

/**
 * The name a source is shown under. A search result has only its address, so it takes the name the
 * extraction read from its page, else its domain; the original and our own sources keep their feed's name.
 */
function outletOf(s: ExtractInput, extracted: string): string {
  if (s.origin !== 'search') return s.outlet
  const name = extracted.replace(/\s+/g, ' ').trim()
  return name !== '' && name.length <= MAX_OUTLET_CHARS ? name : s.outlet
}

function researchSource(s: ExtractInput & { extraction: Extraction }, id: string): ResearchSource {
  const e = s.extraction
  return {
    id,
    origin: s.origin,
    url: s.url,
    title: s.title,
    outlet: outletOf(s, e.outlet),
    date: s.date,
    favicon: s.favicon,
    usedRawContent: s.usedRawContent,
    kind: e.kind,
    country: e.country,
    relation: e.relation,
    facts: e.facts.slice(0, MAX_FACTS_PER_SOURCE).map((f, j) => ({ id: `${id}F${j + 1}`, ...f, found: supportFound(f.supportingSentence, s.text) })),
    voices: e.voices.slice(0, MAX_VOICES_PER_SOURCE),
  }
}

/** Step 6's kept stories in candidate order, numbered E1…, each with at most three facts. */
function earlierPool(candidates: EarlierStory[], parsed: Earlier | null): ResearchEarlier[] {
  const seen = new Set<number>()
  const kept = (parsed?.stories ?? [])
    .filter(s => s.relation !== 'unrelated' && s.facts.length > 0 && s.number >= 1 && s.number <= candidates.length)
    .filter(s => !seen.has(s.number) && Boolean(seen.add(s.number)))
    .sort((a, b) => a.number - b.number)
  return kept.map((s, i) => {
    const c = candidates[s.number - 1]!
    const id = `E${i + 1}`
    const text = `${c.summary}\n${c.relevanceSummary}\n${c.whyItMatters}`
    return {
      id,
      storyId: c.id,
      slug: c.slug,
      title: c.title,
      date: c.datePublished.slice(0, 10),
      relation: s.relation,
      facts: s.facts
        .slice(0, MAX_FACTS_PER_EARLIER)
        .map((f, j) => ({ id: `${id}F${j + 1}`, ...f, measures: '', found: supportFound(f.supportingSentence, text) })),
    }
  })
}

/**
 * Steps 5-6: one extraction per source (the original as S0) beside the earlier-coverage call, then
 * the pool. The calls run in parallel, so the batch is admitted as a whole before any starts.
 */
async function buildPool(
  story: ResearchStory,
  inputs: ExtractInput[],
  usedStoryIds: Set<string>,
  call: Call,
  deps: ResearchDeps,
  r: StoryResearch,
): Promise<void> {
  const brief = { title: story.published.title, summary: story.published.summary }
  const candidates = story.earlier.filter(e => !usedStoryIds.has(e.id))
  const earlierPrompt = buildEarlierPrompt({
    story: { ...brief, date: story.datePublished.slice(0, 10) },
    candidates: candidates.map(c => ({ ...c, date: c.datePublished.slice(0, 10) })),
  })
  const extractPrompts = inputs.map(s => buildExtractionPrompt({ story: brief, source: s }))
  const batch: PlannedStep[] = [
    ...extractPrompts.map(prompt => ({ step: 'extract' as const, prompt })),
    ...(candidates.length > 0 ? [{ step: 'earlier' as const, prompt: earlierPrompt }] : []),
  ]
  if (deps.admit && !(await deps.admit(batch))) throw new Stop('budget')
  const [extractions, earlier] = await Promise.all([
    Promise.all(extractPrompts.map(prompt => call('extract', extractionSchema, prompt))),
    candidates.length > 0 ? call('earlier', earlierSchema, earlierPrompt) : Promise.resolve<StepAnswer<Earlier>>({ parsed: null, outcome: 'ok' }),
  ])
  if ([...extractions, earlier].some(e => e.outcome === 'skipped')) throw new Stop('budget')
  required(extractions[0]!, 'extract')

  const judged = inputs.flatMap((s, i) => {
    const extraction = extractions[i]?.parsed
    if (extraction) return [{ ...s, extraction }]
    r.drops['extraction-failed'] = (r.drops['extraction-failed'] ?? 0) + 1
    return []
  })
  const { kept, dropped } = keepExtracted(judged)
  for (const d of dropped) r.drops[d.reason] = (r.drops[d.reason] ?? 0) + 1
  r.sources = kept.map((s, i) => researchSource(s, `S${i}`))
  r.earlier = earlierPool(candidates, optional(earlier))
  const facts = [...r.sources.flatMap(s => s.facts), ...r.earlier.flatMap(e => e.facts)]
  r.support = { facts: facts.length, found: facts.filter(f => f.found).length }
  // Other reports passed the filter; the extraction read and dropped them, unless every one of its calls failed
  if (r.sources.length < 2) throw new Stop('no usable source', judged.length > 1 ? 'not_confirmed' : 'technical')
}

/** What step 8's checks read besides the draft. */
interface CheckContext {
  facts: ReadonlyMap<string, PoolFact>
  sources: ResearchSource[]
  call: Call
}

/**
 * Step 8's checks: on the first draft every item, on a repair round's draft the rewritten items
 * alone (`labels`), so each failing item carries the fact check's key judgment. The deterministic
 * citation and copying checks, and one fact-check call that judges each item for support (those with
 * evidence or number hints; the title, summary and blurb against every fact of the pool, which the
 * prompt then holds once) and for copying against the outside sources' own words, and the key
 * quote, its last item, for faithfulness to the source it names (never for copying; one naming no
 * source of the run fails in code instead, and no call is made when nothing is left to judge). A
 * number the code does not find in an item's evidence, and a key quote whose words it does not find
 * in its source, are hints for that call, never problems by themselves. A problem only code finds is
 * never key. An item the answer leaves out is recorded as unjudged, and fails nothing. `skipped`
 * when the budget skipped the fact check.
 */
async function check(draft: Draft, ctx: CheckContext, labels?: ReadonlySet<string>): Promise<CheckPass | 'skipped'> {
  const lines = sourceLines(ctx.sources)
  const sourceIds = new Set(ctx.sources.map(s => s.id))
  const inScope = (label: string) => !labels || labels.has(label)
  const quote = checkedQuote(draft, lines, sourceIds)
  const items = [...checkedItems(draft, ctx.facts), ...(quote ? [quote] : [])].filter(c => inScope(c.item.label))
  const copying = checkCopying(
    items.map(({ item }) => item),
    ctx.sources,
    config.research.copiedRunWords,
  )
  const prompt = () =>
    buildFactCheckPrompt(
      items.map(({ item, evidence, againstPool, numberHints, quote }): CheckedItem => ({
        label: item.label,
        text: item.text,
        facts: againstPool ? 'pool' : evidence,
        numbersNotFound: numberHints,
        quote,
      })),
      lines,
      [...ctx.facts.values()],
    )
  const res: StepAnswer<FactCheck> = items.length === 0 ? { parsed: { items: [] }, outcome: 'ok' } : await ctx.call('fact-check', factCheckSchema, prompt())
  if (res.outcome === 'skipped') return 'skipped'
  const answer = required(res, 'fact-check')
  const coded = [...checkCitations(draft, ctx.facts), ...quoteProblems(draft, sourceIds)].filter(p => inScope(p.label))
  return {
    problems: [...coded, ...copying.problems, ...judgedProblems(answer, items, lines)],
    longestRuns: copying.longestRuns,
    unjudged: unjudgedLabels(answer, items),
    numberHints: items.filter(c => c.numberHints.length > 0).map(c => ({ label: c.item.label, numbers: c.numberHints })),
    ...(labels ? { rechecked: [...labels] } : {}),
  }
}

/** Keeps a rewritten draft once its `rewritten` items were checked again; false, keeping nothing, when the budget skipped that check. */
async function recheck(draft: Draft, rewritten: string[], ctx: CheckContext, r: StoryResearch): Promise<boolean> {
  const pass = await check(draft, ctx, new Set(rewritten))
  if (pass === 'skipped') return false
  r.draft = draft
  r.checks.push(pass)
  r.problems = afterRecheck(r.problems, { problems: pass.problems, rechecked: rewritten })
  return true
}

/**
 * A title, summary or blurb still failing on copying alone after the rounds, written again from the
 * kept story paragraphs alone, which hold no source's words, and checked once more; only when
 * nothing else ends the run. The draft as last checked.
 */
async function deriveFields(draft: Draft, ctx: CheckContext, r: StoryResearch): Promise<Draft> {
  const labels = derivableLabels(r.problems)
  if (labels.length === 0) return draft
  const rest = dropFailing(
    draft,
    r.problems.filter(p => !labels.includes(p.label)),
  )
  if ('failed' in rest) return draft
  const res = await ctx.call('derive', deriveSchema, buildDerivePrompt({ titleLabel: draft.titleLabel, paragraphs: rest.draft.story.map(p => p.text) }))
  if (res.outcome === 'skipped') return draft
  r.rewritten = true
  const derived = withDerived(draft, withoutInlineIds(required(res, 'derive')), labels)
  return derived.rewritten.length > 0 && (await recheck(derived.draft, derived.rewritten, ctx, r)) ? derived.draft : draft
}

/**
 * Targeted repair (owner decision 2026-11-13, ADR-0058): up to `config.research.repairRounds`
 * rounds, each rewriting only the items still failing, with their problems, and checking those
 * alone; an item that passed is frozen. A round whose answer changes nothing ends the rounds; a
 * call the budget skips ends the repair, and a repair it left unchecked is never kept. Then the
 * derived fields (`deriveFields`). The draft as last checked.
 */
async function repair(draft: Draft, input: WriteInput, ctx: CheckContext, r: StoryResearch): Promise<Draft> {
  let current = draft
  for (let round = 0; round < config.research.repairRounds && r.problems.length > 0; round++) {
    const targets = repairTargets(current, r.problems)
    const prompt = buildRepairPrompt({ sources: input.sources, earlier: input.earlier, story: storyItems(current), repairs: targets })
    const res = await ctx.call('rewrite', repairSchema, prompt)
    if (res.outcome === 'skipped') return current
    // Asked for once the call ran, whatever its answer: empty, unchanged or unparseable
    r.rewritten = true
    const repaired = withRepairs(current, withoutInlineIds(required(res, 'rewrite')), targets)
    if (repaired.rewritten.length === 0) break
    if (!(await recheck(repaired.draft, repaired.rewritten, ctx, r))) return current
    current = repaired.draft
  }
  return deriveFields(current, ctx, r)
}

/**
 * Steps 7-8: write and check every item, then repair the failing ones (`repair`). Paragraphs and
 * bullets that still fail are dropped (`r.problems` keeps them), unless `dropFailing` refuses, as it
 * does for a draft with nothing in a part even when it passed, for which no repair is asked; a key
 * quote that still fails is dropped too, and never ends the run. Each pass is kept in `r.checks`.
 */
async function writeChecked(input: WriteInput, facts: ReadonlyMap<string, PoolFact>, call: Call, r: StoryResearch): Promise<Draft> {
  const ctx: CheckContext = { facts, sources: r.sources, call }
  const draft = withoutInlineIds(required(await call('write', writeSchema, buildWritePrompt(input)), 'write'))
  r.draft = draft
  const first = await check(draft, ctx)
  if (first === 'skipped') throw new Stop('budget')
  r.checks.push(first)
  r.problems = first.problems
  // No repair gives a draft the part it has nothing in, and the run ends on it anyway
  const repaired = 'failed' in dropFailing(draft, []) ? draft : await repair(draft, input, ctx, r)
  const kept = dropFailing(repaired, r.problems)
  if ('failed' in kept) {
    r.failedOn = kept.failedOn
    throw new Stop(kept.failed, 'draft_failed_check')
  }
  r.draft = withoutFailedQuote(kept.draft, r.problems)
  return r.draft
}

async function research(story: ResearchStory, deps: ResearchDeps, call: Call, r: StoryResearch): Promise<Draft> {
  const o = story.original
  const articleDate = anchorDate(o.datePublished, o.dateCrawled).slice(0, 10)
  const window = searchWindow(articleDate, deps.latestDate)
  const own = await ownSources(story, call)
  const found = await searchCoverage(story, articleDate, window, call, deps, r)

  const allowed = await dropOptedOut({ own, search: found }, deps.sourcePolicy)
  const filtered = filterCandidates({ original: { url: o.url, text: o.content }, own: allowed.own, search: allowed.search, window })
  r.candidates = own.length + found.length
  for (const d of [...allowed.dropped, ...filtered.dropped]) r.drops[d.reason] = (r.drops[d.reason] ?? 0) + 1
  if (filtered.selected.length === 0) throw new Stop('no usable source', 'no_other_coverage')

  const inputs: ExtractInput[] = [
    {
      origin: 'original',
      isOriginal: true,
      url: o.url,
      title: o.title,
      outlet: o.outlet,
      // The anchored date, so S0 shows the same day the window and the old-news cutoff use.
      date: articleDate,
      favicon: null,
      usedRawContent: false,
      text: o.content,
    },
    ...filtered.selected.map(s => ({ ...s, isOriginal: false })),
  ]
  const used = new Set([story.id, ...filtered.selected.flatMap(s => (s.storyId ? [s.storyId] : []))])
  await buildPool(story, inputs, used, call, deps, r)

  const dated = [...r.sources.flatMap(s => publishedFact(s.id, s.outlet, s.date)), ...r.earlier.flatMap(e => publishedFact(e.id, 'Actually Relevant', e.date))]
  const facts = new Map([...r.sources.flatMap(s => s.facts), ...r.earlier.flatMap(e => e.facts), ...dated].map(f => [f.id, f]))
  return writeChecked({ article: story.assess, articleDate, oldBefore: window.start, sources: r.sources, earlier: r.earlier }, facts, call, r)
}

/** Runs steps 1-8 for one story. Never throws: a failed research is the `fallback` verdict with its reason and category. */
export async function researchStory(story: ResearchStory, deps: ResearchDeps): Promise<StoryResearch> {
  const r: StoryResearch = {
    storyId: story.id,
    calls: [],
    credits: 0,
    searches: [],
    candidates: 0,
    drops: {},
    sources: [],
    earlier: [],
    draft: null,
    rewritten: false,
    problems: [],
    checks: [],
    failedOn: null,
    support: { facts: 0, found: 0 },
    optOutChecked: deps.sourcePolicy !== undefined,
    verdict: { kind: 'fallback', reason: 'not run', category: 'technical' },
  }
  const call: Call = async (step, schema, prompt) => {
    const rec = await deps.call(step, schema, prompt)
    r.calls.push({ step, outcome: rec.outcome, usage: rec.usage, costUsd: rec.costUsd, model: rec.model })
    // The prompts escape every fetched text, and the model copies the escapes into its answer
    return { parsed: rec.outcome === 'ok' ? unescapeXmlDeep(rec.parsed) : null, outcome: rec.outcome }
  }
  try {
    r.verdict = decideGate({ draft: await research(story, deps, call, r) }, deps.relevanceMin)
  } catch (err) {
    const failed =
      err instanceof Stop ? { failed: err.message, category: err.category } : { failed: `error: ${messageOf(err)}`, category: 'technical' as const }
    r.verdict = decideGate(failed, deps.relevanceMin)
  }
  return r
}
