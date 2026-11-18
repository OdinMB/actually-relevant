/**
 * The research passes' records read back (`.context/research-passes.md`, "Records"): a story's pool
 * (sources, facts, searches, the pages left out), its current article version and every version
 * (each with its article and the time it was made) as the pass pipeline's types (`researchPool.ts`),
 * and the cards of its newest pass that wrote any. SELECT-only tagged `$queryRaw` templates through
 * the client given, so the eval's read-only session can read a pool too. A pass's rows are written by
 * `passWrites.ts`, its row by `researchPassLifecycle.ts`.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { utcDay } from '../lib/days.js'
import { APPROX, CREDITED_KINDS, VALIDITY, isContextSlot } from '../schemas/storyContext.js'
import { researchedStorySchema, citedTextSchema } from './researchedStory.js'
import type { ResearchDb } from './researchInput.js'
import { appliedDraftSchema } from './researchSwap.js'
import type { ArticleVersionData, DroppedSource, Judge, Pool, PoolFact, PoolSearch, PoolSource, VersionChange } from './researchPool.js'
import { oneOf } from './storyContextRecords.js'
import { asOfFromColumns } from './storyContextVisuals.js'

// ---------------------------------------------------------------------------
// Reading a pool
// ---------------------------------------------------------------------------

interface SourceRow {
  id: string
  ref: string | null
  origin: string
  earlierStoryId: string | null
  url: string
  outlet: string
  title: string
  publishedDate: Date | null
  kind: string
  country: string
  relation: string
  favicon: string | null
  usedRawContent: boolean
  voices: unknown
  optOutChecked: boolean
  firstPassId: string | null
  dropReason: string | null
  dropPassId: string | null
}

interface FactRow {
  id: string
  ref: string
  sourceRef: string
  reusedFromId: string | null
  supportingSentence: string
  passage: string | null
  supportFound: boolean
  statement: string
  measures: string
  value: number | null
  valueHigh: number | null
  unit: string
  approx: string
  provisional: boolean
  counted: string
  place: string
  asOf: Date | null
  asOfPrecision: string | null
  credited: string
  creditedKind: string | null
  validity: string
  slot: string | null
  extractModel: string
  extractPromptVersion: string
  structureModel: string | null
  structurePromptVersion: string | null
  firstPassId: string | null
  verdict: string
  verdictProblem: string | null
  checkModel: string | null
  checkPromptVersion: string | null
  checkedPassId: string | null
  status: string
  droppedPassId: string | null
  dropReason: string | null
  contradictedBy: string[]
}

interface SearchRow {
  kind: string
  slot: string | null
  angle: string | null
  query: string
  normalizedQuery: string
  windowStart: Date | null
  windowEnd: Date | null
  depth: string | null
  credits: number
  results: number
  cached: boolean
  passId: string | null
}

const voicesSchema = z
  .array(z.object({ name: z.string().catch(''), role: z.string().catch(''), quote: z.string().catch(''), stance: z.string().catch('') }))
  .catch([])

const ORIGINS = ['original', 'cluster', 'neighbour', 'search', 'earlier'] as const
const VERDICTS = ['supported', 'rejected', 'unjudged'] as const
const STATUSES = ['unreviewed', 'reviewed', 'demoted'] as const
const day = (d: Date | null) => (d ? utcDay(d) : null)

function sourceFromRow(r: SourceRow & { ref: string }): PoolSource {
  return {
    id: r.id,
    ref: r.ref,
    origin: oneOf(r.origin, ORIGINS, 'search'),
    earlierStoryId: r.earlierStoryId,
    url: r.url,
    outlet: r.outlet,
    title: r.title,
    date: day(r.publishedDate),
    kind: r.kind,
    country: r.country,
    relation: r.relation,
    favicon: r.favicon,
    usedRawContent: r.usedRawContent,
    voices: voicesSchema.parse(r.voices),
    optOutChecked: r.optOutChecked,
    firstPassId: r.firstPassId,
  }
}

const judge = (model: string | null, promptVersion: string | null): Judge | null => (model !== null && promptVersion !== null ? { model, promptVersion } : null)

function factFromRow(r: FactRow): PoolFact {
  const structuredBy = judge(r.structureModel, r.structurePromptVersion)
  const checkedBy = judge(r.checkModel, r.checkPromptVersion)
  return {
    id: r.id,
    ref: r.ref,
    sourceRef: r.sourceRef,
    reusedFromId: r.reusedFromId,
    supportingSentence: r.supportingSentence,
    passage: r.passage,
    supportFound: r.supportFound,
    statement: r.statement,
    measures: r.measures,
    slot: r.slot !== null && isContextSlot(r.slot) ? r.slot : null,
    structured: structuredBy && {
      value: r.value,
      valueHigh: r.valueHigh,
      unit: r.unit,
      approx: oneOf(r.approx, APPROX, 'exact'),
      provisional: r.provisional,
      counted: r.counted,
      place: r.place,
      asOf: asOfFromColumns(r.asOf, r.asOfPrecision),
      credited: r.credited,
      creditedKind: r.creditedKind === null ? null : oneOf(r.creditedKind, CREDITED_KINDS, 'other'),
      validity: oneOf(r.validity, VALIDITY, 'fast'),
      by: structuredBy,
    },
    extractedBy: { model: r.extractModel, promptVersion: r.extractPromptVersion },
    verdict: oneOf(r.verdict, VERDICTS, 'unjudged'),
    verdictProblem: r.verdictProblem,
    checkedBy: checkedBy && { ...checkedBy, passId: r.checkedPassId },
    status: oneOf(r.status, STATUSES, 'unreviewed'),
    firstPassId: r.firstPassId,
    drop:
      r.dropReason === 'contradicted' || r.dropReason === 'editor' ? { passId: r.droppedPassId, reason: r.dropReason, contradictedBy: r.contradictedBy } : null,
  }
}

const searchFromRow = (r: SearchRow): PoolSearch => ({
  kind: r.kind === 'gap' ? 'gap' : 'coverage',
  slot: r.slot,
  angle: r.angle,
  query: r.query,
  normalizedQuery: r.normalizedQuery,
  windowStart: day(r.windowStart),
  windowEnd: day(r.windowEnd),
  depth: r.depth,
  credits: r.credits,
  results: r.results,
  cached: r.cached,
  passId: r.passId,
})

/** The stories' sources (`s`), in the order they were written; `only` narrows them (an `AND …` fragment). */
const poolSources = (db: ResearchDb, storyIds: readonly string[], only: Prisma.Sql = Prisma.empty) =>
  db.$queryRaw<(SourceRow & { storyId: string })[]>`
    SELECT s.id, s.story_id AS "storyId", s.ref, s.origin, s.earlier_story_id AS "earlierStoryId", s.url, s.outlet, s.title,
           s.published_date AS "publishedDate", s.kind, s.country, s.relation, s.favicon,
           s.used_raw_content AS "usedRawContent", s.voices, s.opt_out_checked AS "optOutChecked",
           s.first_pass_id AS "firstPassId", s.drop_reason AS "dropReason", s.drop_pass_id AS "dropPassId"
    FROM evidence_sources s WHERE s.story_id = ANY(${[...storyIds]}::text[]) ${only}
    ORDER BY s.created_at, s.ref NULLS LAST, s.id`

/** The stories' facts (`f`, their source `s`), in the order they were written; `only` narrows them (an `AND …` fragment). */
const poolFacts = (db: ResearchDb, storyIds: readonly string[], only: Prisma.Sql = Prisma.empty) =>
  db.$queryRaw<(FactRow & { storyId: string })[]>`
    SELECT f.id, f.story_id AS "storyId", f.ref, s.ref AS "sourceRef", f.reused_from_id AS "reusedFromId", f.supporting_sentence AS "supportingSentence",
           f.passage, f.support_found AS "supportFound", f.statement, f.measures, f.value, f.value_high AS "valueHigh",
           f.unit, f.approx, f.provisional, f.counted, f.place, f.as_of AS "asOf", f.as_of_precision AS "asOfPrecision",
           f.credited, f.credited_kind AS "creditedKind", f.validity::text AS validity, f.slot,
           f.extract_model AS "extractModel", f.extract_prompt_version AS "extractPromptVersion",
           f.structure_model AS "structureModel", f.structure_prompt_version AS "structurePromptVersion",
           f.first_pass_id AS "firstPassId", f.verdict::text AS verdict, f.verdict_problem AS "verdictProblem",
           f.check_model AS "checkModel", f.check_prompt_version AS "checkPromptVersion", f.checked_pass_id AS "checkedPassId",
           f.status::text AS status, f.dropped_pass_id AS "droppedPassId", f.drop_reason::text AS "dropReason",
           f.contradicted_by AS "contradictedBy"
    FROM pool_facts f JOIN evidence_sources s ON s.id = f.source_id
    WHERE f.story_id = ANY(${[...storyIds]}::text[]) ${only}
    ORDER BY f.created_at, f.ref, f.id`

/** The sources in use: a source left out has no ref, or a reason. */
const usedSources = <T extends SourceRow>(sources: T[]) => sources.filter((s): s is T & { ref: string } => s.ref !== null && s.dropReason === null)

/** The story's pool, in the order its rows were written: within one pass, sources and facts by ref, coverage searches before gap searches. */
export async function loadPool(db: ResearchDb, storyId: string): Promise<Pool> {
  const [sources, facts, searches] = await Promise.all([
    poolSources(db, [storyId]),
    poolFacts(db, [storyId]),
    db.$queryRaw<SearchRow[]>`
      SELECT e.kind, e.slot, e.angle, e.query, e.normalized_query AS "normalizedQuery", e.window_start AS "windowStart",
             e.window_end AS "windowEnd", e.depth, e.credits, e.results, e.cached, e.pass_id AS "passId"
      FROM evidence_searches e WHERE e.story_id = ${storyId}
      ORDER BY e.created_at, e.kind, e.slot NULLS FIRST, e.angle NULLS FIRST, e.normalized_query, e.id`,
  ])
  const dropped: DroppedSource[] = sources.flatMap(s => (s.dropReason !== null ? [{ url: s.url, reason: s.dropReason, passId: s.dropPassId }] : []))
  return { sources: usedSources(sources).map(sourceFromRow), facts: facts.map(factFromRow), searches: searches.map(searchFromRow), dropped }
}

/**
 * The pool's facts under these refs and the sources in use that hold them, read as `loadPool` reads
 * them and in its order: what a story's cards cite (`cardRecords`), without the rest of the pool.
 */
export async function loadCitedFacts(db: ResearchDb, storyId: string, refs: string[]): Promise<Pick<Pool, 'sources' | 'facts'>> {
  if (refs.length === 0) return { sources: [], facts: [] }
  const [sources, facts] = await Promise.all([
    poolSources(db, [storyId], Prisma.sql`AND EXISTS (SELECT 1 FROM pool_facts c WHERE c.source_id = s.id AND c.ref = ANY(${refs}))`),
    poolFacts(db, [storyId], Prisma.sql`AND f.ref = ANY(${refs})`),
  ])
  return { sources: usedSources(sources).map(sourceFromRow), facts: facts.map(factFromRow) }
}

/** A fact of a story's pool with its story and its source. */
export interface StoryPoolFact {
  storyId: string
  fact: PoolFact
  source: PoolSource
}

/**
 * The usable, structured facts of pages in these stories' pools, each with its story and its source in
 * use, read as `loadPool` reads them and in its order: what an overview's "Where this stands" is
 * written from (`overviewStands.ts`). Our own earlier stories' facts are never read.
 */
export async function loadMemberFacts(db: ResearchDb, storyIds: readonly string[]): Promise<StoryPoolFact[]> {
  const ids = [...new Set(storyIds)]
  if (ids.length === 0) return []
  const [sources, facts] = await Promise.all([
    poolSources(db, ids, Prisma.sql`AND s.origin <> 'earlier'`),
    poolFacts(db, ids, Prisma.sql`AND s.origin <> 'earlier' AND f.verdict = 'supported' AND f.status <> 'demoted' AND f.structure_model IS NOT NULL`),
  ])
  const sourceOf = new Map(usedSources(sources).map(s => [`${s.storyId}:${s.ref}`, sourceFromRow(s)]))
  return facts.flatMap(r => {
    const source = sourceOf.get(`${r.storyId}:${r.sourceRef}`)
    return source ? [{ storyId: r.storyId, fact: factFromRow(r), source }] : []
  })
}

// A change stored before changes carried `from` was at its own place: no section had moved yet
const changesSchema = z
  .array(
    z
      .object({
        section: z.string(),
        from: z.string().optional(),
        before: citedTextSchema.nullable().catch(null),
        after: citedTextSchema.nullable().catch(null),
      })
      .transform(({ from, ...c }) => ({ ...c, from: from ?? c.section })),
  )
  .catch([])

const VERSION_COLUMNS = Prisma.sql`v.id, v.number, v.kind::text AS kind, v.status::text AS status, v.pass_id AS "passId", v.title,
  v.title_label AS "titleLabel", v.summary, v.marketing_blurb AS "marketingBlurb", v.quote, v.quote_attribution AS "quoteAttribution",
  v.relevance_reasons AS "relevanceReasons", v.antifactors, v.emotion_tag::text AS "emotionTag", v.research, v.draft, v.changes, v.note,
  v.created_at AS "createdAt"`

interface VersionRow {
  id: string
  number: number
  kind: string
  status: string
  passId: string | null
  title: string | null
  titleLabel: string | null
  summary: string | null
  marketingBlurb: string | null
  quote: string | null
  quoteAttribution: string | null
  relevanceReasons: string | null
  antifactors: string | null
  emotionTag: string | null
  research: unknown
  draft: unknown
  changes: unknown
  note: unknown
  createdAt: Date
}

const VERSION_KINDS = ['first', 'update', 'legacy'] as const
const VERSION_STATUSES = ['current', 'superseded', 'reverted'] as const

/** A stored version read back; null for one whose projection no longer reads. Its article is null when none was stored or it no longer reads. */
function versionFromRow(row: VersionRow): StoredVersion | null {
  const research = researchedStorySchema.safeParse(row.research)
  if (!research.success) return null
  const note = row.note === null ? null : citedTextSchema.safeParse(row.note)
  const article = row.draft === null ? null : appliedDraftSchema.safeParse(row.draft)
  return {
    id: row.id,
    number: row.number,
    kind: oneOf(row.kind, VERSION_KINDS, 'legacy'),
    status: oneOf(row.status, VERSION_STATUSES, 'superseded'),
    passId: row.passId,
    title: row.title,
    titleLabel: row.titleLabel,
    summary: row.summary,
    marketingBlurb: row.marketingBlurb,
    quote: row.quote,
    quoteAttribution: row.quoteAttribution,
    relevanceReasons: row.relevanceReasons,
    antifactors: row.antifactors,
    emotionTag: row.emotionTag,
    research: research.data,
    article: article?.success ? article.data : null,
    changes: changesSchema.parse(row.changes) as VersionChange[],
    note: note?.success ? note.data : null,
    createdAt: row.createdAt,
  }
}

/** A stored version, with the time it was made (the day its Update is dated). */
export type StoredVersion = ArticleVersionData & { id: string; createdAt: Date }

/** The story's current article version, or null: none, or one whose projection no longer reads. */
export async function currentVersion(db: ResearchDb, storyId: string): Promise<StoredVersion | null> {
  const [row] = await db.$queryRaw<VersionRow[]>`
    SELECT ${VERSION_COLUMNS} FROM article_versions v WHERE v.story_id = ${storyId} AND v.status = 'current'`
  return row ? versionFromRow(row) : null
}

/** Every version of the story that still reads, newest first: the history Updates and an undo are made from. */
export async function storyVersions(db: ResearchDb, storyId: string): Promise<StoredVersion[]> {
  const rows = await db.$queryRaw<VersionRow[]>`
    SELECT ${VERSION_COLUMNS} FROM article_versions v WHERE v.story_id = ${storyId} ORDER BY v.number DESC`
  return rows.flatMap(row => versionFromRow(row) ?? [])
}

/** A version as readers' Updates read it (`publicUpdates`): no draft, no story columns. */
export type PublicVersion = Pick<StoredVersion, 'number' | 'kind' | 'status' | 'research' | 'changes' | 'note' | 'createdAt'>

/**
 * The story's versions readers' Updates are made from, newest first: those not reverted that still
 * read, with only the columns `publicUpdates` reads, so a story page never reads drafts. The same
 * versions `storyVersions` gives once its reverted ones are left out.
 */
export async function publicVersions(db: ResearchDb, storyId: string): Promise<PublicVersion[]> {
  const rows = await db.$queryRaw<Pick<VersionRow, 'number' | 'kind' | 'status' | 'research' | 'changes' | 'note' | 'createdAt'>[]>`
    SELECT v.number, v.kind::text AS kind, v.status::text AS status, v.research, v.changes, v.note, v.created_at AS "createdAt"
    FROM article_versions v WHERE v.story_id = ${storyId} AND v.status <> 'reverted' ORDER BY v.number DESC`
  return rows.flatMap(row => {
    const research = researchedStorySchema.safeParse(row.research)
    if (!research.success) return []
    const note = row.note === null ? null : citedTextSchema.safeParse(row.note)
    return [
      {
        number: row.number,
        kind: oneOf(row.kind, VERSION_KINDS, 'legacy'),
        status: oneOf(row.status, VERSION_STATUSES, 'superseded'),
        research: research.data,
        changes: changesSchema.parse(row.changes) as VersionChange[],
        note: note?.success ? note.data : null,
        createdAt: row.createdAt,
      },
    ]
  })
}

/** The cards of the story's newest pass that wrote any, in order: the ones served once passes run. */
export async function newestPassBoxes(db: Pick<PrismaClient, 'passBox'>, storyId: string) {
  const newest = await db.passBox.findFirst({ where: { storyId }, orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }], select: { passId: true } })
  if (!newest) return []
  return db.passBox.findMany({ where: { storyId, passId: newest.passId }, orderBy: { position: 'asc' } })
}
