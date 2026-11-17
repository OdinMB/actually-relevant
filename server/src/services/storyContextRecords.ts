/**
 * Story context's records (`.context/story-context.md`, "Records"), both ways: a context fact's row
 * and the fact as the run, the view and the next story's input hold it; a box's row from the run's
 * draft, and a stored box's sentences and visual read back through their schemas; the refs a box
 * cites and the newest date its facts describe; a fact's identity across a story's runs (`factKey`)
 * and the editor's choices a new run's boxes take over (`editorChoices`); and the boxes and facts of
 * a story's newest run that wrote boxes. No I/O of its own: the one read goes through the client it is given, and the input's
 * SELECT (`storyContextInput.ts`) names its columns as a row's fields, so both readers map rows here.
 */
import type { ContextBox, ContextFact, Prisma, PrismaClient } from '@prisma/client'
import { dayStart, utcDay } from '../lib/days.js'
import {
  APPROX,
  CONTEXT_SLOTS,
  CREDITED_KINDS,
  VALIDITY,
  isContextSlot,
  storedSentencesSchema,
  storedVisualSchema,
  type ContextSlot,
  type StoredSentence,
  type StoredVisual,
} from '../schemas/storyContext.js'
import { normalizedUrl } from './researchFilter.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { asOfColumns, asOfFromColumns, factDate, periodStart } from './storyContextVisuals.js'

/** `value` when it is one of `allowed`, else `fallback`: a stored text column read back as its union. */
export const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback

/** A fact's source id from its ref: `S2F3` is source `S2`. */
export const sourceIdOf = (ref: string): string => ref.replace(/F\d+$/, '')

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** The columns a fact is read back from: a row of `context_facts`, as Prisma or the input's SELECT returns it. */
export type FactColumns = Pick<
  ContextFact,
  | 'id'
  | 'ref'
  | 'origin'
  | 'reusedFromId'
  | 'sourceUrl'
  | 'sourceOutlet'
  | 'sourceTitle'
  | 'sourceDate'
  | 'sourceKind'
  | 'supportingSentence'
  | 'passage'
  | 'supportFound'
  | 'statement'
  | 'value'
  | 'valueHigh'
  | 'unit'
  | 'approx'
  | 'provisional'
  | 'counted'
  | 'place'
  | 'asOf'
  | 'asOfPrecision'
  | 'credited'
  | 'creditedKind'
  | 'validity'
  | 'verdict'
  | 'verdictProblem'
  | 'model'
  | 'promptVersion'
>

/** A fact read back, with its record's id. The slot a search fact was extracted for is not stored. */
export type RecordedFact = ContextFactData & { id: string }

/** A fact as the page and the admin read it: whether a person demoted it, too. */
export type StoredContextFact = RecordedFact & { demoted: boolean }

export function factFromRow(row: FactColumns): RecordedFact {
  return {
    id: row.id,
    ref: row.ref,
    origin: row.origin === 'search' ? 'search' : 'research',
    reusedFromId: row.reusedFromId,
    slot: null,
    source: {
      id: sourceIdOf(row.ref),
      url: row.sourceUrl,
      outlet: row.sourceOutlet,
      title: row.sourceTitle,
      date: row.sourceDate ? utcDay(row.sourceDate) : null,
      kind: row.sourceKind,
    },
    supportingSentence: row.supportingSentence,
    passage: row.passage,
    supportFound: row.supportFound,
    statement: row.statement,
    value: row.value,
    valueHigh: row.valueHigh,
    unit: row.unit,
    approx: oneOf(row.approx, APPROX, 'exact'),
    provisional: row.provisional,
    counted: row.counted,
    place: row.place,
    asOf: asOfFromColumns(row.asOf, row.asOfPrecision),
    credited: row.credited,
    creditedKind: row.creditedKind === null ? null : oneOf(row.creditedKind, CREDITED_KINDS, 'other'),
    validity: oneOf(row.validity, VALIDITY, 'fast'),
    verdict: row.verdict,
    verdictProblem: row.verdictProblem,
    model: row.model,
    promptVersion: row.promptVersion,
  }
}

export const storedFact = (row: FactColumns & Pick<ContextFact, 'status'>): StoredContextFact => ({ ...factFromRow(row), demoted: row.status === 'demoted' })

const squashed = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * A fact's identity across runs of one story (`.context/story-context.md`, "On demand"): its page,
 * supporting sentence and statement, each normalized. A later run neither structures again nor
 * offers twice a fact an earlier run already holds under this key.
 */
export const factKey = (f: { url: string; supportingSentence: string; statement: string }): string =>
  [normalizedUrl(f.url), squashed(f.supportingSentence), squashed(f.statement)].join('\n')

/** Shown to readers: supported by its check and not demoted. */
export const shownFact = (f: ContextFactData & { demoted?: boolean }): boolean => f.verdict === 'supported' && f.demoted !== true

/** The row a run stores for one of its facts. */
export function factRow(storyId: string, runId: string, f: ContextFactData): Prisma.ContextFactCreateManyInput {
  const asOf = asOfColumns(f.asOf)
  return {
    storyId,
    runId,
    ref: f.ref,
    origin: f.origin,
    reusedFromId: f.reusedFromId,
    sourceUrl: f.source.url,
    sourceOutlet: f.source.outlet,
    sourceTitle: f.source.title,
    sourceDate: f.source.date ? dayStart(f.source.date) : null,
    sourceKind: f.source.kind,
    supportingSentence: f.supportingSentence,
    passage: f.passage,
    supportFound: f.supportFound,
    statement: f.statement,
    value: f.value,
    valueHigh: f.valueHigh,
    unit: f.unit,
    approx: f.approx,
    provisional: f.provisional,
    counted: f.counted,
    place: f.place,
    asOf: asOf.date,
    asOfPrecision: asOf.precision,
    credited: f.credited,
    creditedKind: f.creditedKind,
    validity: f.validity,
    verdict: f.verdict,
    verdictProblem: f.verdictProblem,
    model: f.model,
    promptVersion: f.promptVersion,
  }
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

/** What a box holds, as the run drafts it and as its row stores it. */
export interface BoxContent {
  sentences: StoredSentence[]
  visual: StoredVisual | null
}

/** The fact refs a box cites, once each: its sentences' first, then its tiles' or its chart's points, `apart` ones included. */
export function boxRefs(box: BoxContent): string[] {
  const v = box.visual
  const visual = !v ? [] : v.kind === 'tiles' ? v.tiles.flatMap(t => t.factIds) : [...v.points, ...(v.apart?.points ?? [])].map(p => p.factId)
  return [...new Set([...box.sentences.flatMap(s => s.factIds), ...visual])]
}

/** The newest date a box's facts describe (each fact's as-of, else its source's day); null when none is dated. */
export function boxAsOf(box: BoxContent, facts: ReadonlyMap<string, ContextFactData>): string | null {
  let newest: string | null = null
  for (const ref of boxRefs(box)) {
    const f = facts.get(ref)
    const date = f ? factDate({ asOf: f.asOf, sourceDate: f.source.date }) : null
    if (date && (newest === null || periodStart(date) > periodStart(newest))) newest = date
  }
  return newest
}

/** The row a run stores for one of its kept boxes, at `position`, with the newest as-of of its facts. */
export function boxRow(
  ids: { storyId: string; runId: string },
  box: DraftBox,
  position: number,
  facts: ReadonlyMap<string, ContextFactData>,
  writer: { model: string; promptVersion: string } | null,
  writtenAt: Date,
): Prisma.ContextBoxCreateManyInput {
  const asOf = asOfColumns(boxAsOf(box, facts))
  return {
    ...ids,
    position,
    type: box.type,
    heading: box.heading,
    teaser: box.teaser,
    sentences: box.sentences as unknown as Prisma.InputJsonArray,
    visual: box.visual === null ? undefined : (box.visual as unknown as Prisma.InputJsonObject),
    asOf: asOf.date,
    asOfPrecision: asOf.precision,
    place: box.place,
    model: writer?.model ?? null,
    promptVersion: writer?.promptVersion ?? null,
    writtenAt,
  }
}

/** What an editor chose for a box, as its row keeps it. */
type BoxChoice = Pick<Prisma.ContextBoxCreateManyInput, 'status' | 'place' | 'placeByEditor'>

/**
 * The editor's choices on an earlier run's boxes, carried to a new run's box of the same type (a run
 * keeps one box of each type): a hidden box (`demoted`) makes it hidden, a box the editor moved gives
 * it its place. Nothing for a choice the editor did not make, or a type the earlier run lacked.
 */
export function editorChoices(previous: Pick<ContextBox, 'type' | 'status' | 'place' | 'placeByEditor'>[]): (type: string) => BoxChoice {
  const byType = new Map(previous.map(b => [b.type as string, b]))
  return type => {
    const earlier = byType.get(type)
    if (!earlier) return {}
    return {
      ...(earlier.status === 'demoted' ? { status: 'demoted' as const } : {}),
      ...(earlier.placeByEditor ? { place: earlier.place, placeByEditor: true } : {}),
    }
  }
}

/** A stored box's sentences and visual, read through their schemas: an unreadable one counts as empty. */
export function boxContent(box: Pick<ContextBox, 'sentences' | 'visual'>): BoxContent {
  const sentences = storedSentencesSchema.safeParse(box.sentences)
  const visual = box.visual === null ? null : storedVisualSchema.safeParse(box.visual)
  return { sentences: sentences.success ? sentences.data : [], visual: visual?.success ? visual.data : null }
}

// ---------------------------------------------------------------------------
// A story's records
// ---------------------------------------------------------------------------

/** What `contextRecords` reads through: the app's client. */
export type RecordsDb = Pick<PrismaClient, 'contextBox' | 'contextFact'>

/** A stored box of one of the slots: every box but an In numbers box (`figures`) stored before 2026-11-17. */
export type SlotBox = ContextBox & { type: ContextSlot }

const isSlotBox = (box: ContextBox): box is SlotBox => isContextSlot(box.type)

/** The filter that reads back only the slots' boxes: an In numbers box stored before 2026-11-17 is neither served, listed nor edited, and stays stored. */
export const SLOT_TYPES = { in: [...CONTEXT_SLOTS] }

/** The boxes and facts of the story's newest run that wrote boxes of the slots, boxes in order, facts by ref. */
export async function contextRecords(db: RecordsDb, storyId: string): Promise<{ boxes: SlotBox[]; facts: Map<string, StoredContextFact> }> {
  const newest = await db.contextBox.findFirst({
    where: { storyId, type: SLOT_TYPES },
    orderBy: [{ writtenAt: 'desc' }, { id: 'desc' }],
    select: { runId: true },
  })
  if (!newest) return { boxes: [], facts: new Map() }
  const [boxes, facts] = await Promise.all([
    db.contextBox.findMany({ where: { storyId, runId: newest.runId, type: SLOT_TYPES }, orderBy: { position: 'asc' } }),
    db.contextFact.findMany({ where: { storyId, runId: newest.runId } }),
  ])
  return { boxes: boxes.filter(isSlotBox), facts: new Map(facts.map(f => [f.ref, storedFact(f)])) }
}
