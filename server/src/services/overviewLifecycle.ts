/**
 * The only writer of the four overview tables (`overviews`, `overview_entries`, `overview_stands`,
 * `overview_decisions`; a fence test holds it, `test/overviewWriters.test.ts`; `.context/overviews.md`,
 * "Records"). Phase 2 writes one story's linking (`applyLink`), in one transaction: the memberships
 * read again first, so a result made stale by an earlier write of the same run is asked again rather
 * than written; then the join, or the founding (the overview, both entries, its `found` decision and
 * both stories' `link` decisions), or the story left alone; every outcome logged as a `link`
 * decision. A write the one-active-entry index refuses (an editor's attach at the same moment) is
 * rolled back and logged as a `conflict`, which the next run retries.
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { OVERVIEW_PROMPT_VERSIONS } from '../prompts/overviews.js'
import { membershipsOf } from './overviewCandidates.js'
import { isStale, type ApplyOutcome, type LinkResult } from './overviewLink.js'
import { SETTLING_OUTCOMES, type LinkOutcome, type Role } from './overviewTypes.js'

/** Who an automated write names (`actor`, `joined_by`). */
export const PIPELINE = 'pipeline'

type Tx = Prisma.TransactionClient

/** A value as the JSON columns store it: dates as strings, nothing undefined. */
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue

/** What a `link` decision keeps of the call: the candidates shown, the yeses code refused and why. */
const linkInputs = (result: LinkResult) => json({ shown: result.shown, proposed: result.proposed, refusals: result.refusals })

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
