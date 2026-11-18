/**
 * The only writer of the four overview tables (`overviews`, `overview_entries`, `overview_stands`,
 * `overview_decisions`; a fence test holds it, `test/overviewWriters.test.ts`; `.context/overviews.md`,
 * "Records"). Each write is one transaction, and every automated change is logged as a decision:
 * - one story's linking (`applyLink`): the memberships read again first, so a result made stale by an
 *   earlier write of the same run is asked again rather than written; then the join, or the founding
 *   (the overview, both entries, its `found` decision and both stories' `link` decisions), or the
 *   story left alone, each a `link` decision. A write the one-active-entry index refuses (an editor's
 *   attach at the same moment) is rolled back and logged as a `conflict`, which the next run retries;
 * - the upkeep after linking: an end-event closing begun (`applyClosing`, a `close` decision), the
 *   status machine's moves and a burst's freeze (`applyStatus`, `applyBurst`, `status` decisions), a
 *   review's actions and the audit's findings (`applyReview`, `applyAudit`, `review` decisions), and a
 *   stands refresh (`applyStands`, a `stands` decision, and a new current version when one is written);
 * - an editor's action and Undo (`editorAction`, `undoDecision`): the change set `overviewEdits.ts`
 *   plans, logged with its changes as the editor's decision or an `undo`.
 * Each move is applied only from the state it was computed on (a conditional update), so a change made
 * meanwhile is never overwritten.
 */
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { OVERVIEW_PROMPT_VERSIONS } from '../prompts/overviews.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { slugify } from '../utils/slugify.js'
import { membershipsOf } from './overviewCandidates.js'
import type { CloseCase, CloseResult } from './overviewClose.js'
import { planEdit, planUndo, type Change, type EditEntry, type EditOverview, type EditPlan, type EditorAction, type OverviewFields } from './overviewEdits.js'
import { parseCharter } from './overviewInput.js'
import { isStale, type ApplyOutcome, type LinkResult } from './overviewLink.js'
import type { AuditResult, ReviewCase, ReviewResult } from './overviewReview.js'
import type { StandsResult } from './overviewStands.js'
import type { StatusMove } from './overviewStatus.js'
import { SETTLING_OUTCOMES, type LinkOutcome, type OverviewState, type Role } from './overviewTypes.js'
import type { StandsCase } from './overviewUpkeep.js'

/** Who an automated write names (`actor`, `joined_by`). */
export const PIPELINE = 'pipeline'

type Tx = Prisma.TransactionClient

/** A value as the JSON columns store it: dates as strings, nothing undefined. */
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue

/**
 * What a `link` decision keeps of the call: the candidates shown, the yeses code refused and why, and
 * whether a join reports its overview's end event (what the closing checks look for, `pendingClosings`).
 */
const linkInputs = (result: LinkResult) =>
  json({ shown: result.shown, proposed: result.proposed, refusals: result.refusals, reportsEndEvent: result.join?.reportsEndEvent ?? false })

async function linkDecision(tx: Tx, result: LinkResult, outcome: LinkOutcome, overviewId: string | null = null, confidence: number | null = null) {
  return tx.overviewDecision.create({
    data: {
      kind: 'link',
      storyId: result.story.id,
      overviewId,
      outcome,
      inputs: linkInputs(result),
      answer: result.answer ? json(result.answer) : Prisma.DbNull,
      model: result.model,
      promptVersion: result.promptVersion,
      confidence,
      costUsd: result.costUsd,
      actor: PIPELINE,
    },
    select: { id: true },
  })
}

/** The founding attempt's own decision, whatever its outcome; the overview's id once founded. */
async function foundDecision(tx: Tx, result: LinkResult, overviewId: string | null) {
  const f = result.founding!
  return tx.overviewDecision.create({
    data: {
      kind: 'found',
      storyId: result.story.id,
      overviewId,
      outcome: f.outcome,
      inputs: json({ partnerId: f.partner.id }),
      answer: json(f.answers),
      model: f.model,
      promptVersion: `${OVERVIEW_PROMPT_VERSIONS.found}+${OVERVIEW_PROMPT_VERSIONS.foundCheck}`,
      confidence: f.confidence,
      costUsd: f.costUsd,
      actor: PIPELINE,
    },
    select: { id: true },
  })
}

const later = (a: Date | null, b: Date): Date => (a && a.getTime() > b.getTime() ? a : b)

async function join(tx: Tx, result: LinkResult): Promise<LinkOutcome> {
  const j = result.join!
  const overview = await tx.overview.findUnique({
    where: { id: j.candidate.id },
    select: { status: true, closedReason: true, frozen: true, lastEntryAt: true },
  })
  if (!overview || (overview.status === 'closed' && overview.closedReason !== 'faded')) {
    await linkDecision(tx, result, 'conflict', j.candidate.id)
    return 'conflict'
  }
  if (overview.frozen) {
    await linkDecision(tx, result, 'held', j.candidate.id)
    return 'held'
  }
  const decision = await linkDecision(tx, result, 'joined', j.candidate.id, j.answer.confidence)
  await tx.overviewEntry.create({
    data: {
      overviewId: j.candidate.id,
      storyId: result.story.id,
      role: result.role?.role ?? 'routine',
      roleKind: result.role?.roleKind ?? null,
      joinedBy: PIPELINE,
      shared: json(j.shared),
      confidence: j.answer.confidence,
      model: result.model,
      promptVersion: result.promptVersion,
      decisionId: decision.id,
    },
  })
  // An entry opens a quiet overview, and reopens a faded one (`.context/overviews.md`, "When overviews go quiet, close and reopen")
  const reopens = overview.status === 'quiet' || overview.status === 'closed'
  await tx.overview.update({
    where: { id: j.candidate.id },
    data: {
      lastEntryAt: later(overview.lastEntryAt, result.story.datePublished),
      ...(reopens ? { status: 'open', closedAt: null, closedReason: null, closingSince: null } : {}),
    },
  })
  return 'joined'
}

async function founded(tx: Tx, result: LinkResult): Promise<LinkOutcome> {
  const f = result.founding!
  const draft = f.draft!
  const [earlier, newer] = f.partner.datePublished.getTime() <= result.story.datePublished.getTime() ? [f.partner, result.story] : [result.story, f.partner]
  const overview = await tx.overview.create({
    data: {
      title: draft.title,
      issueId: result.story.issueId ?? f.partner.issueId,
      scope: 'forming',
      status: 'open',
      charter: json(draft.charter),
      charterModel: f.model ?? '',
      charterPromptVersion: OVERVIEW_PROMPT_VERSIONS.found,
      foundedAt: earlier.datePublished,
      lastEntryAt: newer.datePublished,
    },
    select: { id: true },
  })
  await foundDecision(tx, result, overview.id)
  const storyDecision = await linkDecision(tx, result, 'founded', overview.id, f.confidence)
  const partnerDecision = await tx.overviewDecision.create({
    data: {
      kind: 'link',
      storyId: f.partner.id,
      overviewId: overview.id,
      outcome: 'founded',
      inputs: json({ foundedWith: result.story.id }),
      confidence: f.confidence,
      actor: PIPELINE,
    },
    select: { id: true },
  })
  const storyIsA = earlier.id === result.story.id
  const entry = (storyId: string, role: Role, decisionId: string, shared: unknown) => ({
    overviewId: overview.id,
    storyId,
    role: role.role,
    roleKind: role.roleKind,
    joinedBy: PIPELINE,
    shared: json(shared),
    confidence: f.confidence,
    model: f.model,
    promptVersion: OVERVIEW_PROMPT_VERSIONS.found,
    decisionId,
  })
  await tx.overviewEntry.createMany({
    data: [
      entry(result.story.id, storyIsA ? draft.roles.a : draft.roles.b, storyDecision.id, f.shared),
      // The partner's side of the same shared fields: its quotes are the answer's `other`
      entry(f.partner.id, storyIsA ? draft.roles.b : draft.roles.a, partnerDecision.id, {
        cause: { story: f.shared.cause.other, other: f.shared.cause.story },
        place: { story: f.shared.place.other, other: f.shared.place.story },
        end: { story: f.shared.end.other, other: f.shared.end.story },
      }),
    ],
  })
  return 'founded'
}

/** The one-active-entry index (or another unique index) refused the write. */
const refusedByIndex = (error: unknown): boolean =>
  (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
  /overview_entries_one_active|23505/.test(String((error as Error | null)?.message))

/**
 * Writes one story's linking (`.context/overviews.md`, "How a story is linked"). Nothing is written
 * for a story that has an active entry or a settling `link` decision by now (it was linked meanwhile,
 * as a founding partner); a result whose founding partner has joined an overview since is `stale`,
 * and on its `lastTry` a `conflict`. Each other outcome is stored as the story's `link` decision.
 */
export async function applyLink(result: LinkResult, lastTry: boolean, db: typeof prisma = prisma): Promise<ApplyOutcome> {
  try {
    return await db.$transaction(async tx => {
      const memberships = await membershipsOf(tx, [result.story.id, ...result.shown.partners.map(p => p.id)])
      const settled = await tx.overviewDecision.findFirst({
        where: { storyId: result.story.id, kind: 'link', undoneAt: null, outcome: { in: [...SETTLING_OUTCOMES] } },
        select: { id: true },
      })
      if (memberships.active.has(result.story.id) || settled) return { kind: 'skipped' } as const
      if (isStale(result, memberships)) {
        if (!lastTry) return { kind: 'stale' } as const
        await linkDecision(tx, result, 'conflict')
        return { kind: 'written', outcome: 'conflict' } as const
      }
      let outcome: LinkOutcome = result.outcome
      if (result.outcome === 'joined') outcome = await join(tx, result)
      else if (result.outcome === 'founded') outcome = await founded(tx, result)
      else {
        if (result.founding) await foundDecision(tx, result, null)
        await linkDecision(tx, result, result.outcome, result.join?.candidate.id ?? null)
      }
      return { kind: 'written', outcome } as const
    })
  } catch (error) {
    if (!refusedByIndex(error)) throw error
    await db.overviewDecision.create({
      data: { kind: 'link', storyId: result.story.id, outcome: 'conflict', inputs: linkInputs(result), costUsd: result.costUsd, actor: PIPELINE },
    })
    return { kind: 'written', outcome: 'conflict' }
  }
}

// ---------------------------------------------------------------------------
// The upkeep after linking: closing, status, reviews, stands
// ---------------------------------------------------------------------------

/** Who a review's writes name (`actor`, `detached_by`). */
export const REVIEWER = 'review'

/** The newest active entry of a published story, as `last_entry_at` holds it, after entries left. */
async function refreshLastEntry(tx: Tx, overviewId: string) {
  const newest = await tx.overviewEntry.findFirst({
    where: { overviewId, status: 'active', story: { status: 'published' } },
    orderBy: { story: { datePublished: 'desc' } },
    select: { story: { select: { datePublished: true } } },
  })
  await tx.overview.update({ where: { id: overviewId }, data: { lastEntryAt: newest?.story?.datePublished ?? null } })
}

const statusDecision = (tx: Tx, overviewId: string, storyId: string | null, outcome: string, inputs: unknown) =>
  tx.overviewDecision.create({ data: { kind: 'status', overviewId, storyId, outcome, inputs: json(inputs), actor: PIPELINE } })

/**
 * An end-event check's result (`.context/overviews.md`, "Status, closing and reviews"), logged as a
 * `close` decision on the story, which settles it unless the check `failed`. On agreement the overview
 * starts closing from the story's publication date, if it is still open or quiet and not frozen
 * (`stale` otherwise).
 */
export async function applyClosing(c: CloseCase, result: CloseResult, db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(async tx => {
    let outcome: string = result.outcome
    if (result.outcome === 'closing') {
      const moved = await tx.overview.updateMany({
        where: { id: c.overviewId, status: { in: ['open', 'quiet'] }, frozen: false },
        data: { status: 'closing', closingSince: c.story.datePublished },
      })
      if (moved.count === 0) outcome = 'stale'
    }
    await tx.overviewDecision.create({
      data: {
        kind: 'close',
        overviewId: c.overviewId,
        storyId: c.story.id,
        outcome,
        inputs: json({ endEvent: c.charter.endEvent }),
        answer: json(result.answers),
        model: result.model,
        promptVersion: result.promptVersion,
        costUsd: result.costUsd,
        actor: PIPELINE,
      },
    })
  })
}

/**
 * The status machine's moves for one overview (`nextState`), each logged as a `status` decision:
 * - an entry whose story is no longer published is detached (`unpublished`, by the pipeline, not
 *   locked), and the story's link decisions undone, so a story published again is linked afresh;
 * - a scope or status moved only from the one it was computed from; closing records the day in
 *   development time (`clock`), and an overview that opens again (a faded one reopened, a closing
 *   cancelled) loses its closing and closure;
 * - a closing whose end-event story was just detached as unpublished is cancelled, frozen or not.
 */
export async function applyStatus(state: OverviewState, moves: readonly StatusMove[], clock: Date, db: typeof prisma = prisma): Promise<void> {
  const now = new Date()
  await db.$transaction(async tx => {
    let detached = false
    for (const m of moves) {
      if (m.kind === 'detach') {
        const done = await tx.overviewEntry.updateMany({
          where: { id: m.entryId, status: 'active' },
          data: { status: 'detached', detachedBy: PIPELINE, detachReason: 'unpublished', detachedAt: now },
        })
        if (done.count === 0) continue
        detached = true
        await tx.overviewDecision.updateMany({ where: { storyId: m.storyId, kind: 'link', undoneAt: null }, data: { undoneAt: now, undoneBy: PIPELINE } })
        await statusDecision(tx, state.id, m.storyId, 'detached', { entryId: m.entryId, reason: 'unpublished' })
      } else if (m.kind === 'scope') {
        const done = await tx.overview.updateMany({ where: { id: state.id, scope: m.from }, data: { scope: m.to } })
        if (done.count > 0) await statusDecision(tx, state.id, null, m.to, { from: m.from, to: m.to })
      } else if (m.kind === 'cancel_closing') {
        // Frozen or not: the unpublished-member rule
        const done = await tx.overview.updateMany({ where: { id: state.id, status: 'closing' }, data: { status: 'open', closingSince: null } })
        if (done.count > 0)
          await statusDecision(tx, state.id, m.storyId, 'open', { from: 'closing', to: 'open', reason: 'closing_cancelled', by: 'unpublished' })
      } else {
        const data: Prisma.OverviewUpdateManyMutationInput =
          m.to === 'closed'
            ? { status: 'closed', closedAt: clock, closedReason: m.reason }
            : m.to === 'open'
              ? { status: 'open', closedAt: null, closedReason: null, closingSince: null }
              : { status: m.to }
        const done = await tx.overview.updateMany({ where: { id: state.id, status: m.from, frozen: false }, data })
        if (done.count > 0) await statusDecision(tx, state.id, null, m.to, { from: m.from, to: m.to, reason: m.reason, clock })
      }
    }
    if (detached) await refreshLastEntry(tx, state.id)
  })
}

/** A burst (`anomalies`): the overview frozen, so automation pauses until its review, logged as a `frozen` status decision. */
export async function applyBurst(state: OverviewState, db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(async tx => {
    const done = await tx.overview.updateMany({ where: { id: state.id, frozen: false }, data: { frozen: true } })
    if (done.count > 0) await statusDecision(tx, state.id, null, 'frozen', { anomaly: 'burst', joins: state.burstJoins })
  })
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

/**
 * A review's result (`.context/overviews.md`, "Reviews"), logged as a `review` decision with its
 * trigger, actions and refusals (and, for a closure's, the closing it was for). A failed review acts
 * on nothing. Otherwise its actions: an entry detached (`review`, never one an editor attached) keeps
 * its story's link decision, so the story is not linked again; a role relabeled; the charter narrowed;
 * the title changed; a freeze cleared. The scope it leaves, the entries kept and the review's time are
 * recorded; an overview made public for the first time is given its slug, never changed after; and a
 * closing whose end-event story the review detached is cancelled.
 */
export async function applyReview(c: ReviewCase, result: ReviewResult, now: Date, db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(async tx => {
    const overview = await tx.overview.findUnique({ where: { id: c.overviewId }, select: { closingSince: true, slug: true, status: true } })
    await tx.overviewDecision.create({
      data: {
        kind: 'review',
        overviewId: c.overviewId,
        outcome: result.outcome,
        inputs: json({
          trigger: result.trigger,
          closingSince: result.trigger === 'closure' ? (overview?.closingSince ?? null) : null,
          actions: result.actions,
          refusals: result.refusals,
          kept: result.kept,
          scope: result.scope,
        }),
        answer: result.answer ? json(result.answer) : Prisma.DbNull,
        model: result.model,
        promptVersion: result.promptVersion,
        costUsd: result.costUsd,
        actor: REVIEWER,
      },
    })
    if (result.outcome !== 'reviewed' || !overview) return
    let detached = false
    const data: Prisma.OverviewUpdateInput = { scope: result.scope, entriesAtLastReview: result.kept, reviewedAt: now }
    for (const a of result.actions) {
      if (a.kind === 'detach') {
        const done = await tx.overviewEntry.updateMany({
          where: { id: a.entryId, status: 'active', locked: false },
          data: { status: 'detached', detachedBy: REVIEWER, detachReason: 'review', detachedAt: now },
        })
        detached ||= done.count > 0
      } else if (a.kind === 'relabel') {
        await tx.overviewEntry.updateMany({ where: { id: a.entryId, status: 'active', locked: false }, data: { role: a.to.role, roleKind: a.to.roleKind } })
      } else if (a.kind === 'narrow') data.charter = json(a.charter)
      else if (a.kind === 'retitle') data.title = a.to
      else data.frozen = false
    }
    if (result.scope === 'ongoing' && !overview.slug) data.slug = await freeSlug(tx, typeof data.title === 'string' ? data.title : c.title)
    if (result.cancelsClosing && overview.status === 'closing') Object.assign(data, { status: 'open', closingSince: null })
    await tx.overview.update({ where: { id: c.overviewId }, data })
    if (result.cancelsClosing && overview.status === 'closing')
      await statusDecision(tx, c.overviewId, c.closingStoryId, 'open', { from: 'closing', to: 'open', reason: 'closing_cancelled', by: 'review' })
    if (detached) await refreshLastEntry(tx, c.overviewId)
  })
}

/** The monthly audit's findings, logged as an `audited` review decision and never applied. */
export async function applyAudit(c: ReviewCase, result: AuditResult, db: typeof prisma = prisma): Promise<void> {
  await db.overviewDecision.create({
    data: {
      kind: 'review',
      overviewId: c.overviewId,
      outcome: result.outcome === 'reviewed' ? 'audited' : 'failed',
      inputs: json({
        trigger: 'audit',
        entries: result.entries,
        wrongJoins: result.wrongJoins,
        wrongRoles: result.wrongRoles,
        errorRate: result.errorRate,
        actions: result.actions,
        refusals: result.refusals,
      }),
      answer: result.answer ? json(result.answer) : Prisma.DbNull,
      model: result.model,
      promptVersion: result.promptVersion,
      costUsd: result.costUsd,
      actor: REVIEWER,
    },
  })
}

/**
 * A stands refresh (`.context/overviews.md`, "Where this stands"), logged as a `stands` decision with
 * the signature it was made for (none for a failed one, which the next run tries again). A version
 * written becomes the one current version, the previous one superseded; with too few facts the current
 * version is superseded and none replaces it; when nothing survived the checks the previous one stays.
 */
export async function applyStands(c: StandsCase, result: StandsResult, signature: string | null, today: string, db: typeof prisma = prisma): Promise<void> {
  const record = { drops: result.drops, checked: result.checked, failed: result.failed }
  await db.$transaction(async tx => {
    await tx.overviewDecision.create({
      data: {
        kind: 'stands',
        overviewId: c.overviewId,
        outcome: result.outcome,
        inputs: json({ signature, offered: result.offered.map(o => o.id), ...record }),
        model: result.model,
        promptVersion: result.promptVersion,
        costUsd: result.costUsd,
        actor: PIPELINE,
      },
    })
    if (result.outcome !== 'written' && result.outcome !== 'too_few_facts') return
    await tx.overviewStands.updateMany({ where: { overviewId: c.overviewId, status: 'current' }, data: { status: 'superseded' } })
    if (result.outcome !== 'written') return
    const last = await tx.overviewStands.findFirst({ where: { overviewId: c.overviewId }, orderBy: { number: 'desc' }, select: { number: true } })
    await tx.overviewStands.create({
      data: {
        overviewId: c.overviewId,
        number: (last?.number ?? 0) + 1,
        sentences: json(result.sentences),
        doing: json(result.doing),
        factsSeen: json(result.offered.map(o => ({ id: o.id, storyId: o.storyId, ref: o.ref, current: o.current }))),
        asOf: new Date(`${today}T00:00:00Z`),
        model: result.model ?? '',
        promptVersion: result.promptVersion,
        record: json(record),
      },
    })
  })
}

// ---------------------------------------------------------------------------
// An editor's actions and Undo
// ---------------------------------------------------------------------------

const EDIT_OVERVIEW = {
  id: true,
  title: true,
  scope: true,
  status: true,
  closedAt: true,
  closedReason: true,
  closingSince: true,
  frozen: true,
  hidden: true,
  charter: true,
} as const

const EDIT_ENTRY = {
  id: true,
  storyId: true,
  status: true,
  detachedBy: true,
  detachReason: true,
  detachedAt: true,
  locked: true,
  role: true,
  roleKind: true,
  story: { select: { status: true } },
} as const

const asEditEntry = ({ story, ...e }: Prisma.OverviewEntryGetPayload<{ select: typeof EDIT_ENTRY }>): EditEntry => ({
  ...e,
  published: story?.status === 'published',
})

/** The overview as an edit reads it: its fields, its active entries of published stories, and while closing the story that began it. */
async function editOverview(tx: Tx, id: string): Promise<EditOverview> {
  const o = await tx.overview.findUnique({ where: { id }, select: EDIT_OVERVIEW })
  if (!o) throw new NotFoundError('Overview not found')
  const charter = parseCharter(o.charter)
  if (!charter) throw new ConflictError('The overview has no readable charter')
  const activeEntries = await tx.overviewEntry.count({ where: { overviewId: id, status: 'active', story: { status: 'published' } } })
  const closing =
    o.status === 'closing'
      ? await tx.overviewDecision.findFirst({
          where: { overviewId: id, kind: 'close', outcome: 'closing', undoneAt: null },
          orderBy: { createdAt: 'desc' },
          select: { storyId: true },
        })
      : null
  return { ...o, charter, activeEntries, closingStoryId: closing?.storyId ?? null }
}

/** What an attach reads of the story: published or not, the overview it is in now, and its newest detached row in this one. */
async function attachStory(tx: Tx, overviewId: string, storyId: string) {
  const story = await tx.story.findUnique({ where: { id: storyId }, select: { status: true } })
  if (!story) throw new NotFoundError('Story not found')
  const active = await tx.overviewEntry.findFirst({ where: { storyId, status: 'active' }, select: { overviewId: true, overview: { select: { title: true } } } })
  const here = await tx.overviewEntry.findFirst({ where: { storyId, overviewId, status: 'detached' }, orderBy: { detachedAt: 'desc' }, select: EDIT_ENTRY })
  return {
    id: storyId,
    published: story.status === 'published',
    activeIn: active ? { overviewId: active.overviewId, title: active.overview.title } : null,
    rowHere: here ? asEditEntry(here) : null,
  }
}

const overviewWhere = ({ charter, ...rest }: Partial<OverviewFields>): Prisma.OverviewWhereInput => ({
  ...rest,
  ...(charter ? { charter: { equals: json(charter) } } : {}),
})
const overviewData = ({ charter, ...rest }: Partial<OverviewFields>): Prisma.OverviewUpdateManyMutationInput => ({
  ...rest,
  ...(charter ? { charter: json(charter) } : {}),
})

/** A plan's changes, each only while its row still holds `before`; one that no longer does rolls the whole plan back. */
async function applyChanges(tx: Tx, changes: readonly Change[]): Promise<void> {
  for (const c of changes) {
    const done =
      c.table === 'overview'
        ? await tx.overview.updateMany({ where: { id: c.id, ...overviewWhere(c.before) }, data: overviewData(c.after) })
        : await tx.overviewEntry.updateMany({ where: { id: c.id, ...c.before }, data: c.after })
    if (done.count === 0) throw new ConflictError('The overview changed meanwhile: reload the page and try again')
  }
}

/** Logs the plan as its decision, with its changes (and for an undo the decision it undid), then applies it. */
async function applyPlan(tx: Tx, plan: EditPlan, editorId: string, target: string | null): Promise<string> {
  const decision = await tx.overviewDecision.create({
    data: {
      kind: plan.kind,
      overviewId: plan.overviewId,
      storyId: plan.storyId,
      outcome: plan.outcome,
      inputs: json({ changes: plan.changes, target, reopens: plan.reopens }),
      actor: editorId,
    },
    select: { id: true },
  })
  if (plan.create)
    await tx.overviewEntry.create({
      data: {
        id: plan.create.id,
        overviewId: plan.overviewId,
        storyId: plan.create.storyId,
        joinedBy: 'editor',
        decisionId: decision.id,
        ...plan.create.fields,
      },
    })
  await applyChanges(tx, plan.changes)
  if (plan.changes.some(c => c.table === 'entry')) await refreshLastEntry(tx, plan.overviewId)
  return decision.id
}

/** A write the one-active-entry index refused, in the editor's words. */
async function editorWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (refusedByIndex(error)) throw new ConflictError('The story is in another overview now: reload the page')
    throw error
  }
}

/**
 * An editor's action (`.context/overviews.md`, "Editor actions and undo"): planned by `planEdit` from
 * the rows read in the same transaction, logged as its `editor_*` decision with the changes it made,
 * and applied while the rows still hold what it was planned on. Refusals are ServiceErrors (404 for an
 * unknown overview, entry or story; 409 otherwise).
 */
export async function editorAction(action: EditorAction, editorId: string, db: typeof prisma = prisma): Promise<{ decisionId: string }> {
  return editorWrite(() =>
    db.$transaction(async tx => {
      const o = await editOverview(tx, action.overviewId)
      const rows: Parameters<typeof planEdit>[2] = {}
      if (action.kind === 'detach' || action.kind === 'role') {
        const e = await tx.overviewEntry.findFirst({ where: { id: action.entryId, overviewId: o.id }, select: EDIT_ENTRY })
        if (!e) throw new NotFoundError('Entry not found')
        rows.entry = asEditEntry(e)
      } else if (action.kind === 'attach') {
        rows.story = await attachStory(tx, o.id, action.storyId)
        rows.newEntryId = randomUUID()
      }
      const plan = planEdit(action, o, rows, { editorId, now: new Date() })
      return { decisionId: await applyPlan(tx, plan, editorId, null) }
    }),
  )
}

/**
 * Undo of one decision (`planUndo`): the decision marked undone by the editor, the undo logged as an
 * `undo` decision with its changes (so it can itself be undone, which makes the decision it undid live
 * again), and applied while the rows still hold what it was planned on.
 */
export async function undoDecision(decisionId: string, editorId: string, db: typeof prisma = prisma): Promise<{ decisionId: string }> {
  return editorWrite(() =>
    db.$transaction(async tx => {
      const d = await tx.overviewDecision.findUnique({
        where: { id: decisionId },
        select: { id: true, kind: true, outcome: true, storyId: true, overviewId: true, inputs: true, undoneAt: true },
      })
      if (!d) throw new NotFoundError('Decision not found')
      if (!d.overviewId) throw new ConflictError('The overview this decision was about is gone')
      const o = await editOverview(tx, d.overviewId)
      const entries = (await tx.overviewEntry.findMany({ where: { overviewId: o.id }, select: EDIT_ENTRY })).map(asEditEntry)
      const now = new Date()
      const plan = planUndo(d, o, entries, { editorId, now })
      const marked = await tx.overviewDecision.updateMany({ where: { id: d.id, undoneAt: null }, data: { undoneAt: now, undoneBy: editorId } })
      if (marked.count === 0) throw new ConflictError('This decision is already undone')
      if (plan.relive) await tx.overviewDecision.updateMany({ where: { id: plan.relive }, data: { undoneAt: null, undoneBy: null } })
      return { decisionId: await applyPlan(tx, plan, editorId, d.id) }
    }),
  )
}
