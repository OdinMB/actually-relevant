/**
 * What story context reads (`.context/story-context.md`, "Which stories"): the published stories
 * the step still owes, and one story's input (its text and places, its research run's sources and
 * facts, and the reusable facts of the earlier stories research linked). SELECT only, as tagged
 * `$queryRaw` templates through the client it is given, so the eval can pass its read-only session.
 * Our own earlier stories (`E…`) are never loaded as facts: they are our text.
 */
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '../config.js'
import { utcDay } from '../lib/days.js'
import type { ResearchDb } from './researchInput.js'
import {
  RESPONSE_ANGLES,
  type ContextInput,
  type ContextResearchSource,
  type EarlierWork,
  type ResponseAngle,
  type ReusableFact,
} from './storyContextPipeline.js'
import { storyLayout } from './storyContextLayout.js'
import { factFromRow, factKey, type FactColumns } from './storyContextRecords.js'
import { normalizedQuery } from './storyContextSources.js'
import { isCurrent } from './storyContextVisuals.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A completed research run (`r`) whose sources hold facts: the condition both queries share, spliced
 * into their templates as SQL (it holds no values).
 */
const RUN_WITH_FACTS_SQL = Prisma.raw(`
  r.status = 'completed'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.result->'sources') = 'array' THEN r.result->'sources' ELSE '[]'::jsonb END) src
    WHERE CASE WHEN jsonb_typeof(src->'facts') = 'array' THEN jsonb_array_length(src->'facts') ELSE 0 END > 0
  )`)

/** A context fact's columns (`f`), each under its row field's name, so the rows read back as the view's do (`factFromRow`). */
const FACT_COLUMNS_SQL = Prisma.raw(`
  f.id, f.ref, f.origin, f.reused_from_id AS "reusedFromId", f.source_url AS "sourceUrl", f.source_outlet AS "sourceOutlet",
  f.source_title AS "sourceTitle", f.source_date AS "sourceDate", f.source_kind AS "sourceKind",
  f.supporting_sentence AS "supportingSentence", f.passage, f.support_found AS "supportFound", f.statement, f.value,
  f.value_high AS "valueHigh", f.unit, f.approx, f.provisional, f.counted, f.place, f.as_of AS "asOf",
  f.as_of_precision AS "asOfPrecision", f.credited, f.credited_kind AS "creditedKind", f.validity::text AS validity,
  f.verdict::text AS verdict, f.verdict_problem AS "verdictProblem", f.model, f.prompt_version AS "promptVersion"`)

/**
 * The stories the step owes, oldest published first, at most `limit`: published within the last
 * `lookbackDays`, with a completed research run whose sources hold facts, and no context run yet
 * (a story is settled by its first run, whatever its outcome).
 */
export async function nextForContext(db: ResearchDb, limit: number, now: Date = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - config.storyContext.lookbackDays * DAY_MS)
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM stories s
    WHERE s.status = 'published' AND s.date_published >= ${since}
      AND NOT EXISTS (SELECT 1 FROM story_context_runs c WHERE c.story_id = s.id)
      AND EXISTS (SELECT 1 FROM story_research_runs r WHERE r.story_id = s.id AND ${RUN_WITH_FACTS_SQL})
    ORDER BY s.date_published ASC, s.id ASC
    LIMIT ${limit}`
  return rows.map(r => r.id)
}

const researchResultSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      title: z.string().catch(''),
      outlet: z.string().catch(''),
      date: z.string().nullable().catch(null),
      kind: z.string().catch('other'),
      facts: z
        .array(
          z.object({ id: z.string(), statement: z.string(), supportingSentence: z.string(), measures: z.string().catch(''), found: z.boolean().catch(false) }),
        )
        .catch([]),
      voices: z.array(z.object({ name: z.string().catch(''), role: z.string().catch(''), quote: z.string().catch('') })).catch([]),
    }),
  ),
  earlier: z.array(z.object({ storyId: z.string() })).catch([]),
})

interface StoryRow {
  id: string
  title: string | null
  source_title: string
  summary: string | null
  source_url: string
  relevance_reasons: string | null
  antifactors: string | null
  research: unknown
  date_published: Date
}

/**
 * One owed story's input, or null when it is not published or has no completed research run whose
 * sources hold facts. The run is the newest such; the reusable facts are the supported, non-demoted
 * context facts of the earlier stories it linked, kept only while current on this story's day,
 * newest first, at most `maxReusedFacts`.
 */
export async function loadContextInput(db: ResearchDb, storyId: string): Promise<ContextInput | null> {
  const [story] = await db.$queryRaw<StoryRow[]>`
    SELECT s.id, s.title, s.source_title, s.summary, s.source_url, s.relevance_reasons, s.antifactors, s.research, s.date_published
    FROM stories s WHERE s.id = ${storyId} AND s.status = 'published' AND s.date_published IS NOT NULL`
  if (!story) return null
  const [run] = await db.$queryRaw<{ id: string; result: unknown }[]>`
    SELECT r.id, r.result FROM story_research_runs r
    WHERE r.story_id = ${storyId} AND ${RUN_WITH_FACTS_SQL}
    ORDER BY r.started_at DESC, r.id DESC LIMIT 1`
  const parsed = run ? researchResultSchema.safeParse(run.result) : null
  if (!run || !parsed?.success) return null

  const storyDay = utcDay(story.date_published)
  const earlierIds = [...new Set(parsed.data.earlier.map(e => e.storyId))].filter(id => id !== storyId)
  const rows =
    earlierIds.length === 0
      ? []
      : await db.$queryRaw<FactColumns[]>`
          SELECT ${FACT_COLUMNS_SQL}
          FROM context_facts f
          WHERE f.story_id = ANY(${earlierIds}) AND f.verdict = 'supported' AND f.status <> 'demoted'
          ORDER BY f.as_of DESC NULLS LAST, f.created_at DESC, f.id`
  const windows = { fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays }
  // An earlier story's copy of a fact it reused stands for the same fact: offered once, the newest
  const offered = new Set<string>()
  const reusable: ReusableFact[] = rows
    .map(factFromRow)
    .filter(f => isCurrent({ ...f, sourceDate: f.source.date }, storyDay, windows))
    .filter(f => {
      const original = f.reusedFromId ?? f.id
      if (offered.has(original)) return false
      offered.add(original)
      return true
    })
    .slice(0, config.storyContext.maxReusedFacts)

  const sources: ContextResearchSource[] = parsed.data.sources.map(s => ({ ...s }))
  return {
    storyId: story.id,
    title: story.title ?? story.source_title,
    summary: story.summary ?? '',
    storyDay,
    layout: storyLayout({
      url: story.source_url,
      summary: story.summary,
      relevanceReasons: story.relevance_reasons,
      antifactors: story.antifactors,
      research: story.research,
    }),
    researchRunId: run.id,
    sources,
    reusable,
  }
}

/**
 * What an editor's run needs of a story (`.context/story-context.md`, "On demand"): its status, and
 * whether a completed research run of it holds facts; null for an unknown story. No lookback, and
 * earlier context runs do not matter.
 */
export async function contextEligibility(db: ResearchDb, storyId: string): Promise<{ status: string; researched: boolean } | null> {
  const [row] = await db.$queryRaw<{ status: string; researched: boolean }[]>`
    SELECT s.status::text AS status,
           EXISTS (SELECT 1 FROM story_research_runs r WHERE r.story_id = s.id AND ${RUN_WITH_FACTS_SQL}) AS researched
    FROM stories s WHERE s.id = ${storyId}`
  return row ?? null
}

/** What an earlier run recorded that a later one reads: its searches, each with its angle and the URLs it picked. */
const earlierRecordSchema = z.object({
  searches: z
    .array(
      z.object({
        slot: z.string(),
        wanted: z.string().catch(''),
        query: z.string(),
        angle: z.enum(['action', 'elsewhere']).optional().catch(undefined),
        kept: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
})

/** A response search's angle: as recorded, else (records from before 2026-11-17) by the angle's `wanted` text. */
function angleOf(search: z.infer<typeof earlierRecordSchema>['searches'][number]): ResponseAngle | null {
  if (search.slot !== 'response') return null
  return search.angle ?? RESPONSE_ANGLES.find(a => a.wanted === search.wanted)?.angle ?? null
}

/**
 * What the story's earlier completed context runs did, for a run that builds on them
 * (`EarlierWork`; `.context/story-context.md`, "On demand"). A failed, skipped or running run
 * counts for nothing: it stored no facts, so what it searched or read is not taken as done. Facts
 * a run copied (`reused_from_id`) are left out: the story's own come in as their original row,
 * another story's through step 1's reuse.
 */
export async function loadEarlierWork(db: ResearchDb, storyId: string): Promise<EarlierWork> {
  const [runs, rows] = await Promise.all([
    db.$queryRaw<{ result: unknown }[]>`
      SELECT r.result FROM story_context_runs r
      WHERE r.story_id = ${storyId} AND r.status = 'completed'
      ORDER BY r.started_at DESC, r.id DESC`,
    db.$queryRaw<(FactColumns & { status: string })[]>`
      SELECT ${FACT_COLUMNS_SQL}, f.status::text AS status
      FROM context_facts f JOIN story_context_runs r ON r.id = f.run_id
      WHERE f.story_id = ${storyId} AND r.status = 'completed' AND f.reused_from_id IS NULL
      ORDER BY r.started_at DESC, r.id DESC, f.ref, f.id`,
  ])
  const searches = runs.flatMap(r => earlierRecordSchema.safeParse(r.result).data?.searches ?? [])
  const facts = rows.map(row => ({ row, fact: factFromRow(row) }))
  const key = (f: ReusableFact) => factKey({ url: f.source.url, supportingSentence: f.supportingSentence, statement: f.statement })

  const seen = new Set<string>()
  const carried = facts.filter(({ row, fact }) => {
    if (fact.verdict !== 'supported' || row.status === 'demoted' || seen.has(key(fact))) return false
    seen.add(key(fact))
    return true
  })
  return {
    facts: carried.map(c => c.fact),
    judged: [...new Set(facts.filter(({ fact }) => fact.origin === 'research' && fact.verdict !== 'unjudged').map(({ fact }) => key(fact)))],
    queries: [...new Set(searches.map(s => normalizedQuery(s.query)))],
    angles: [...new Set(searches.flatMap(s => angleOf(s) ?? []))],
    read: [...new Set([...searches.flatMap(s => s.kept), ...facts.filter(({ fact }) => fact.origin === 'search').map(({ fact }) => fact.source.url)])],
  }
}
