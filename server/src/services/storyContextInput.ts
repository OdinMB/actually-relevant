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
import { APPROX, CREDITED_KINDS, VALIDITY } from '../schemas/storyContext.js'
import type { ResearchDb } from './researchInput.js'
import type { ContextInput, ContextResearchSource, ReusableFact } from './storyContextPipeline.js'
import { storyLayout } from './storyContextLayout.js'
import { asOfFromColumns, isCurrent } from './storyContextVisuals.js'

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

interface FactRow {
  id: string
  ref: string
  origin: string
  reused_from_id: string | null
  source_url: string
  source_outlet: string
  source_title: string
  source_date: Date | null
  source_kind: string
  supporting_sentence: string
  passage: string | null
  support_found: boolean
  statement: string
  value: number | null
  value_high: number | null
  unit: string
  approx: string
  provisional: boolean
  counted: string
  place: string
  as_of: Date | null
  as_of_precision: string | null
  credited: string
  credited_kind: string | null
  validity: string
  model: string
  prompt_version: string
}

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback

const day = (d: Date) => d.toISOString().slice(0, 10)

function reusableFact(row: FactRow): ReusableFact {
  return {
    id: row.id,
    ref: row.ref,
    origin: row.origin === 'search' ? 'search' : 'research',
    reusedFromId: row.reused_from_id,
    slot: null,
    source: {
      id: row.ref.replace(/F\d+$/, ''),
      url: row.source_url,
      outlet: row.source_outlet,
      title: row.source_title,
      date: row.source_date ? day(row.source_date) : null,
      kind: row.source_kind,
    },
    supportingSentence: row.supporting_sentence,
    passage: row.passage,
    supportFound: row.support_found,
    statement: row.statement,
    value: row.value,
    valueHigh: row.value_high,
    unit: row.unit,
    approx: oneOf(row.approx, APPROX, 'exact'),
    provisional: row.provisional,
    counted: row.counted,
    place: row.place,
    asOf: asOfFromColumns(row.as_of, row.as_of_precision),
    credited: row.credited,
    creditedKind: row.credited_kind === null ? null : oneOf(row.credited_kind, CREDITED_KINDS, 'other'),
    validity: oneOf(row.validity, VALIDITY, 'fast'),
    verdict: 'supported',
    verdictProblem: null,
    model: row.model,
    promptVersion: row.prompt_version,
  }
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

  const storyDay = day(story.date_published)
  const earlierIds = [...new Set(parsed.data.earlier.map(e => e.storyId))].filter(id => id !== storyId)
  const rows =
    earlierIds.length === 0
      ? []
      : await db.$queryRaw<FactRow[]>`
          SELECT f.id, f.ref, f.origin, f.reused_from_id, f.source_url, f.source_outlet, f.source_title, f.source_date, f.source_kind,
                 f.supporting_sentence, f.passage, f.support_found, f.statement, f.value, f.value_high, f.unit, f.approx, f.provisional,
                 f.counted, f.place, f.as_of, f.as_of_precision, f.credited, f.credited_kind, f.validity::text AS validity, f.model, f.prompt_version
          FROM context_facts f
          WHERE f.story_id = ANY(${earlierIds}) AND f.verdict = 'supported' AND f.status <> 'demoted'
          ORDER BY f.as_of DESC NULLS LAST, f.created_at DESC, f.id`
  const windows = { fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays }
  const reusable = rows
    .map(reusableFact)
    .filter(f => isCurrent({ ...f, sourceDate: f.source.date }, storyDay, windows))
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
