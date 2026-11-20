/**
 * The one applier of the overview write model (`overviewChanges.ts`): a plan written in the
 * transaction given, over the rows read and locked in it. The overview row is locked first
 * (`SELECT … FOR UPDATE`), so two writes to one overview queue rather than plan on the same rows; each
 * change is then applied only while its row still holds `before`, and one that no longer does rolls
 * the whole write back.
 */
import { Prisma } from '@prisma/client'
import { slugify } from '../../utils/slugify.js'
import { ConflictError } from '../../utils/errors.js'
import {
  applied,
  changeSet,
  overviewChange,
  removesLink,
  settle,
  type Change,
  type DecisionDraft,
  type EntryRow,
  type OverviewFields,
  type Plan,
  type Rows,
} from '../overviewChanges.js'
import { parseCharter } from '../overviewInput.js'
import { PIPELINE } from '../overviewPlans.js'

export type Tx = Prisma.TransactionClient

/** A value as the JSON columns store it: dates as strings, nothing undefined. */
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue

const ROW = {
  id: true,
  issueId: true,
  foundedAt: true,
  title: true,
  slug: true,
  scope: true,
  status: true,
  closedAt: true,
  closedReason: true,
  closingSince: true,
  closingStoryId: true,
  closureReviewedAt: true,
  frozen: true,
  frozenBy: true,
  frozenAt: true,
  hidden: true,
  charter: true,
  charterModel: true,
  charterPromptVersion: true,
  recenteredAt: true,
  recenteredBy: true,
  recenterUndoneAt: true,
  recenterTriedAt: true,
  automatedRecenters: true,
  entriesAtLastReview: true,
  reviewedAt: true,
  reopenedAt: true,
  joinsCountedFrom: true,
  lockedOut: true,
  lastEntryAt: true,
} as const

const ENTRY = {
  id: true,
  overviewId: true,
  storyId: true,
  joinedBy: true,
  joinedAt: true,
  status: true,
  detachedBy: true,
  detachReason: true,
  detachedAt: true,
  locked: true,
  role: true,
  roleKind: true,
  story: { select: { status: true, datePublished: true } },
} as const

export const asEntryRow = ({ story, ...e }: Prisma.OverviewEntryGetPayload<{ select: typeof ENTRY }>): EntryRow => ({
  ...e,
  published: story?.status === 'published',
  datePublished: story?.datePublished ?? null,
})

export const ENTRY_ROW = ENTRY

/** An overview's rows, its row locked for the rest of the transaction; null when it is gone. */
export async function readRows(tx: Tx, overviewId: string): Promise<Rows | null> {
  await tx.$queryRaw`SELECT id FROM overviews WHERE id = ${overviewId} FOR UPDATE`
  const o = await tx.overview.findUnique({ where: { id: overviewId }, select: ROW })
  if (!o) return null
  const charter = parseCharter(o.charter)
  if (!charter) throw new ConflictError('The overview has no readable charter')
  const lockedOut = Array.isArray(o.lockedOut) ? o.lockedOut.filter((x): x is string => typeof x === 'string') : []
  const entries = (await tx.overviewEntry.findMany({ where: { overviewId }, select: ENTRY, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] })).map(asEntryRow)
  return { overview: { ...o, charter, lockedOut }, entries }
}

/** A free slug for an overview going public: its title's, or with `-2`, `-3` … when taken. */
async function freeSlug(tx: Tx, title: string): Promise<string> {
  const base = slugify(title)
  const taken = new Set((await tx.overview.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map(o => o.slug))
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

const jsonFields = <F extends Partial<OverviewFields>>({ charter, lockedOut, ...rest }: F) => ({
  rest,
  charter: charter === undefined ? undefined : json(charter),
  lockedOut: lockedOut === undefined ? undefined : json(lockedOut),
})

const overviewWhere = (before: Partial<OverviewFields>): Prisma.OverviewWhereInput => {
  const f = jsonFields(before)
  return {
    ...f.rest,
    ...(f.charter !== undefined ? { charter: { equals: f.charter } } : {}),
    ...(f.lockedOut !== undefined ? { lockedOut: { equals: f.lockedOut } } : {}),
  }
}

const overviewData = (after: Partial<OverviewFields>): Prisma.OverviewUpdateManyMutationInput => {
  const f = jsonFields(after)
  return { ...f.rest, ...(f.charter !== undefined ? { charter: f.charter } : {}), ...(f.lockedOut !== undefined ? { lockedOut: f.lockedOut } : {}) }
}

async function applyChange(tx: Tx, c: Change): Promise<void> {
  const done =
    c.table === 'overview'
      ? await tx.overview.updateMany({ where: { id: c.id, ...overviewWhere(c.before) }, data: overviewData(c.after) })
      : await tx.overviewEntry.updateMany({ where: { id: c.id, ...c.before }, data: c.after })
  if (done.count === 0) throw new ConflictError('The overview changed meanwhile: reload the page and try again')
}

const createDecision = (tx: Tx, d: DecisionDraft, inputs: object) =>
  tx.overviewDecision.create({
    data: {
      id: d.id,
      kind: d.kind,
      outcome: d.outcome,
      overviewId: d.overviewId,
      storyId: d.storyId,
      inputs: json(inputs),
      answer: d.answer === null || d.answer === undefined ? Prisma.DbNull : json(d.answer),
      model: d.model,
      promptVersion: d.promptVersion,
      confidence: d.confidence,
      costUsd: d.costUsd,
      actor: d.actor,
    },
    select: { id: true },
  })

export interface Applied {
  decisionId: string
  /** The write took a public link away: the caller empties the caches holding links once it commits. */
  removed: boolean
}

/**
 * Writes a plan: settled first (the scope and the last entry its entries leave), given its slug when it
 * makes the overview public for the first time; then the overview it founds, its decision with the
 * change set (`changeSet`: one change per row and the rows it created), the decisions written with it,
 * the entries it creates, and its changes, each only while its row holds `before`; then the live link
 * decisions it undoes, and for an undo of an undo the decisions below it in the chain live or undone
 * again, an undone one by the plan's actor (one undone already keeps who undid it). `rows` are what it
 * was planned on (null for a founding).
 */
export async function applyPlan(tx: Tx, rows: Rows | null, planned: Plan, now: Date): Promise<Applied> {
  let p = settle(rows, planned)
  if (p.needsSlug) {
    const after = applied(rows, p).overview
    if (after.slug === null) p = { ...p, changes: [...p.changes, ...overviewChange(after, { slug: await freeSlug(tx, after.title) })] }
  }
  const { changes, created } = changeSet(p)
  const n = p.newOverview
  if (n)
    await tx.overview.create({
      data: {
        id: n.id,
        title: n.title,
        issueId: n.issueId,
        scope: 'single',
        status: 'open',
        charter: json(n.charter),
        charterModel: n.charterModel,
        charterPromptVersion: n.charterPromptVersion,
        foundedAt: n.foundedAt,
      },
    })
  await createDecision(tx, p.decision, { ...p.decision.inputs, changes, created })
  for (const d of p.also) await createDecision(tx, d, d.inputs)
  for (const e of p.newEntries)
    await tx.overviewEntry.create({
      data: {
        id: e.id,
        overviewId: e.overviewId,
        storyId: e.storyId,
        joinedBy: e.joinedBy,
        joinedAt: e.joinedAt,
        decisionId: e.decisionId,
        ...e.fields,
        shared: e.shared === null ? Prisma.DbNull : json(e.shared),
        confidence: e.confidence,
        model: e.model,
        promptVersion: e.promptVersion,
      },
    })
  for (const c of changes) await applyChange(tx, c)
  if (p.undoesLinksOf)
    await tx.overviewDecision.updateMany({ where: { storyId: p.undoesLinksOf, kind: 'link', undoneAt: null }, data: { undoneAt: now, undoneBy: PIPELINE } })
  for (const m of p.chain) {
    if (m.undone) await tx.overviewDecision.updateMany({ where: { id: m.decisionId, undoneAt: null }, data: { undoneAt: now, undoneBy: p.decision.actor } })
    else await tx.overviewDecision.updateMany({ where: { id: m.decisionId }, data: { undoneAt: null, undoneBy: null } })
  }
  return { decisionId: p.decision.id, removed: removesLink(p.wasPublic, changes) }
}

/** The one-active-entry index (or another unique index) refused the write. */
export const refusedByIndex = (error: unknown): boolean =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
  /overview_entries_one_active|23505/.test(String((error as Error | null)?.message))
