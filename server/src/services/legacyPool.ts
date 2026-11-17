/**
 * A story's legacy research and context runs turned into pool rows and version 1, once
 * (`.context/research-passes.md`, "Legacy import"), at the story's first pass, inside its claim
 * transaction. Sources and facts come from the newest completed research run with facts (the one
 * context reads), each fact `unjudged` unless a context run judged it (matched by `factKey`, its
 * verdict and structured fields taken over); context's own search facts come in with their
 * verdicts; both kinds of runs' queries become searches with no pass; a researched story's columns
 * and projection become version 1 (`legacy`), so its next pass is a later pass against what readers
 * see. The old rows are left as they are. Nothing happens once the story has pool rows or versions.
 */
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { insertPoolRows, insertVersion } from './passRecords.js'
import { publishedDay } from './researchChecks.js'
import { researchedStorySchema } from './researchedStory.js'
import {
  nextFactRef,
  nextSourceRef,
  poolFactKey,
  sourceKey,
  type ArticleVersionData,
  type DroppedSource,
  type Pool,
  type PoolFact,
  type PoolSearch,
  type PoolSource,
} from './researchPool.js'
import { FACT_COLUMNS_SQL, RUN_WITH_FACTS_SQL } from './storyContextInput.js'
import { RESPONSE_ANGLES } from './storyContextPipeline.js'
import { factFromRow, factKey, type FactColumns } from './storyContextRecords.js'
import { normalizedQuery } from './storyContextSources.js'

/** The prompt version recorded for a judgment a legacy run made: its prompt was not versioned then. */
export const LEGACY_PROMPT = 'legacy'

const factSchema = z.object({
  id: z.string(),
  statement: z.string(),
  supportingSentence: z.string(),
  measures: z.string().catch(''),
  found: z.boolean().catch(false),
})
const runSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string(),
        origin: z.string().catch('search'),
        url: z.string(),
        title: z.string().catch(''),
        outlet: z.string().catch(''),
        date: z.string().nullable().catch(null),
        favicon: z.string().nullable().catch(null),
        usedRawContent: z.boolean().catch(false),
        kind: z.string().catch('other'),
        country: z.string().catch(''),
        relation: z.string().catch(''),
        facts: z.array(factSchema).catch([]),
        voices: z.array(z.object({ name: z.string().catch(''), role: z.string().catch(''), quote: z.string().catch('') })).catch([]),
      }),
    )
    .catch([]),
  earlier: z
    .array(
      z.object({
        id: z.string(),
        storyId: z.string(),
        title: z.string().catch(''),
        date: z.string().nullable().catch(null),
        facts: z.array(factSchema).catch([]),
      }),
    )
    .catch([]),
  searches: z.array(z.object({ query: z.string(), results: z.number().catch(0), credits: z.number().catch(0), cached: z.boolean().catch(false) })).catch([]),
  calls: z.array(z.object({ step: z.string(), model: z.string().catch('') })).catch([]),
  optOutChecked: z.boolean().catch(false),
})

const contextRecordSchema = z.object({
  searches: z
    .array(
      z.object({
        slot: z.string(),
        wanted: z.string().catch(''),
        query: z.string(),
        angle: z.enum(['action', 'elsewhere']).optional().catch(undefined),
        cached: z.boolean().catch(false),
        credits: z.number().catch(0),
        results: z.number().catch(0),
      }),
    )
    .catch([]),
  extractionDrops: z.array(z.object({ url: z.string(), reason: z.string() })).catch([]),
})

const ORIGINS = ['original', 'cluster', 'neighbour', 'search'] as const
const originOf = (o: string): PoolSource['origin'] => ((ORIGINS as readonly string[]).includes(o) ? (o as PoolSource['origin']) : 'search')

interface StoryColumns {
  title: string | null
  title_label: string | null
  summary: string | null
  marketing_blurb: string | null
  quote: string | null
  quote_attribution: string | null
  relevance_reasons: string | null
  antifactors: string | null
  emotion_tag: string | null
  research: unknown
}

const baseSource = {
  id: null,
  earlierStoryId: null,
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: false,
  firstPassId: null,
} satisfies Partial<PoolSource>

const unjudged = { verdict: 'unjudged' as const, verdictProblem: null, checkedBy: null, status: 'unreviewed' as const, firstPassId: null, drop: null }

/** The pool a research run's result and the story's context facts and records make, refs as the research run gave them. */
export function legacyPoolOf(run: z.infer<typeof runSchema> | null, contextFacts: (FactColumns & { status: string })[], contextRecords: unknown[]): Pool {
  const extractModel = run?.calls.find(c => c.step === 'extract')?.model || 'unknown'
  const sources: PoolSource[] = []
  const facts: PoolFact[] = []
  const searches: PoolSearch[] = []
  const dropped: DroppedSource[] = []
  const fact = (sourceRef: string, f: z.infer<typeof factSchema>): PoolFact => ({
    id: null,
    ref: f.id,
    sourceRef,
    reusedFromId: null,
    supportingSentence: f.supportingSentence,
    passage: null,
    supportFound: f.found,
    statement: f.statement,
    measures: f.measures,
    slot: null,
    structured: null,
    extractedBy: { model: extractModel, promptVersion: LEGACY_PROMPT },
    ...unjudged,
  })

  for (const s of run?.sources ?? []) {
    sources.push({
      ...baseSource,
      ...s,
      id: null,
      ref: s.id,
      origin: s.id === 'S0' ? 'original' : originOf(s.origin),
      date: publishedDay(s.date),
      optOutChecked: run!.optOutChecked,
    })
    facts.push(...s.facts.map(f => fact(s.id, f)))
  }
  for (const e of run?.earlier ?? []) {
    sources.push({
      ...baseSource,
      ref: e.id,
      origin: 'earlier',
      earlierStoryId: e.storyId,
      url: '',
      outlet: 'Actually Relevant',
      title: e.title,
      date: publishedDay(e.date),
      kind: '',
      country: '',
      relation: '',
    })
    facts.push(...e.facts.map(f => fact(e.id, f)))
  }
  for (const s of run?.searches ?? [])
    searches.push({
      kind: 'coverage',
      slot: null,
      angle: null,
      query: s.query,
      normalizedQuery: normalizedQuery(s.query),
      windowStart: null,
      windowEnd: null,
      depth: null,
      credits: s.credits,
      results: s.results,
      cached: s.cached,
      passId: null,
    })

  // Context's verdicts on research's facts, by key; its own search facts as new sources of the pool
  const byKey = new Map(
    facts.map(f => [
      poolFactKey(
        f,
        sources.find(s => s.ref === f.sourceRef)!,
      ),
      f,
    ]),
  )
  const sourceByUrl = new Map(sources.map(s => [sourceKey(s), s]))
  for (const row of contextFacts) {
    const c = factFromRow(row)
    const judged = {
      structured: { ...c, by: { model: c.model, promptVersion: c.promptVersion } },
      verdict: c.verdict,
      verdictProblem: c.verdictProblem,
      status: row.status === 'demoted' ? ('demoted' as const) : ('unreviewed' as const),
      drop: row.status === 'demoted' ? { passId: null, reason: 'editor' as const, contradictedBy: [] } : null,
    }
    if (c.origin === 'research') {
      const own = byKey.get(factKey({ url: c.source.url, supportingSentence: c.supportingSentence, statement: c.statement }))
      if (own && own.verdict === 'unjudged') Object.assign(own, judged)
      continue
    }
    if (c.reusedFromId !== null) continue
    const key = sourceKey({ url: c.source.url, earlierStoryId: null })
    let source = sourceByUrl.get(key)
    if (!source) {
      source = {
        ...baseSource,
        ref: nextSourceRef(
          sources.map(s => s.ref),
          false,
        ),
        origin: 'search',
        url: c.source.url,
        outlet: c.source.outlet,
        title: c.source.title,
        date: c.source.date,
        kind: c.source.kind,
        country: '',
        relation: 'background',
      }
      sources.push(source)
      sourceByUrl.set(key, source)
    }
    const ref = nextFactRef(
      source.ref,
      facts.map(f => f.ref),
    )
    const pooled: PoolFact = {
      ...fact(source.ref, { id: ref, statement: c.statement, supportingSentence: c.supportingSentence, measures: c.counted, found: c.supportFound }),
      passage: c.passage,
      extractedBy: { model: c.model, promptVersion: c.promptVersion },
      ...judged,
    }
    if (!byKey.has(poolFactKey(pooled, source))) {
      byKey.set(poolFactKey(pooled, source), pooled)
      facts.push(pooled)
    }
  }
  for (const record of contextRecords) {
    const r = contextRecordSchema.safeParse(record)
    if (!r.success) continue
    for (const s of r.data.searches) {
      const angle = s.slot === 'response' ? (s.angle ?? RESPONSE_ANGLES.find(a => a.wanted === s.wanted)?.angle ?? null) : null
      searches.push({
        kind: 'gap',
        slot: s.slot,
        angle,
        query: s.query,
        normalizedQuery: normalizedQuery(s.query),
        windowStart: null,
        windowEnd: null,
        depth: null,
        credits: s.credits,
        results: s.results,
        cached: s.cached,
        passId: null,
      })
    }
    for (const d of r.data.extractionDrops) {
      if (!sourceByUrl.has(sourceKey({ url: d.url, earlierStoryId: null }))) dropped.push({ url: d.url, reason: d.reason, passId: null })
    }
  }
  return { sources, facts, searches, dropped }
}

/** A researched story's columns and projection as version 1; null when it carries no researched text. */
export function legacyVersionOf(story: StoryColumns): ArticleVersionData | null {
  const research = researchedStorySchema.safeParse(story.research)
  if (story.research === null || !research.success) return null
  return {
    id: null,
    number: 1,
    kind: 'legacy',
    status: 'current',
    passId: null,
    title: story.title,
    titleLabel: story.title_label,
    summary: story.summary,
    marketingBlurb: story.marketing_blurb,
    quote: story.quote,
    quoteAttribution: story.quote_attribution,
    relevanceReasons: story.relevance_reasons,
    antifactors: story.antifactors,
    emotionTag: story.emotion_tag,
    research: research.data,
    changes: [],
    note: null,
  }
}

/**
 * Import the story's legacy runs into its pool, in the caller's transaction (the pass's claim):
 * `present` when the story already has pool rows or versions, `none` when it has nothing to import.
 */
export async function importLegacyPool(tx: Prisma.TransactionClient, storyId: string): Promise<'imported' | 'present' | 'none'> {
  const [present] = await tx.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM evidence_sources WHERE story_id = ${storyId})
        OR EXISTS (SELECT 1 FROM article_versions WHERE story_id = ${storyId}) AS present`
  if (present?.present) return 'present'

  const [runRow] = await tx.$queryRaw<{ result: unknown }[]>`
    SELECT r.result FROM story_research_runs r
    WHERE r.story_id = ${storyId} AND ${RUN_WITH_FACTS_SQL}
    ORDER BY r.started_at DESC, r.id DESC LIMIT 1`
  const run = runRow ? runSchema.safeParse(runRow.result) : null
  const [contextFacts, contextRuns, [story]] = await Promise.all([
    tx.$queryRaw<(FactColumns & { status: string })[]>`
      SELECT ${FACT_COLUMNS_SQL}, f.status::text AS status FROM context_facts f JOIN story_context_runs r ON r.id = f.run_id
      WHERE f.story_id = ${storyId} AND r.status = 'completed' ORDER BY r.started_at DESC, r.id DESC, f.ref, f.id`,
    tx.$queryRaw<
      { result: unknown }[]
    >`SELECT r.result FROM story_context_runs r WHERE r.story_id = ${storyId} AND r.status = 'completed' ORDER BY r.started_at, r.id`,
    tx.$queryRaw<StoryColumns[]>`
      SELECT s.title, s.title_label, s.summary, s.marketing_blurb, s.quote, s.quote_attribution, s.relevance_reasons, s.antifactors,
             s.emotion_tag::text AS emotion_tag, s.research
      FROM stories s WHERE s.id = ${storyId}`,
  ])
  const pool = legacyPoolOf(
    run?.success ? run.data : null,
    contextFacts,
    contextRuns.map(r => r.result),
  )
  const version = story ? legacyVersionOf(story) : null
  if (pool.sources.length === 0 && pool.searches.length === 0 && !version) return 'none'

  await insertPoolRows(tx, storyId, pool)
  if (version) await insertVersion(tx, storyId, version)
  return 'imported'
}
