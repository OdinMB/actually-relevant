/**
 * What the admin reads of ongoing-story overviews (`.context/overviews.md`, "Admin"), SELECT only:
 * whether the step is on and how many overviews exist (the admin shows its pages while either holds),
 * the list, one overview with its entries and their judgments, its stands versions with each line's
 * facts as they stand now, and its decision log with what Undo can reverse, and a story's Overview
 * block (its membership, its last link decision with the candidates shown, the overviews it can be
 * attached to). The public reads are `overviewPublic.ts`'s; "public" here is the one rule
 * (`isPublicOverview`).
 */
import { z } from 'zod'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { NotFoundError } from '../utils/errors.js'
import { decisionMove } from './overviewDecisions.js'
import { undoable } from './overviewEdits.js'
import { parseCharter } from './overviewInput.js'
import { isPublicOverview } from './overviewPublicRule.js'
import { overviewStepOn } from './overviewQueue.js'
import { usable } from './researchPool.js'

/** The decisions the status history lists: the status machine's, end-event closings, an editor's close and freeze. */
const STATUS_KINDS = ['status', 'close', 'editor_close', 'editor_freeze'] as const

export interface OverviewsAdminState {
  /** The step is switched on (both gates open, its job enabled). */
  on: boolean
  /** Overviews of any scope. */
  count: number
}

export async function overviewsAdminState(): Promise<OverviewsAdminState> {
  const [on, count] = await Promise.all([overviewStepOn(), prisma.overview.count()])
  return { on, count }
}

export interface OverviewListFilters {
  scope?: 'single' | 'forming' | 'ongoing'
  status?: 'open' | 'quiet' | 'closing' | 'closed'
  frozen?: boolean
  hidden?: boolean
}

const LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  scope: true,
  status: true,
  closedReason: true,
  frozen: true,
  hidden: true,
  foundedAt: true,
  lastEntryAt: true,
  issue: { select: { id: true, name: true } },
} as const

/** Active entries of published stories per overview. */
async function entryCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const groups = await prisma.overviewEntry.groupBy({
    by: ['overviewId'],
    where: { overviewId: { in: ids }, status: 'active', story: { status: 'published' } },
    _count: { _all: true },
  })
  return new Map(groups.map(g => [g.overviewId, g._count._all]))
}

/** The admin's list: every overview matching the filters, the newest last entry first. */
export async function adminOverviewList(filters: OverviewListFilters = {}) {
  const rows = await prisma.overview.findMany({
    where: { scope: filters.scope, status: filters.status, frozen: filters.frozen, hidden: filters.hidden },
    orderBy: [{ lastEntryAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
    select: LIST_SELECT,
  })
  const counts = await entryCounts(rows.map(r => r.id))
  return rows.map(r => ({ ...r, entries: counts.get(r.id) ?? 0, public: isPublicOverview(r) }))
}

const sharedSchema = z.object({
  cause: z.object({ story: z.string(), other: z.string() }),
  place: z.object({ story: z.string(), other: z.string() }),
  end: z.object({ story: z.string(), other: z.string() }),
})
const linesSchema = z.array(z.object({ text: z.string(), facts: z.array(z.string()) })).catch([])
const recordSchema = z
  .object({
    drops: z.array(z.object({ label: z.string(), cause: z.string(), problem: z.string().optional() })).catch([]),
    checked: z.number().catch(0),
    failed: z.number().catch(0),
  })
  .catch({ drops: [], checked: 0, failed: 0 })

/** The pool facts a stands version cites, as they stand now, with their source. */
async function citedFacts(ids: string[]) {
  const facts = await prisma.poolFact.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      storyId: true,
      statement: true,
      supportingSentence: true,
      verdict: true,
      status: true,
      slot: true,
      source: { select: { outlet: true, url: true } },
    },
  })
  return new Map(facts.map(f => [f.id, { ...f, outlet: f.source.outlet, url: f.source.url, usable: usable(f), gone: false }]))
}

type CitedFact = Awaited<ReturnType<typeof citedFacts>> extends Map<string, infer F> ? F : never

/** A line of a stands version with the facts it cites; a fact deleted since is `gone`. */
const resolveLine =
  (facts: Map<string, CitedFact>) =>
  (line: { text: string; facts: string[] }): { text: string; facts: (CitedFact | { id: string; gone: true })[] } => ({
    text: line.text,
    facts: line.facts.map(id => facts.get(id) ?? { id, gone: true as const }),
  })

/** User names of the editors a log names, by id. */
async function editorNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return new Map(users.map(u => [u.id, u.name]))
}

/** One overview for its admin page: its fields and charter, its entries, its stands versions, its decision log. */
export async function adminOverview(id: string) {
  const o = await prisma.overview.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      charter: true,
      charterModel: true,
      closingSince: true,
      closedAt: true,
      entriesAtLastReview: true,
      reviewedAt: true,
    },
  })
  if (!o) throw new NotFoundError('Overview not found')
  const newest = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
  const withStory = { story: { select: { title: true, sourceTitle: true } } }
  const [entries, stands, decisions, decisionsTotal, history, counts, on] = await Promise.all([
    prisma.overviewEntry.findMany({
      where: { overviewId: id },
      orderBy: [{ status: 'asc' }, { story: { datePublished: 'desc' } }, { id: 'asc' }],
      include: { story: { select: { id: true, title: true, sourceTitle: true, status: true, datePublished: true } } },
    }),
    prisma.overviewStands.findMany({ where: { overviewId: id }, orderBy: { number: 'desc' } }),
    prisma.overviewDecision.findMany({ where: { overviewId: id }, orderBy: newest, take: config.overviews.logSize, include: withStory }),
    prisma.overviewDecision.count({ where: { overviewId: id } }),
    // Every move, however long the log: the status history is short
    prisma.overviewDecision.findMany({ where: { overviewId: id, kind: { in: [...STATUS_KINDS] } }, orderBy: newest, include: withStory }),
    entryCounts([id]),
    overviewStepOn(),
  ])
  const versions = stands.map(v => ({ ...v, sentences: linesSchema.parse(v.sentences), doing: linesSchema.parse(v.doing) }))
  const resolve = resolveLine(await citedFacts([...new Set(versions.flatMap(v => [...v.sentences, ...v.doing].flatMap(l => l.facts)))]))
  const names = await editorNames([...new Set([...decisions, ...history].flatMap(d => [d.actor, d.undoneBy ?? '']).filter(Boolean))])
  const logEntry = ({ story, ...d }: (typeof decisions)[number]) => ({
    id: d.id,
    kind: d.kind,
    outcome: d.outcome,
    storyId: d.storyId,
    storyTitle: story ? (story.title ?? story.sourceTitle) : null,
    actor: d.actor,
    actorName: names.get(d.actor) ?? null,
    createdAt: d.createdAt,
    undoneAt: d.undoneAt,
    undoneByName: d.undoneBy ? (names.get(d.undoneBy) ?? d.undoneBy) : null,
    costUsd: d.costUsd,
    model: d.model,
    confidence: d.confidence,
    move: decisionMove(d.kind, d.inputs),
    inputs: d.inputs,
    answer: d.answer,
    undoable: undoable(d),
  })
  return {
    ...o,
    charter: parseCharter(o.charter) ?? { in: '', out: [], endEvent: '' },
    entries: counts.get(id) ?? 0,
    public: isPublicOverview(o),
    on,
    members: entries.map(({ story, shared, ...e }) => ({
      ...e,
      shared: sharedSchema.safeParse(shared).data ?? null,
      story: story ? { id: story.id, title: story.title ?? story.sourceTitle, status: story.status, datePublished: story.datePublished } : null,
    })),
    stands: versions.map(v => {
      const record = recordSchema.parse(v.record)
      return {
        id: v.id,
        number: v.number,
        status: v.status,
        asOf: v.asOf,
        writtenAt: v.writtenAt,
        model: v.model,
        promptVersion: v.promptVersion,
        sentences: v.sentences.map(resolve),
        doing: v.doing.map(resolve),
        ...record,
      }
    }),
    /** The newest `logSize` decisions, of `decisionsTotal`; the status history keeps every move. */
    decisions: decisions.map(logEntry),
    decisionsTotal,
    statusHistory: history.map(logEntry),
  }
}

const shownSchema = z
  .object({
    shown: z.object({
      overviews: z.array(z.object({ ref: z.string(), id: z.string(), distance: z.number() })).catch([]),
      partners: z.array(z.object({ ref: z.string(), id: z.string(), distance: z.number() })).catch([]),
    }),
    refusals: z.array(z.object({ id: z.string(), reason: z.string() })).catch([]),
  })
  .partial()
const answerSchema = z.object({ candidates: z.array(z.object({ id: z.string(), belongs: z.string() })).catch([]) }).partial()

/**
 * A story's Overview block (the story page's Source tab): whether the step is on and any overview
 * exists, the overview it is in now, the ones it left, its newest link decision with the candidates
 * that call was shown and what the model said of each, and the overviews it can be attached to: while
 * it is in none, the `attachChoices` not closed (a closed one takes no story until reopened), the
 * newest last entry first.
 */
export async function storyOverview(storyId: string) {
  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { id: true, status: true } })
  if (!story) throw new NotFoundError('Story not found')
  const [state, entries, link] = await Promise.all([
    overviewsAdminState(),
    prisma.overviewEntry.findMany({
      where: { storyId },
      orderBy: { joinedAt: 'desc' },
      include: { overview: { select: { id: true, title: true, scope: true, status: true } } },
    }),
    prisma.overviewDecision.findFirst({ where: { storyId, kind: 'link' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
  ])
  const active = entries.find(e => e.status === 'active') ?? null
  const choices = active
    ? []
    : await prisma.overview.findMany({
        where: { status: { not: 'closed' } },
        orderBy: [{ lastEntryAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        take: config.overviews.attachChoices,
        select: { id: true, title: true, scope: true, status: true },
      })
  const inputs = shownSchema.safeParse(link?.inputs).data ?? {}
  const answers = new Map((answerSchema.safeParse(link?.answer).data?.candidates ?? []).map(c => [c.id.trim(), c.belongs]))
  const shown = [
    ...(inputs.shown?.overviews ?? []).map(c => ({ ...c, kind: 'overview' as const })),
    ...(inputs.shown?.partners ?? []).map(c => ({ ...c, kind: 'story' as const })),
  ]
  const [overviewTitles, storyTitles] = await Promise.all([
    prisma.overview.findMany({ where: { id: { in: shown.filter(c => c.kind === 'overview').map(c => c.id) } }, select: { id: true, title: true } }),
    prisma.story.findMany({
      where: { id: { in: shown.filter(c => c.kind === 'story').map(c => c.id) } },
      select: { id: true, title: true, sourceTitle: true },
    }),
  ])
  const titles = new Map([...overviewTitles.map(o => [o.id, o.title] as const), ...storyTitles.map(s => [s.id, s.title ?? s.sourceTitle] as const)])
  return {
    ...state,
    published: story.status === 'published',
    membership: active
      ? {
          entryId: active.id,
          overview: active.overview,
          role: active.role,
          roleKind: active.roleKind,
          joinedBy: active.joinedBy,
          joinedAt: active.joinedAt,
          locked: active.locked,
          confidence: active.confidence,
        }
      : null,
    left: entries
      .filter(e => e.status === 'detached')
      .map(e => ({ entryId: e.id, overview: e.overview, detachReason: e.detachReason, detachedAt: e.detachedAt, locked: e.locked })),
    lastLink: link
      ? {
          id: link.id,
          outcome: link.outcome,
          overviewId: link.overviewId,
          createdAt: link.createdAt,
          undoneAt: link.undoneAt,
          candidates: shown.map(c => ({ ...c, title: titles.get(c.id) ?? null, belongs: answers.get(c.ref) ?? null })),
          refusals: inputs.refusals ?? [],
        }
      : null,
    attachable: choices,
  }
}
