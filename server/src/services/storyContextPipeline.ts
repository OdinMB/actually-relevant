/**
 * One story's context, steps 2-12 (`.context/story-context.md`, "What one story goes through"):
 * structure research's facts, the gap list, the searches with the opt-out and source filter, one
 * extraction per new source, the fact check, the write, the box checks and the honest gap. No I/O
 * of its own, as `researchStory` has none: model calls, search and the opt-out policy are injected
 * (`storyContextRuns.ts` in production, the eval's deps in eval:overviews). It writes nothing.
 */
import { createHash } from 'node:crypto'
import { toJsonSchema } from '@langchain/core/utils/json_schema'
import type { z } from 'zod'
import { config } from '../config.js'
import type { LlmCallOutcome, LlmTokenUsage } from '../lib/llmUsage.js'
import { unescapeXmlDeep } from '../lib/xml.js'
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
import { sourceLines } from './researchCopying.js'
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
import { passageAround, pickNewSources, type ContextSearchAnswer, type ContextSearchRequest, type SourceDrop } from './storyContextSources.js'
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
}

export type ContextCall = <T>(step: ContextStep, schema: z.ZodType<T>, prompt: string) => Promise<ContextCallResult<T>>

export interface ContextDeps {
  call: ContextCall
  search(request: ContextSearchRequest): Promise<ContextSearchAnswer>
  /** Publishers' AI opt-outs, checked on every search result, cached ones included. Unset: not checked (recorded). */
  sourcePolicy?: SourcePolicy
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

/** An earlier story's supported, current context fact, offered again (step 1). */
export type ReusableFact = ContextFactData & { id: string }

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
  sourceDrops: SourceDrop[]
  /** Search sources whose extraction failed or found them unusable. */
  extractionDrops: { url: string; reason: 'unusable' | LlmCallOutcome }[]
  facts: { research: number; leftOut: number; search: number; reused: number; supported: number; rejected: number; unjudged: number }
  /** Each fact the check rejected or left unjudged, with its problem. */
  droppedFacts: { ref: string; text: string; verdict: 'rejected' | 'unjudged'; problem: string | null }[]
  boxDrops: BoxDrop[]
  numberHints: { label: string; numbers: string[] }[]
  honestGap: boolean
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
  /** The kept boxes in order, the honest gap last. */
  boxes: DraftBox[]
  /** The model and prompt version the boxes were written with; null without a write. */
  writer: { model: string; promptVersion: string } | null
  credits: number
  modelUsd: number
  record: ContextRunRecord
  /** Why the run failed, safe to store: our own step messages and Tavily's sanitized ones only. */
  error: string | null
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

const versionOf = (prompt: string, schema: z.ZodType) =>
  createHash('sha256')
    .update(prompt)
    .update(JSON.stringify(toJsonSchema(schema)))
    .digest('hex')
    .slice(0, 8)

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
class Stop extends Error {}

/** A failure safe to store: our own step messages and Tavily's sanitized ones, else the error's name. */
function errorText(err: unknown): string {
  if (err instanceof Stop) return err.message
  if (err instanceof Error && err.name === 'TavilyError') return err.message
  if (!(err instanceof Error)) return 'unexpected error'
  const code = (err as { code?: unknown }).code
  return `unexpected error (${err.name}${typeof code === 'string' ? ` ${code}` : ''})`
}

function required<T>(res: { parsed: T | null; outcome: LlmCallOutcome }, step: ContextStep): T {
  if (res.parsed === null) throw new Stop(`${step}: ${res.outcome}`)
  return res.parsed
}

const WINDOWS = (): ValidityWindows => ({ fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays })

const sourceNumber = (id: string) => Number(/^S(\d+)$/.exec(id)?.[1] ?? -1)

/** The structured fields as stored: an as-of read only when valid, nobody credited as null. */
function structured(
  a: StructuredFact,
): Pick<ContextFactData, 'value' | 'valueHigh' | 'unit' | 'approx' | 'provisional' | 'counted' | 'place' | 'asOf' | 'credited' | 'creditedKind' | 'validity'> {
  return {
    value: a.value,
    valueHigh: a.value !== null ? a.valueHigh : null,
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

/** The searches to make (step 3's code checks), in order, at most `maxSearches`. */
export function planSearches(gap: GapList, story: { title: string; text: string }) {
  const slot = new Map(gap.slots.map(s => [s.slot, s]))
  const covered = (s: ContextSlot) => slot.get(s)?.covered ?? 'no'
  const quote = gap.responseInStory.trim()
  const storyReports = quote !== '' && supportFound(quote, story.text)
  const responseOpen = !storyReports && covered('response') !== 'yes'
  const wanted = (s: ContextSlot) => (s === 'response' ? responseOpen : (slot.get(s)?.needed ?? false) && covered(s) !== 'yes')
  const seen = new Set<string>()
  let searches = gap.searches.filter(s => {
    const key = s.query.trim().toLowerCase()
    if (!key || seen.has(key) || !wanted(s.slot)) return false
    seen.add(key)
    return true
  })
  let fallback = false
  if (responseOpen) {
    const at = searches.findIndex(s => s.slot === 'response')
    if (at >= 0) searches = [searches[at]!, ...searches.filter((_, i) => i !== at)]
    else {
      const words = story.title.split(/\s+/).filter(Boolean).slice(0, 9)
      searches = [
        {
          slot: 'response',
          wanted: 'What is being done about the problem: responses under way, solutions tried, or what worked elsewhere.',
          query: [...words, 'response'].join(' '),
          recent: false,
        },
        ...searches,
      ]
      fallback = true
    }
  }
  searches = searches.slice(0, config.storyContext.maxSearches)
  return { searches, storyReports: storyReports ? quote : null, fallback, responseSearched: searches.some(s => s.slot === 'response') }
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

/** The cited fact refs of a box: its sentences', tiles' and chart points'. */
export function citedRefs(box: DraftBox): string[] {
  const v = box.visual
  const visual = !v ? [] : v.kind === 'tiles' ? v.tiles.flatMap(t => t.factIds) : [...v.points, ...(v.apart?.points ?? [])].map(p => p.factId)
  return [...new Set([...box.sentences.flatMap(s => s.factIds), ...visual])]
}

export async function buildStoryContext(input: ContextInput, deps: ContextDeps): Promise<StoryContextResult> {
  const windows = WINDOWS()
  const calls: ContextCallRecord[] = []
  const record: ContextRunRecord = {
    slots: [],
    responseInStory: null,
    responseFallback: false,
    searches: [],
    sourceDrops: [],
    extractionDrops: [],
    facts: { research: 0, leftOut: 0, search: 0, reused: 0, supported: 0, rejected: 0, unjudged: 0 },
    droppedFacts: [],
    boxDrops: [],
    numberHints: [],
    honestGap: false,
    tally: { checked: 0, failed: 0 },
    calls,
    optOutChecked: deps.sourcePolicy !== undefined,
  }
  let credits = 0
  const totals = () => ({ credits, modelUsd: calls.reduce((sum, c) => sum + c.costUsd, 0), record })
  const call = async <T>(step: ContextStep, schema: z.ZodType<T>, prompt: string) => {
    const res = await deps.call(step, schema, prompt)
    calls.push({ step, outcome: res.outcome, usage: res.usage, costUsd: res.costUsd, model: res.model })
    return { parsed: res.parsed === null ? null : unescapeXmlDeep(res.parsed), outcome: res.outcome, model: res.model }
  }

  const research = input.sources.flatMap(s => s.facts.map(f => ({ s, f })))
  if (research.length === 0) return { status: 'skipped', outcome: 'no-research', facts: [], boxes: [], writer: null, error: null, ...totals() }

  const story: StoryText = {
    title: input.title,
    date: input.storyDay,
    paragraphs: input.layout.paragraphs,
    points: input.layout.points,
    caveats: input.layout.caveats,
  }
  const storyText = [input.title, ...input.layout.paragraphs.map(p => p.text), ...input.layout.points.map(p => p.text), ...input.layout.caveats].join('\n')

  try {
    // Step 2: structure research's facts; answers only for the ids asked
    const structure = await call(
      'structure',
      structureSchema,
      buildStructurePrompt({ facts: research.map(({ s, f }) => ({ ...f, source: { outlet: s.outlet, date: publishedDay(s.date), kind: s.kind } })) }),
    )
    const answers = new Map<string, StructuredFact>()
    for (const a of required(structure, 'structure').facts) if (!answers.has(a.id)) answers.set(a.id, a)
    const pass1 = research.flatMap(({ s, f }): ContextFactData[] => {
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
          ...structured(a),
          ...unverified,
          model: structure.model,
          promptVersion: CONTEXT_PROMPT_VERSIONS.structure,
        },
      ]
    })
    record.facts.research = research.length
    record.facts.leftOut = research.length - pass1.length

    // Step 1's reusable facts, each earlier source under a new id after research's
    let next = Math.max(...input.sources.map(s => sourceNumber(s.id)), 0) + 1
    const reusedIds = new Map<string, string>()
    const reusedCount = new Map<string, number>()
    const reused = input.reusable.map((f): ContextFactData => {
      const key = f.source.url
      if (!reusedIds.has(key)) reusedIds.set(key, `S${next++}`)
      const id = reusedIds.get(key)!
      const n = (reusedCount.get(id) ?? 0) + 1
      reusedCount.set(id, n)
      const { id: earlierId, ...rest } = f
      return { ...rest, ref: `${id}F${n}`, reusedFromId: f.reusedFromId ?? earlierId, source: { ...f.source, id }, verdict: 'supported', verdictProblem: null }
    })
    record.facts.reused = reused.length

    // Step 3: the gap list, and the searches it leaves
    const gapFacts = [...pass1, ...reused].map(f => ({
      id: f.ref,
      text: renderFact(f),
      current: isCurrent({ ...f, sourceDate: f.source.date }, input.storyDay, windows),
    }))
    const gap = required(await call('gap-list', gapListSchema, buildGapListPrompt({ story, facts: gapFacts })), 'gap-list')
    record.slots = gap.slots
    const plan = planSearches(gap, { title: input.title, text: storyText })
    record.responseInStory = plan.storyReports
    record.responseFallback = plan.fallback

    // Steps 4-6: search, filter, extract
    const pass2: ContextFactData[] = []
    if (plan.searches.length > 0) {
      // Every search is waited for: one that failed after its retries fails the run, but those that
      // completed were billed, so the run keeps their credits and records
      const settled = await Promise.allSettled(plan.searches.map(s => deps.search({ query: s.query, recent: s.recent, endDate: input.storyDay })))
      const completed = settled.flatMap((r, i) => (r.status === 'fulfilled' ? [{ i, answer: r.value }] : []))
      const searchRecord = (i: number, answer: ContextSearchAnswer, kept: string[]): SearchRecord => ({
        ...plan.searches[i]!,
        cached: answer.cached,
        credits: answer.credits,
        results: answer.results.length,
        kept,
      })
      credits += completed.reduce((sum, { answer }) => sum + answer.credits, 0)
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
      const known = [...input.sources.map(s => s.url), ...reused.map(f => f.source.url)]
      const { picked, drops } = pickNewSources(allowed, { urls: known, domains: input.sources.map(s => domainOf(s.url)) })
      record.sourceDrops.push(...drops)
      const kept = (i: number) => picked.filter(p => p.search === i).map(p => p.result.url)
      record.searches = completed.map(({ i, answer }) => searchRecord(i, answer, kept(i)))

      const extracted = await Promise.all(
        picked.map(async (p, k) => {
          const id = `S${next + k}`
          const wantedHere = plan.searches.map(s => ({ slot: s.slot, wanted: s.wanted }))
          const res = await call(
            'extract',
            contextExtractionSchema,
            buildContextExtractionPrompt({
              story: { title: input.title, summary: input.summary },
              wanted: wantedHere,
              source: { outlet: domainOf(p.result.url), url: p.result.url, date: publishedDay(p.result.date), title: p.result.title, text: p.result.text },
            }),
          )
          return { id, p, res }
        }),
      )
      next += picked.length
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
          pass2.push({
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
    }
    record.facts.search = pass2.length

    // Step 8: the fact check, research's prompt, at most `checkBatchSize` items a call
    const toCheck = [...pass1, ...pass2]
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

    // Steps 9-11: the write, the box code checks and the box check
    const supported = [...facts.filter(f => f.verdict === 'supported'), ...reused]
    const factMap = new Map(supported.map(f => [f.ref, f]))
    let boxes: DraftBox[] = []
    let writer: StoryContextResult['writer'] = null
    let boxStructural = 0
    let boxJudged = 0
    let boxFailed = 0
    if (supported.length > 0) {
      const write = await call(
        'write',
        boxesSchema,
        buildBoxesPrompt({
          story,
          facts: supported.map(f => ({
            id: f.ref,
            text: renderFact(f),
            outlet: f.source.outlet,
            date: f.source.date,
            current: isCurrent({ ...f, sourceDate: f.source.date }, input.storyDay, windows),
          })),
          needed: gap.slots.filter(s => s.needed || s.slot === 'response').map(s => ({ slot: s.slot, covered: s.covered })),
          responseInStory: plan.storyReports !== null,
        }),
      )
      writer = { model: write.model, promptVersion: CONTEXT_PROMPT_VERSIONS.write }
      const structural = structuralBoxes(required(write, 'write'), new Set(factMap.keys()), layoutSpots(input.layout))
      boxStructural = structural.structural
      const resolved = resolveVisuals(structural.boxes, factMap, input.storyDay, windows)
      record.boxDrops.push(...structural.drops, ...resolved.drops)
      const items = boxCheckItems(resolved.boxes, factMap, input.storyDay, windows)
      for (const it of items) if (it.checked.numberHints.length > 0) record.numberHints.push({ label: it.checked.item.label, numbers: it.checked.numberHints })
      const wording = wordingSources(supported, new Map(input.sources.map(s => [s.id, s.voices])))
      const lines = sourceLines(wording)
      const answers: { answer: FactCheck; items: BoxItem[] }[] = []
      for (const batch of chunks(items, config.storyContext.checkBatchSize)) {
        const answer = required(await call('box-check', factCheckSchema, buildFactCheckPrompt(promptItems(batch.map(b => b.checked)), lines, [])), 'box-check')
        answers.push({ answer, items: batch })
      }
      const verdicts = applyBoxVerdicts(resolved.boxes, items, answers, lines, boxCopying(resolved.boxes, wording, config.research.copiedRunWords))
      record.boxDrops.push(...verdicts.drops)
      boxes = verdicts.boxes
      boxJudged = verdicts.judged
      boxFailed = verdicts.failed
    }

    // Step 12: the honest gap, when the response was searched for and nothing sourced answers it
    const answered = facts.some(f => f.slot === 'response' && f.verdict === 'supported') || boxes.some(b => b.type === 'response')
    if (plan.responseSearched && plan.storyReports === null && !answered) {
      boxes.push({ type: 'response', heading: '', teaser: '', place: null, sentences: [], visual: null, gap: true })
      record.honestGap = true
    }

    // The reused facts a kept box cites are stored with this run, so its boxes resolve within it
    const cited = new Set(boxes.flatMap(citedRefs))
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
    return { status: 'completed', outcome: boxes.length > 0 ? 'built' : 'none-kept', facts: stored, boxes, writer, error: null, ...totals() }
  } catch (err) {
    return { status: 'failed', outcome: 'technical', facts: [], boxes: [], writer: null, error: errorText(err), ...totals() }
  }
}
