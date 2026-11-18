/**
 * Writing a research pass's rows (`.context/research-passes.md`, "Records"), in the caller's
 * transaction: the pool rows it adds (searches, the pages it left out, sources, facts), the judgments
 * it changed on stored facts, its version (the current one superseded) and its cards, each taking over
 * the editor's choices on the card of its type shown before; the legacy import writes its pool rows
 * and version 1 through the same inserts. The pass row itself is the lifecycle's
 * (`researchPassLifecycle.ts`), which settles it first; what is read back is `passRecords.ts`'s.
 */
import { Prisma, type EmotionTag } from '@prisma/client'
import { dayStart, utcDay } from '../lib/days.js'
import { poolFactKey, sourceKey, type ArticleVersionData, type Judge, type Pool, type PoolFact, type PoolSource } from './researchPool.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { boxRow, editorChoices } from './storyContextRecords.js'
import { asOfColumns } from './storyContextVisuals.js'

/** The pass row's columns from its result, which the lifecycle writes when it settles the pass. */
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
 * Write one pass's rows in the caller's transaction, once the lifecycle settled its pass row: its new
 * searches, the pages it left out, its new sources and facts (a fact the pool already holds by
 * `poolFactKey` is not added again), the judgments it changed on stored facts, its version (the
 * current one superseded) and its cards. The new version's id, for the pass row; null for none.
 */
export async function storePassRows(tx: Prisma.TransactionClient, w: Omit<PassWrite, 'pass'>): Promise<string | null> {
  const { storyId, passId } = w
  await insertPoolRows(tx, storyId, {
    searches: w.pool.searches.filter(s => s.passId === passId),
    dropped: w.pool.dropped.filter(d => d.passId === passId),
    sources: w.pool.sources.filter(s => s.id === null),
    facts: w.pool.facts.filter(f => f.id === null),
  })
  const changed = new Set(w.changed)
  await updateFacts(
    tx,
    w.pool.facts.filter(f => f.id !== null && changed.has(f.ref)),
  )

  let versionId: string | null = null
  if (w.version) {
    await tx.articleVersion.updateMany({ where: { storyId, status: 'current' }, data: { status: 'superseded' } })
    // The next free number: an undone update keeps its number, so the one after the current may be taken
    const top = await tx.articleVersion.aggregate({ where: { storyId }, _max: { number: true } })
    versionId = await insertVersion(tx, storyId, { ...w.version, passId, number: (top._max.number ?? 0) + 1 })
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
  return versionId
}

/**
 * The judgments a pass changed on stored facts, in one statement however many it checked: each row
 * takes `factColumns`' values, the as-of as its day.
 */
async function updateFacts(tx: Prisma.TransactionClient, facts: PoolFact[]): Promise<void> {
  if (facts.length === 0) return
  const rows = facts.map(f => {
    const { asOf, ...columns } = factColumns(f)
    return { id: f.id, ...columns, asOf: asOf ? utcDay(asOf) : null }
  })
  await tx.$executeRaw`
    UPDATE pool_facts f SET
      "value" = v."value", value_high = v."valueHigh", unit = v.unit, approx = v.approx, provisional = v.provisional,
      counted = v.counted, place = v.place, as_of = v."asOf", as_of_precision = v."asOfPrecision", credited = v.credited,
      credited_kind = v."creditedKind", validity = v.validity::"ContextValidity", structure_model = v."structureModel",
      structure_prompt_version = v."structurePromptVersion", verdict = v.verdict::"ContextVerdict", verdict_problem = v."verdictProblem",
      check_model = v."checkModel", check_prompt_version = v."checkPromptVersion", checked_pass_id = v."checkedPassId",
      status = v.status::"JudgmentStatus", dropped_pass_id = v."droppedPassId", drop_reason = v."dropReason"::"FactDropReason",
      contradicted_by = v."contradictedBy"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(
      id text, "value" float8, "valueHigh" float8, unit text, approx text, provisional boolean, counted text, place text,
      "asOf" date, "asOfPrecision" text, credited text, "creditedKind" text, validity text, "structureModel" text,
      "structurePromptVersion" text, verdict text, "verdictProblem" text, "checkModel" text, "checkPromptVersion" text,
      "checkedPassId" text, status text, "droppedPassId" text, "dropReason" text, "contradictedBy" text[])
    WHERE f.id = v.id`
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
