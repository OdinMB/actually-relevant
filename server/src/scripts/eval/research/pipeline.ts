/**
 * The research steps for one story (design, "The pipeline", steps 1-8): own sources with the
 * neighbours production's dedup prompt confirms, queries, Tavily, the deterministic filter, one
 * extraction per source, earlier coverage, the re-assess-and-write call, then the citation check,
 * the fact check, at most one rewrite and the gate. Model calls go through the eval context
 * (cache, ledger, budget, semaphore); nothing is written anywhere but its ledger.
 */
import type { z } from 'zod'
import { buildDedupPrompt } from '../../../prompts/dedup.js'
import { dedupConfirmationSchema } from '../../../schemas/llm.js'
import { arm, versionedSchemaName } from '../models.js'
import type { Arm, CallOutcome, SuiteContext, TokenUsage } from '../types.js'
import { checkCitations, decideGate, describeProblem, draftSentences, supportFound, type CitationProblem, type GateVerdict, type PoolFact } from './checks.js'
import {
  anchorDate,
  domainOf,
  filterCandidates,
  keepExtracted,
  searchWindow,
  type CandidateSource,
  type DropReason,
  type ExtractDropReason,
  type SearchWindow,
} from './filter.js'
import type { EarlierStory, ResearchStory, SourceText } from './fixtures.js'
import {
  buildEarlierPrompt,
  buildExtractionPrompt,
  buildFactCheckPrompt,
  buildQueriesPrompt,
  buildWritePrompt,
  queryCount,
  type WriteInput,
} from './prompts.js'
import { earlierSchema, extractionSchema, factCheckSchema, queriesSchema, writeSchema, type Draft, type Earlier, type Extraction } from './schemas.js'
import type { TavilyResponse, TavilySearch } from './tavily.js'

/** Production's tier defaults today (constants, never read from `config`, as in the rest of the eval). */
export const SMALL = arm('gpt-6-luna', 'low')
export const MEDIUM = arm('gpt-6-luna', 'medium')

export const STEPS = ['confirm', 'queries', 'extract', 'earlier', 'write', 'fact-check', 'rewrite'] as const
export type StepName = (typeof STEPS)[number]

export const STEP_ARMS: Record<StepName, Arm> = {
  confirm: SMALL,
  queries: SMALL,
  extract: SMALL,
  earlier: SMALL,
  write: MEDIUM,
  'fact-check': SMALL,
  rewrite: MEDIUM,
}

export interface StepEstimate {
  /** Tokens per researched story; output includes reasoning. */
  input: number
  output: number
  /** A row of the design's desk estimate ("Model cost: desk estimate, then measurement"). */
  inDesign: boolean
}

/**
 * The design's desk estimate per story, plus the two calls it has no row for: the neighbour
 * confirmation, and a rewrite (counted here with its second fact check).
 */
export const STEP_ESTIMATES: Record<StepName, StepEstimate> = {
  confirm: { input: 1500, output: 500, inDesign: false },
  queries: { input: 2000, output: 500, inDesign: true },
  extract: { input: 15000, output: 10000, inDesign: true },
  earlier: { input: 3000, output: 500, inDesign: true },
  write: { input: 12000, output: 4500, inDesign: true },
  'fact-check': { input: 5000, output: 1000, inDesign: true },
  rewrite: { input: 17000, output: 5500, inDesign: false },
}

const SCHEMA_NAMES = {
  confirm: versionedSchemaName('research-confirm', dedupConfirmationSchema),
  queries: versionedSchemaName('research-queries', queriesSchema),
  extract: versionedSchemaName('research-extract', extractionSchema),
  earlier: versionedSchemaName('research-earlier', earlierSchema),
  write: versionedSchemaName('research-write', writeSchema),
  'fact-check': versionedSchemaName('research-fact-check', factCheckSchema),
  rewrite: versionedSchemaName('research-write', writeSchema),
} satisfies Record<StepName, string>

/** The article text the queries prompt reads. */
const QUERY_CONTENT_CHARS = 2000
const MAX_FACTS_PER_SOURCE = 8
const MAX_VOICES_PER_SOURCE = 4
const MAX_FACTS_PER_EARLIER = 3

export interface StepCall {
  step: StepName
  outcome: CallOutcome
  usage: TokenUsage
  costUsd: number
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
  /** The last draft written, also when it failed the check. */
  draft: Draft | null
  rewritten: boolean
  /** What the last check found; empty for a draft that passed. */
  problems: CitationProblem[]
  /** Supporting sentences found in their source text, of all facts. */
  support: { facts: number; found: number }
  verdict: GateVerdict
}

export interface ResearchDeps {
  ctx: SuiteContext
  tavily: { search(request: TavilySearch): Promise<TavilyResponse> }
  /** Publish bar for the gate (`config.selection.relevanceMin`). */
  relevanceMin: number
  /** The fixtures' sampling time; caps the search window's end. */
  latestDate?: string
}

/** Ends a story's research early; its message is the fallback reason. */
class Stop extends Error {}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

interface StepResult<T> {
  parsed: T | null
  outcome: CallOutcome
}

type Call = <T>(step: StepName, schema: z.ZodType<T>, prompt: string) => Promise<StepResult<T>>

/** A budget skip ends the story; any other failure of a step the story cannot do without does too. */
function required<T>(res: StepResult<T>, step: StepName): T {
  if (res.outcome === 'skipped') throw new Stop('budget')
  if (res.parsed === null) throw new Stop(`${step}: ${res.outcome}`)
  return res.parsed
}

function optional<T>(res: StepResult<T>): T | null {
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
    let res: TavilyResponse
    try {
      res = await deps.tavily.search({ query: q.query, startDate: window.start, endDate: window.end })
    } catch (err) {
      throw new Stop(`tavily: ${messageOf(err)}`)
    }
    r.credits += res.credits
    r.searches.push({ ...q, results: res.results.length, credits: res.credits, cached: res.cached })
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

function researchSource(s: ExtractInput & { extraction: Extraction }, id: string): ResearchSource {
  const e = s.extraction
  return {
    id,
    origin: s.origin,
    url: s.url,
    title: s.title,
    outlet: s.outlet,
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

/** Steps 5-6: one extraction per source (the original as S0) beside the earlier-coverage call, then the pool. */
async function buildPool(story: ResearchStory, inputs: ExtractInput[], usedStoryIds: Set<string>, call: Call, r: StoryResearch): Promise<void> {
  const brief = { title: story.published.title, summary: story.published.summary }
  const candidates = story.earlier.filter(e => !usedStoryIds.has(e.id))
  const earlierPrompt = buildEarlierPrompt({
    story: { ...brief, date: story.datePublished.slice(0, 10) },
    candidates: candidates.map(c => ({ ...c, date: c.datePublished.slice(0, 10) })),
  })
  const [extractions, earlier] = await Promise.all([
    Promise.all(inputs.map(s => call('extract', extractionSchema, buildExtractionPrompt({ story: brief, source: s })))),
    candidates.length > 0 ? call('earlier', earlierSchema, earlierPrompt) : Promise.resolve<StepResult<Earlier>>({ parsed: null, outcome: 'ok' }),
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
  if (r.sources.length < 2) throw new Stop('no usable source')
}

/** Step 8's checks: the deterministic citation check, then (when it passes) the fact-check call. */
async function check(draft: Draft, facts: ReadonlyMap<string, PoolFact>, call: Call): Promise<CitationProblem[]> {
  const problems = checkCitations(draft, facts)
  if (problems.length > 0) return problems
  const cited = draftSentences(draft).filter(s => s.factIds.length > 0)
  if (cited.length === 0) return []
  const prompt = buildFactCheckPrompt(cited.map(s => ({ text: s.text, facts: s.factIds.flatMap(id => facts.get(id) ?? []) })))
  const verdicts = required(await call('fact-check', factCheckSchema, prompt), 'fact-check')
  return verdicts.sentences.flatMap(v => {
    const s = cited[v.number - 1]
    return !v.supported && s ? [{ label: s.label, text: s.text, problem: `fails the fact check: ${v.problem || 'its cited facts do not state it'}` }] : []
  })
}

/** Steps 7-8: write, check, and on a failure one rewrite with the problems and one more check. */
async function writeChecked(input: WriteInput, facts: ReadonlyMap<string, PoolFact>, call: Call, r: StoryResearch): Promise<Draft> {
  r.draft = required(await call('write', writeSchema, buildWritePrompt(input)), 'write')
  r.problems = await check(r.draft, facts, call)
  if (r.problems.length === 0) return r.draft
  r.rewritten = true
  r.draft = required(await call('rewrite', writeSchema, buildWritePrompt({ ...input, problems: r.problems.map(describeProblem) })), 'rewrite')
  r.problems = await check(r.draft, facts, call)
  if (r.problems.length > 0) throw new Stop('check failed after one rewrite')
  return r.draft
}

async function research(story: ResearchStory, deps: ResearchDeps, call: Call, r: StoryResearch): Promise<Draft> {
  const o = story.original
  const articleDate = anchorDate(o.datePublished, o.dateCrawled).slice(0, 10)
  const window = searchWindow(articleDate, deps.latestDate)
  const own = await ownSources(story, call)
  const found = await searchCoverage(story, articleDate, window, call, deps, r)

  const filtered = filterCandidates({ original: { url: o.url, text: o.content }, own, search: found, window })
  r.candidates = own.length + found.length
  for (const d of filtered.dropped) r.drops[d.reason] = (r.drops[d.reason] ?? 0) + 1
  if (filtered.selected.length === 0) throw new Stop('no usable source')

  const inputs: ExtractInput[] = [
    {
      origin: 'original',
      isOriginal: true,
      url: o.url,
      title: o.title,
      outlet: o.outlet,
      date: o.datePublished,
      favicon: null,
      usedRawContent: false,
      text: o.content,
    },
    ...filtered.selected.map(s => ({ ...s, isOriginal: false })),
  ]
  const used = new Set([story.id, ...filtered.selected.flatMap(s => (s.storyId ? [s.storyId] : []))])
  await buildPool(story, inputs, used, call, r)

  const facts = new Map([...r.sources.flatMap(s => s.facts), ...r.earlier.flatMap(e => e.facts)].map(f => [f.id, f]))
  return writeChecked({ article: story.assess, articleDate, oldBefore: window.start, sources: r.sources, earlier: r.earlier }, facts, call, r)
}

/** Runs steps 1-8 for one story. Never throws: a failed research is the `fallback` verdict with its reason. */
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
    support: { facts: 0, found: 0 },
    verdict: { kind: 'fallback', reason: 'not run' },
  }
  const call: Call = async (step, schema, prompt) => {
    const rec = await deps.ctx.call(STEP_ARMS[step], SCHEMA_NAMES[step], schema, prompt)
    r.calls.push({ step, outcome: rec.outcome, usage: rec.usage, costUsd: rec.costUsd })
    return { parsed: rec.outcome === 'ok' ? rec.parsed : null, outcome: rec.outcome }
  }
  try {
    r.verdict = decideGate({ draft: await research(story, deps, call, r) }, deps.relevanceMin)
  } catch (err) {
    r.verdict = decideGate({ failed: err instanceof Stop ? err.message : `error: ${messageOf(err)}` }, deps.relevanceMin)
  }
  return r
}
