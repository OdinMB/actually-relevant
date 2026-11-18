/**
 * The research passes' records (`.context/research-passes.md`, "Records"), both ways: a story's pool
 * (sources, facts, searches, the pages left out) and its current article version read back as the
 * pass pipeline's types (`researchPool.ts`), the cards of its newest pass that wrote any, and one
 * pass's result written in the caller's transaction. Reads are SELECT-only tagged `$queryRaw`
 * templates through the client given, so the eval's read-only session can read a pool too; the
 * write takes a transaction, so the pass lifecycle puts the story's own write beside it.
 */
import { Prisma, type EmotionTag, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { dayStart, utcDay } from '../lib/days.js'
import { APPROX, CREDITED_KINDS, VALIDITY, isContextSlot } from '../schemas/storyContext.js'
import { researchedStorySchema, citedTextSchema } from './researchedStory.js'
import type { ResearchDb } from './researchInput.js'
import { appliedDraftSchema } from './researchSwap.js'
import {
  poolFactKey,
  sourceKey,
  type ArticleVersionData,
  type DroppedSource,
  type Judge,
  type Pool,
  type PoolFact,
  type PoolSearch,
  type PoolSource,
  type VersionChange,
} from './researchPool.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { boxRow, editorChoices, oneOf } from './storyContextRecords.js'
import { asOfColumns, asOfFromColumns } from './storyContextVisuals.js'

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

/** The story's pool, in the order its rows were written: within one pass, sources and facts by ref, coverage searches before gap searches. */
export async function loadPool(db: ResearchDb, storyId: string): Promise<Pool> {
  const [sources, facts, searches] = await Promise.all([
    db.$queryRaw<SourceRow[]>`
      SELECT s.id, s.ref, s.origin, s.earlier_story_id AS "earlierStoryId", s.url, s.outlet, s.title,
             s.published_date AS "publishedDate", s.kind, s.country, s.relation, s.favicon,
             s.used_raw_content AS "usedRawContent", s.voices, s.opt_out_checked AS "optOutChecked",
             s.first_pass_id AS "firstPassId", s.drop_reason AS "dropReason", s.drop_pass_id AS "dropPassId"
      FROM evidence_sources s WHERE s.story_id = ${storyId}
      ORDER BY s.created_at, s.ref NULLS LAST, s.id`,
    db.$queryRaw<FactRow[]>`
      SELECT f.id, f.ref, s.ref AS "sourceRef", f.reused_from_id AS "reusedFromId", f.supporting_sentence AS "supportingSentence",
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
      WHERE f.story_id = ${storyId}
      ORDER BY f.created_at, f.ref, f.id`,
    db.$queryRaw<SearchRow[]>`
      SELECT e.kind, e.slot, e.angle, e.query, e.normalized_query AS "normalizedQuery", e.window_start AS "windowStart",
             e.window_end AS "windowEnd", e.depth, e.credits, e.results, e.cached, e.pass_id AS "passId"
      FROM evidence_searches e WHERE e.story_id = ${storyId}
      ORDER BY e.created_at, e.kind, e.slot NULLS FIRST, e.angle NULLS FIRST, e.normalized_query, e.id`,
  ])
  const used = sources.filter((s): s is SourceRow & { ref: string } => s.ref !== null && s.dropReason === null)
  const dropped: DroppedSource[] = sources.flatMap(s => (s.dropReason !== null ? [{ url: s.url, reason: s.dropReason, passId: s.dropPassId }] : []))
  return { sources: used.map(sourceFromRow), facts: facts.map(factFromRow), searches: searches.map(searchFromRow), dropped }
}

const changesSchema = z
  .array(z.object({ section: z.string(), before: citedTextSchema.nullable().catch(null), after: citedTextSchema.nullable().catch(null) }))
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

/** A stored version read back; null for one whose projection no longer reads. Its article is null when none was stored or it no longer reads. */
function versionFromRow(row: VersionRow): StoredVersion | null {
  const research = researchedStorySchema.safeParse(row.research)
  if (!research.success) return null
  const note = row.note === null ? null : citedTextSchema.safeParse(row.note)
  const article = row.draft === null ? null : appliedDraftSchema.safeParse(row.draft)
  return {
    id: row.id,
    number: row.number,
    kind: oneOf(row.kind, ['first', 'update', 'legacy'], 'legacy'),
    status: oneOf(row.status, ['current', 'superseded', 'reverted'], 'superseded'),
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

/** The cards of the story's newest pass that wrote any, in order: the ones served once passes run. */
export async function newestPassBoxes(db: Pick<PrismaClient, 'passBox'>, storyId: string) {
  const newest = await db.passBox.findFirst({ where: { storyId }, orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }], select: { passId: true } })
  if (!newest) return []
  return db.passBox.findMany({ where: { storyId, passId: newest.passId }, orderBy: { position: 'asc' } })
}

// ---------------------------------------------------------------------------
// Writing a pass
// ---------------------------------------------------------------------------

export interface PassRowResult {
  status: 'completed' | 'skipped' | 'failed'
  outcome: string
  verdict: string | null
  modelUsd: number
  credits: number
  /** What the pass cost: its model calls and its searches at their price. */
  costUsd: number
  record: unknown
  error: string | null
}

export interface PassWrite {
  storyId: string
  passId: string
  /** The pool after the pass: a source or fact with a null id is new, a search of this pass is new. */
  pool: Pool
  /** The refs of stored facts whose judgment the pass changed (verdict, structure, status). */
  changed: string[]
  /** A new version, made current. */
  version: ArticleVersionData | null
  boxes: DraftBox[]
  /** The facts the boxes cite, by ref, for their as-of dates. */
  boxFacts: ReadonlyMap<string, ContextFactData>
  writer: Judge | null
  pass: PassRowResult
  now: Date
}

const factColumns = (f: PoolFact) => {
  const s = f.structured
  const asOf = asOfColumns(s?.asOf ?? null)
  return {
    value: s?.value ?? null,
    valueHigh: s?.valueHigh ?? null,
    unit: s?.unit ?? '',
    approx: s?.approx ?? 'exact',
    provisional: s?.provisional ?? false,
    counted: s?.counted ?? '',
    place: s?.place ?? '',
    asOf: asOf.date,
    asOfPrecision: asOf.precision,
    credited: s?.credited ?? '',
    creditedKind: s?.creditedKind ?? null,
    validity: s?.validity ?? 'fixed',
    structureModel: s?.by.model ?? null,
    structurePromptVersion: s?.by.promptVersion ?? null,
    verdict: f.verdict,
    verdictProblem: f.verdictProblem,
    checkModel: f.checkedBy?.model ?? null,
    checkPromptVersion: f.checkedBy?.promptVersion ?? null,
    checkedPassId: f.checkedBy?.passId ?? null,
    status: f.status,
    droppedPassId: f.drop?.passId ?? null,
    dropReason: f.drop?.reason ?? null,
    contradictedBy: f.drop?.contradictedBy ?? [],
  }
}

const sourceColumns = (storyId: string, s: PoolSource) => ({
  storyId,
  ref: s.ref,
  origin: s.origin,
  earlierStoryId: s.earlierStoryId,
  url: s.url,
  normalizedUrl: sourceKey(s),
  outlet: s.outlet,
  title: s.title,
  publishedDate: s.date ? dayStart(s.date) : null,
  kind: s.kind,
  country: s.country,
  relation: s.relation,
  favicon: s.favicon,
  usedRawContent: s.usedRawContent,
  voices: s.voices as unknown as Prisma.InputJsonArray,
  optOutChecked: s.optOutChecked,
  firstPassId: s.firstPassId,
})

/** The editor's choices on the cards shown before this pass: the newest pass's, else the legacy context run's. */
async function previousChoices(tx: Prisma.TransactionClient, storyId: string, passId: string) {
  const select = { type: true, status: true, place: true, placeByEditor: true } as const
  const pass = await tx.passBox.findFirst({
    where: { storyId, passId: { not: passId } },
    orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }],
    select: { passId: true },
  })
  if (pass) return editorChoices(await tx.passBox.findMany({ where: { passId: pass.passId }, select }))
  const run = await tx.contextBox.findFirst({ where: { storyId }, orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }], select: { runId: true } })
  return editorChoices(run ? await tx.contextBox.findMany({ where: { runId: run.runId }, select }) : [])
}

/**
 * Write one pass's result in the caller's transaction, while the pass is still `running` (false, and
 * nothing written, once a restart marked it cut off): the pass row, its new searches, the pages it
 * left out, its new sources and facts (a fact the pool already holds by `poolFactKey` is not added
 * again), the judgments it changed on stored facts, its version (the current one superseded) and its
 * cards, each taking over the editor's choices on the card of its type shown before.
 */
export async function storePassResult(tx: Prisma.TransactionClient, w: PassWrite): Promise<boolean> {
  const { storyId, passId } = w
  const { count } = await tx.researchPass.updateMany({
    where: { id: passId, status: 'running' },
    data: {
      status: w.pass.status,
      outcome: w.pass.outcome,
      verdict: w.pass.verdict,
      costUsd: w.pass.costUsd,
      modelUsd: w.pass.modelUsd,
      tavilyCredits: w.pass.credits,
      record: w.pass.record as Prisma.InputJsonValue,
      error: w.pass.error,
      finishedAt: w.now,
    },
  })
  if (count === 0) return false

  await insertPoolRows(tx, storyId, {
    searches: w.pool.searches.filter(s => s.passId === passId),
    dropped: w.pool.dropped.filter(d => d.passId === passId),
    sources: w.pool.sources.filter(s => s.id === null),
    facts: w.pool.facts.filter(f => f.id === null),
  })
  const changed = new Set(w.changed)
  for (const f of w.pool.facts) {
    if (f.id !== null && changed.has(f.ref)) await tx.poolFact.update({ where: { id: f.id }, data: factColumns(f) })
  }

  if (w.version) {
    await tx.articleVersion.updateMany({ where: { storyId, status: 'current' }, data: { status: 'superseded' } })
    const versionId = await insertVersion(tx, storyId, { ...w.version, passId })
    await tx.researchPass.update({ where: { id: passId }, data: { versionId } })
  }

  if (w.boxes.length > 0) {
    const choice = await previousChoices(tx, storyId, passId)
    await tx.passBox.createMany({
      data: w.boxes.map((box, position) => {
        const { runId: _runId, gap: _gap, ...row } = boxRow({ storyId, runId: passId }, box, position, w.boxFacts, w.writer, w.now)
        return { ...row, passId, ...choice(box.type) }
      }),
    })
  }
  return true
}

/** New pool rows: what was searched, the pages left out, the sources, and the facts the pool does not hold yet by `poolFactKey`. */
export async function insertPoolRows(
  tx: Prisma.TransactionClient,
  storyId: string,
  rows: Pick<Pool, 'searches' | 'dropped' | 'sources' | 'facts'>,
): Promise<void> {
  const { searches, dropped } = rows
  if (searches.length > 0) {
    await tx.evidenceSearch.createMany({
      data: searches.map(s => ({
        storyId,
        passId: s.passId,
        kind: s.kind,
        slot: s.slot,
        angle: s.angle,
        query: s.query,
        normalizedQuery: s.normalizedQuery,
        windowStart: s.windowStart ? dayStart(s.windowStart) : null,
        windowEnd: s.windowEnd ? dayStart(s.windowEnd) : null,
        depth: s.depth,
        credits: s.credits,
        results: s.results,
        cached: s.cached,
      })),
    })
  }
  if (dropped.length > 0) {
    await tx.evidenceSource.createMany({
      data: dropped.map(d => ({
        storyId,
        ref: null,
        origin: 'search',
        url: d.url,
        normalizedUrl: sourceKey({ url: d.url, earlierStoryId: null }),
        dropReason: d.reason,
        dropPassId: d.passId,
      })),
      skipDuplicates: true,
    })
  }

  if (rows.sources.length > 0) await tx.evidenceSource.createMany({ data: rows.sources.map(s => sourceColumns(storyId, s)) })
  const stored = await tx.evidenceSource.findMany({ where: { storyId, ref: { not: null } }, select: { id: true, ref: true, url: true, earlierStoryId: true } })
  const sourceByRef = new Map(stored.map(s => [s.ref!, s]))

  const keys = new Set((await tx.poolFact.findMany({ where: { storyId }, select: { factKey: true } })).map(f => f.factKey))
  const newFacts = rows.facts.flatMap(f => {
    const source = sourceByRef.get(f.sourceRef)
    if (!source) return []
    const key = poolFactKey(f, source)
    if (keys.has(key)) return []
    keys.add(key)
    return [
      {
        storyId,
        sourceId: source.id,
        ref: f.ref,
        factKey: key,
        reusedFromId: f.reusedFromId,
        supportingSentence: f.supportingSentence,
        passage: f.passage,
        supportFound: f.supportFound,
        statement: f.statement,
        measures: f.measures,
        slot: f.slot,
        extractModel: f.extractedBy.model,
        extractPromptVersion: f.extractedBy.promptVersion,
        firstPassId: f.firstPassId,
        ...factColumns(f),
      },
    ]
  })
  if (newFacts.length > 0) await tx.poolFact.createMany({ data: newFacts })
}

/** A version row, made current (the caller supersedes the one before); its id. */
export async function insertVersion(tx: Prisma.TransactionClient, storyId: string, v: ArticleVersionData): Promise<string> {
  const created = await tx.articleVersion.create({
    data: {
      storyId,
      number: v.number,
      passId: v.passId,
      kind: v.kind,
      status: 'current',
      title: v.title,
      titleLabel: v.titleLabel,
      summary: v.summary,
      marketingBlurb: v.marketingBlurb,
      quote: v.quote,
      quoteAttribution: v.quoteAttribution,
      relevanceReasons: v.relevanceReasons,
      antifactors: v.antifactors,
      emotionTag: v.emotionTag as EmotionTag | null,
      research: v.research as unknown as Prisma.InputJsonObject,
      draft: v.article === null ? Prisma.DbNull : (v.article as unknown as Prisma.InputJsonObject),
      changes: v.changes as unknown as Prisma.InputJsonArray,
      note: v.note === null ? Prisma.DbNull : (v.note as unknown as Prisma.InputJsonObject),
    },
    select: { id: true },
  })
  return created.id
}
