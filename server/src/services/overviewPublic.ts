/**
 * What readers get of ongoing-story overviews (`.context/overviews.md`, "Public"), SELECT only. An
 * overview is public while the step is switched on (`overviewStepOn`: both gates open, the job
 * enabled), its scope is `ongoing`, it is not hidden, and a published story is among its active
 * entries; nothing is read while either gate is closed. Here: the `overview` field every public story
 * carries (`withOverview`, one query for a list), the overview page (its header, "Where this stands"
 * and "What's being done" as served now with their citations, the timeline with each story's
 * Updates; kept in memory for its route, `servedOverview`), the `/ongoing` index (`servedOverviewList`),
 * and the lists the sitemap and link previews read. What counts as public is `overviewPublicRule.ts`'s.
 */
import type { Prisma } from '@prisma/client'
import { config } from '../config.js'
import { overviewAiMarker, type AiGeneratedOverviewMarker } from '../lib/aiProvenance.js'
import { cached, TTLCache } from '../lib/cache.js'
import { utcDay } from '../lib/days.js'
import prisma from '../lib/prisma.js'
import { registerPublicCache } from '../lib/publicCaches.js'
import { SOURCE_KINDS } from '../schemas/research.js'
import { PUBLIC_OVERVIEW as PUBLIC, SHOWN_ENTRY } from './overviewPublicRule.js'
import { overviewStepOn } from './overviewQueue.js'
import { servedStands, type ServedFact } from './overviewStands.js'
import type { StandsLine } from './overviewTypes.js'
import { loadMemberFacts, publicVersionsOf } from './passRecords.js'
import { publicUpdates } from './publicUpdates.js'
import { hostOf, type CitedText, type ResearchedSource } from './researchedStory.js'
import { normalizedUrl } from './researchFilter.js'
import { contextFact, usable, type PoolSource } from './researchPool.js'
import { oneOf } from './storyContextRecords.js'

/** The `overview` field of a public story: the public overview it is in. */
export interface StoryOverviewLink {
  slug: string
  title: string
}

/** The public overview of each of these stories that is in one, by story id; none while the step is off. */
export async function overviewOfStories(storyIds: readonly string[]): Promise<Map<string, StoryOverviewLink>> {
  if (storyIds.length === 0 || !(await overviewStepOn())) return new Map()
  const entries = await prisma.overviewEntry.findMany({
    where: { storyId: { in: [...new Set(storyIds)] }, status: 'active', overview: PUBLIC },
    select: { storyId: true, overview: { select: { slug: true, title: true } } },
  })
  return new Map(entries.flatMap(e => (e.storyId && e.overview.slug ? [[e.storyId, { slug: e.overview.slug, title: e.overview.title }] as const] : [])))
}

/**
 * The stories with their `overview` field (`.context/overviews.md`, "The public story field"): the
 * public overview each is in, else null. Every service that serves public stories calls it, so every
 * path serves the field.
 */
export async function withOverview<T extends { id: string }>(stories: readonly T[]): Promise<(T & { overview: StoryOverviewLink | null })[]> {
  const links = await overviewOfStories(stories.map(s => s.id))
  return stories.map(s => ({ ...s, overview: links.get(s.id) ?? null }))
}

const HEAD_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  closedReason: true,
  closedAt: true,
  foundedAt: true,
  lastEntryAt: true,
  charterModel: true,
  issue: { select: { name: true, slug: true } },
} as const satisfies Prisma.OverviewSelect

type HeadRow = Prisma.OverviewGetPayload<{ select: typeof HEAD_SELECT }>

/** An overview as a list names it: the page's header, the index's row, the sitemap's entry. */
export interface PublicOverviewHead {
  slug: string
  title: string
  /** The overview's issue, its area chip. */
  area: { name: string; slug: string } | null
  status: 'open' | 'quiet' | 'closing' | 'closed'
  /** Why it closed: `end_event`, `faded` or `editor`; null unless closed. */
  closedReason: string | null
  closedAt: Date | null
  /** The founding story's publication date: "since". */
  since: Date
  /** The newest story's publication date. */
  lastEntryAt: Date | null
  /** The newest of its last story, its current "Where this stands" and its closing. */
  lastChange: Date
  /** Its stories readers see. */
  stories: number
}

const newestOf = (dates: (Date | null | undefined)[], fallback: Date): Date => dates.reduce<Date>((a, b) => (b && b.getTime() > a.getTime() ? b : a), fallback)

function head(o: HeadRow, stories: number, standsAt: Date | null): PublicOverviewHead {
  return {
    slug: o.slug!,
    title: o.title,
    area: o.issue,
    status: o.status,
    closedReason: o.status === 'closed' ? o.closedReason : null,
    closedAt: o.status === 'closed' ? o.closedAt : null,
    since: o.foundedAt,
    lastEntryAt: o.lastEntryAt,
    lastChange: newestOf([o.lastEntryAt, standsAt, o.status === 'closed' ? o.closedAt : null], o.foundedAt),
    stories,
  }
}

/** Shown stories per overview, and when each one's current stands was written. */
async function countsAndStands(ids: string[]) {
  if (ids.length === 0) return { counts: new Map<string, number>(), standsAt: new Map<string, Date>() }
  const [groups, stands] = await Promise.all([
    prisma.overviewEntry.groupBy({ by: ['overviewId'], where: { overviewId: { in: ids }, ...SHOWN_ENTRY }, _count: { _all: true } }),
    prisma.overviewStands.findMany({ where: { overviewId: { in: ids }, status: 'current' }, select: { overviewId: true, writtenAt: true } }),
  ])
  return { counts: new Map(groups.map(g => [g.overviewId, g._count._all])), standsAt: new Map(stands.map(s => [s.overviewId, s.writtenAt])) }
}

/** The `/ongoing` list: whether the step is on, and the public overviews. */
export interface PublicOverviewList {
  on: boolean
  overviews: PublicOverviewHead[]
}

/**
 * Every public overview, the most recently changed first (the `/ongoing` index, the sitemap); `on` says
 * whether the step is switched on (the site's "Ongoing" links show only then). Empty while it is off.
 */
export async function publicOverviewList(): Promise<PublicOverviewList> {
  if (!(await overviewStepOn())) return { on: false, overviews: [] }
  const rows = await prisma.overview.findMany({ where: { ...PUBLIC, entries: { some: SHOWN_ENTRY } }, select: HEAD_SELECT })
  const { counts, standsAt } = await countsAndStands(rows.map(r => r.id))
  const overviews = rows
    .map(r => head(r, counts.get(r.id) ?? 0, standsAt.get(r.id) ?? null))
    .filter(o => o.stories > 0)
    .sort((a, b) => b.lastChange.getTime() - a.lastChange.getTime() || a.slug.localeCompare(b.slug))
  return { on: true, overviews }
}

/**
 * `GET /api/overviews`'s list, kept `listCacheSeconds` in memory: the layout asks it on a visitor's
 * first page view, so its queries run once per period, not once per visitor. A link-removing write and
 * switching the step off empty it (`OVERVIEW_LINK_CACHES`); a newly public overview waits for it to expire.
 */
const listCache = new TTLCache<PublicOverviewList>(config.overviews.listCacheSeconds * 1000)
registerPublicCache('ongoing-list', listCache)

/** The list as served, its first `limit` overviews when given (0: only whether the step is on, the layout's question). */
export async function servedOverviewList(limit?: number): Promise<PublicOverviewList> {
  const list = await cached(listCache, 'list', publicOverviewList)
  return limit === undefined ? list : { on: list.on, overviews: list.overviews.slice(0, limit) }
}

/** One public overview's header (its link preview), or null when there is no such public overview. */
export async function publicOverviewHead(slug: string): Promise<PublicOverviewHead | null> {
  if (!(await overviewStepOn())) return null
  const o = await prisma.overview.findFirst({ where: { ...PUBLIC, slug }, select: HEAD_SELECT })
  if (!o) return null
  const { counts, standsAt } = await countsAndStands([o.id])
  const stories = counts.get(o.id) ?? 0
  return stories > 0 ? head(o, stories, standsAt.get(o.id) ?? null) : null
}

/** A source of an overview's "Where this stands": as a researched story lists it, with the story of ours it came through. */
export type OverviewSource = ResearchedSource & { via: StoryOverviewLink | null }

/** One story of the timeline, newest first. */
export interface PublicOverviewEntry {
  slug: string
  /** Its AI headline (the source's headline before it was analyzed). */
  title: string
  titleLabel: string | null
  datePublished: Date
  role: 'turning_point' | 'routine'
  /** A turning point's kind (`setback`, `response`, `spread` …); null for a routine entry. */
  roleKind: string | null
  /** Its research Updates, newest first: the day and the note's text. */
  updates: { date: string; note: string }[]
}

export interface PublicOverview extends PublicOverviewHead {
  /** What a reader's "Report an error" names (`overviewId`, as a story's report names the story's id). */
  id: string
  /** "Where this stands" and "What's being done" as served now; null when none is written or none of it stands. */
  stands: { asOf: string; writtenAt: Date; sentences: CitedText[]; doing: CitedText[] } | null
  /** The sources the stands cite, in first-cited order (`S1` …). */
  sources: OverviewSource[]
  entries: PublicOverviewEntry[]
  aiGenerated: AiGeneratedOverviewMarker
}

const linesOf = (value: Prisma.JsonValue): StandsLine[] =>
  Array.isArray(value)
    ? value.flatMap(l => {
        const line = l as { text?: unknown; facts?: unknown }
        return typeof line?.text === 'string' && Array.isArray(line.facts) ? [{ text: line.text, facts: line.facts.filter(f => typeof f === 'string') }] : []
      })
    : []

/** The cited facts as they stand now: usable and published only for an active member's published story; a fact gone since is absent. */
async function servedFacts(factIds: string[], members: ReadonlyMap<string, StoryOverviewLink>) {
  const owners = await prisma.poolFact.findMany({ where: { id: { in: factIds } }, select: { storyId: true } })
  const facts = await loadMemberFacts(prisma, [...new Set(owners.map(o => o.storyId))], factIds)
  const cited = new Set(factIds)
  const served = new Map<string, ServedFact & { storyId: string; source: PoolSource }>()
  for (const f of facts)
    if (f.fact.id && cited.has(f.fact.id))
      served.set(f.fact.id, {
        usable: usable(f.fact),
        published: members.has(f.storyId),
        fact: contextFact(f.fact, f.source),
        storyId: f.storyId,
        source: f.source,
      })
  return served
}

/** Numbers the cited sources `S1…` in first-cited order, one per address, each with the first member story it came through. */
function sourceBook(members: ReadonlyMap<string, StoryOverviewLink>) {
  const ids = new Map<string, string>()
  const sources: OverviewSource[] = []
  return {
    sources,
    idOf(source: PoolSource, storyId: string): string {
      const key = normalizedUrl(source.url)
      const known = ids.get(key)
      if (known) return known
      const id = `S${ids.size + 1}`
      ids.set(key, id)
      const host = hostOf(source.url)
      sources.push({
        id,
        origin: 'source',
        outlet: source.outlet,
        host,
        url: host ? source.url : null,
        title: source.title,
        date: source.date,
        country: source.country && source.country !== 'unknown' ? source.country : null,
        kind: oneOf(source.kind, SOURCE_KINDS, 'other'),
        storyId: null,
        slug: null,
        via: members.get(storyId) ?? null,
      })
      return id
    },
  }
}

/**
 * The current stands as served now, its lines cited as a researched story's are, and the sources they
 * cite; and when the current version was written (`writtenAt`), served or not, which the page's
 * `lastChange` counts as the index's does (`countsAndStands`).
 */
async function standsForReaders(overviewId: string, members: ReadonlyMap<string, StoryOverviewLink>, today: string) {
  const row = await prisma.overviewStands.findFirst({
    where: { overviewId, status: 'current' },
    select: { sentences: true, doing: true, asOf: true, writtenAt: true, model: true },
  })
  if (!row) return { stands: null, sources: [], model: null, writtenAt: null }
  const stored = { sentences: linesOf(row.sentences), doing: linesOf(row.doing) }
  const facts = await servedFacts([...new Set([...stored.sentences, ...stored.doing].flatMap(l => l.facts))], members)
  const served = servedStands(stored, facts, today)
  if (served.sentences.length === 0 && served.doing.length === 0) return { stands: null, sources: [], model: null, writtenAt: row.writtenAt }
  const book = sourceBook(members)
  // One citation per source, in first-cited order, with its first fact's supporting sentence
  const cite = (line: StandsLine): CitedText => {
    const bySource = new Map<string, { sourceId: string; sentence: string | null }>()
    for (const id of line.facts) {
      const f = facts.get(id)!
      const sourceId = book.idOf(f.source, f.storyId)
      if (!bySource.has(sourceId)) bySource.set(sourceId, { sourceId, sentence: f.fact.supportingSentence || null })
    }
    return { text: line.text, citations: [...bySource.values()] }
  }
  const sentences = served.sentences.map(cite)
  const doing = served.doing.map(cite)
  return { stands: { asOf: utcDay(row.asOf), writtenAt: row.writtenAt, sentences, doing }, sources: book.sources, model: row.model, writtenAt: row.writtenAt }
}

/**
 * `GET /api/overviews/:slug`'s pages, kept `pageCacheSeconds` in memory (`ongoing-page`): a link-removing
 * write and switching the step off empty it (`OVERVIEW_LINK_CACHES`). A missing page is not kept, so
 * an overview made public is served at once.
 */
const pageCache = new TTLCache<PublicOverview | null>(config.overviews.pageCacheSeconds * 1000)
registerPublicCache('ongoing-page', pageCache)

/** One public overview's page as served. */
export function servedOverview(slug: string): Promise<PublicOverview | null> {
  return cached(
    pageCache,
    slug,
    () => publicOverview(slug),
    page => page !== null,
  )
}

/** One public overview's page, or null when there is no such public overview. */
export async function publicOverview(slug: string, now = new Date()): Promise<PublicOverview | null> {
  if (!(await overviewStepOn())) return null
  const o = await prisma.overview.findFirst({ where: { ...PUBLIC, slug }, select: HEAD_SELECT })
  if (!o) return null
  const entries = await prisma.overviewEntry.findMany({
    where: { overviewId: o.id, ...SHOWN_ENTRY },
    orderBy: [{ story: { datePublished: 'desc' } }, { id: 'asc' }],
    select: {
      role: true,
      roleKind: true,
      story: { select: { id: true, slug: true, title: true, sourceTitle: true, titleLabel: true, datePublished: true } },
    },
  })
  const shown = entries.flatMap(e =>
    e.story?.slug && e.story.datePublished ? [{ ...e, story: { ...e.story, slug: e.story.slug, datePublished: e.story.datePublished } }] : [],
  )
  if (shown.length === 0) return null
  const members = new Map(shown.map(e => [e.story.id, { slug: e.story.slug, title: e.story.title ?? e.story.sourceTitle }]))
  const [{ stands, sources, model, writtenAt }, versions] = await Promise.all([
    standsForReaders(o.id, members, utcDay(now)),
    publicVersionsOf(
      prisma,
      shown.map(e => e.story.id),
    ),
  ])
  return {
    id: o.id,
    ...head(o, shown.length, writtenAt),
    stands,
    sources,
    entries: shown.map(e => ({
      slug: e.story.slug,
      title: e.story.title ?? e.story.sourceTitle,
      titleLabel: e.story.titleLabel,
      datePublished: e.story.datePublished,
      role: e.role,
      roleKind: e.role === 'turning_point' ? e.roleKind : null,
      updates: publicUpdates(versions.get(e.story.id) ?? []).map(u => ({ date: u.date, note: u.note.text })),
    })),
    aiGenerated: overviewAiMarker({ titleModel: o.charterModel, standsModel: model, entries: shown.length }),
  }
}
