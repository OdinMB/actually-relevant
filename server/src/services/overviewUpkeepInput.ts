/**
 * What the overview step's upkeep reads (`.context/overviews.md`, "The job", parts 2 to 5), SELECT only
 * through the client given: the joined stories flagged as reporting their overview's end event and
 * not yet judged, every overview's state for the status machine (its unpublished members, its burst
 * count, whether its closure was reviewed), an overview as its review reads it, the monthly audit's
 * picks, and each public overview's stands case (its members' usable facts and the last refresh's
 * signature).
 */
import { config } from '../config.js'
import { utcDay } from '../lib/days.js'
import type { CloseCase } from './overviewClose.js'
import type { OverviewDb } from './overviewCandidates.js'
import { linkStories, parseCharter } from './overviewInput.js'
import type { ReviewCase, ReviewEntry } from './overviewReview.js'
import { ENTRY_ROLES, OVERVIEW_SCOPES, OVERVIEW_STATUSES, ROLE_KINDS, type OverviewState, type Role } from './overviewTypes.js'
import type { StandsCase } from './overviewUpkeep.js'
import { loadMemberFacts } from './passRecords.js'
import { oneOf } from './storyContextRecords.js'

/** The newest other entries an end-event check shows, as the link prompt shows a candidate's. */
const CLOSE_ENTRIES = 5

const roleFrom = (role: string, kind: string | null): Role => {
  const r = oneOf(role, ENTRY_ROLES, 'routine')
  return { role: r, roleKind: r === 'routine' || kind === null ? null : oneOf(kind, ROLE_KINDS, 'milestone') }
}

/**
 * The stories a join flagged as reporting their overview's end event (`reportsEndEvent` on a live
 * `joined` link decision), still active members and published, of an overview that is open or quiet
 * and not frozen, with no `close` decision for that pair but a failed one; oldest first. Each with
 * the overview's charter and its newest other entries published on or before the story's day.
 */
export async function pendingClosings(db: OverviewDb): Promise<CloseCase[]> {
  const rows = await db.$queryRaw<{ story_id: string; overview_id: string; charter: unknown }[]>`
    SELECT d.story_id, d.overview_id, o.charter
    FROM overview_decisions d
    JOIN overview_entries e ON e.story_id = d.story_id AND e.overview_id = d.overview_id AND e.status = 'active'
    JOIN overviews o ON o.id = d.overview_id
    JOIN stories s ON s.id = d.story_id
    WHERE d.kind = 'link' AND d.outcome = 'joined' AND d.undone_at IS NULL AND d.inputs->>'reportsEndEvent' = 'true'
      AND s.status = 'published' AND o.status IN ('open', 'quiet') AND NOT o.frozen
      AND NOT EXISTS (
        SELECT 1 FROM overview_decisions c
        WHERE c.kind = 'close' AND c.story_id = d.story_id AND c.overview_id = d.overview_id AND c.outcome <> 'failed' AND c.undone_at IS NULL
      )
    ORDER BY s.date_published, s.id
  `
  if (rows.length === 0) return []
  const stories = new Map(
    (
      await linkStories(
        db,
        rows.map(r => r.story_id),
      )
    ).map(s => [s.id, s]),
  )
  const cases: CloseCase[] = []
  for (const r of rows) {
    const story = stories.get(r.story_id)
    const charter = parseCharter(r.charter)
    if (!story || !charter) continue
    const entries = await db.$queryRaw<{ title: string; date_published: Date }[]>`
      SELECT COALESCE(s.title, s.source_title) AS title, s.date_published
      FROM overview_entries e JOIN stories s ON s.id = e.story_id
      WHERE e.overview_id = ${r.overview_id} AND e.status = 'active' AND s.status = 'published' AND s.id <> ${r.story_id}
        AND s.date_published <= ${story.datePublished}
      ORDER BY s.date_published DESC, s.id
      LIMIT ${CLOSE_ENTRIES}
    `
    cases.push({ overviewId: r.overview_id, charter, story, entries: entries.map(e => ({ title: e.title, date: utcDay(e.date_published) })) })
  }
  return cases
}

interface StateRow {
  id: string
  scope: string
  status: string
  closed_reason: string | null
  frozen: boolean
  hidden: boolean
  last_entry_at: Date | null
  closing_since: Date | null
  entries_at_last_review: number
  reviewed_at: Date | null
}

/** The newest of some dates, or null. */
const newest = (dates: readonly Date[]): Date | null => (dates.length === 0 ? null : new Date(Math.max(...dates.map(d => d.getTime()))))

/**
 * Every overview with an active entry, oldest founding first, as the status machine reads it
 * (`OverviewState`): its active entries of published stories counted, and those of stories no longer
 * published listed; the most stories of one publication day the pipeline joined to it within
 * `nightHours` of `now` and after its last freeze or review (so the joins one freeze answered, its
 * review having cleared it, never freeze it again the next run); when a burst froze it, while no review
 * has run since; while closing, the story whose end-event report began it; and whether a closure
 * review ran for its current closing.
 */
export async function overviewStates(
  db: OverviewDb,
  now: Date,
  options: Pick<typeof config.overviews, 'nightHours'> = config.overviews,
): Promise<OverviewState[]> {
  const rows = await db.$queryRaw<StateRow[]>`
    SELECT o.id, o.scope::text AS scope, o.status::text AS status, o.closed_reason, o.frozen, o.hidden, o.last_entry_at,
           o.closing_since, o.entries_at_last_review, o.reviewed_at
    FROM overviews o
    WHERE EXISTS (SELECT 1 FROM overview_entries e WHERE e.overview_id = o.id AND e.status = 'active')
    ORDER BY o.founded_at, o.id
  `
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id)
  const since = new Date(now.getTime() - options.nightHours * 3_600_000)
  const [entries, decisions] = await Promise.all([
    db.$queryRaw<{ id: string; overview_id: string; story_id: string; published: boolean; date_published: Date | null; pipeline_join: Date | null }[]>`
      SELECT e.id, e.overview_id, e.story_id, (s.status = 'published') AS published, s.date_published,
             CASE WHEN e.joined_by = 'pipeline' THEN e.joined_at END AS pipeline_join
      FROM overview_entries e JOIN stories s ON s.id = e.story_id
      WHERE e.status = 'active' AND e.overview_id = ANY(${ids}::text[])
    `,
    db.$queryRaw<{ overview_id: string; kind: string; story_id: string | null; trigger: string | null; closing_since: string | null; created_at: Date }[]>`
      SELECT d.overview_id, d.kind::text AS kind, d.story_id, d.inputs->>'trigger' AS trigger, d.inputs->>'closingSince' AS closing_since, d.created_at
      FROM overview_decisions d
      WHERE d.overview_id = ANY(${ids}::text[])
        AND ((d.kind = 'status' AND d.outcome = 'frozen') OR (d.kind = 'review' AND d.outcome = 'reviewed')
             OR (d.kind = 'close' AND d.outcome = 'closing' AND d.undone_at IS NULL))
      ORDER BY d.created_at, d.id
    `,
  ])
  return rows.map(r => {
    const own = entries.filter(e => e.overview_id === r.id)
    const log = decisions.filter(d => d.overview_id === r.id)
    const frozenAt = log.filter(d => d.kind === 'status').at(-1)?.created_at ?? null
    const reviewedSince = frozenAt !== null && log.some(d => d.kind === 'review' && d.created_at.getTime() > frozenAt.getTime())
    // Joins a freeze or a review already answered count no more
    const countFrom = newest([since, ...log.filter(d => d.kind === 'status' || d.kind === 'review').map(d => d.created_at)])!
    const joinsByDay = new Map<string, number>()
    for (const e of own)
      if (e.pipeline_join && e.pipeline_join.getTime() > countFrom.getTime() && e.published && e.date_published)
        joinsByDay.set(utcDay(e.date_published), (joinsByDay.get(utcDay(e.date_published)) ?? 0) + 1)
    const closing = r.closing_since?.toISOString() ?? null
    return {
      id: r.id,
      scope: oneOf(r.scope, OVERVIEW_SCOPES, 'single'),
      status: oneOf(r.status, OVERVIEW_STATUSES, 'open'),
      closedReason: r.closed_reason,
      frozen: r.frozen,
      hidden: r.hidden,
      lastEntryAt: r.last_entry_at,
      closingSince: r.closing_since,
      closingStoryId: r.status === 'closing' ? (log.filter(d => d.kind === 'close').at(-1)?.story_id ?? null) : null,
      activeEntries: own.filter(e => e.published).length,
      unpublished: own.filter(e => !e.published).map(e => ({ entryId: e.id, storyId: e.story_id })),
      entriesAtLastReview: r.entries_at_last_review,
      reviewedAt: r.reviewed_at,
      burstJoins: Math.max(0, ...joinsByDay.values()),
      burstAt: r.frozen && frozenAt !== null && !reviewedSince ? frozenAt : null,
      closureReviewed: closing !== null && log.some(d => d.kind === 'review' && d.trigger === 'closure' && d.closing_since === closing),
    }
  })
}

/**
 * An overview as its review reads it: title, charter, scope and freeze, its active entries of
 * published stories oldest first, and while closing the story whose end-event report began it (the
 * newest live `closing` decision's). Null for an overview gone or without a readable charter.
 */
export async function reviewCase(db: OverviewDb, overviewId: string): Promise<ReviewCase | null> {
  const [o] = await db.$queryRaw<{ title: string; charter: unknown; scope: string; status: string; frozen: boolean }[]>`
    SELECT title, charter, scope::text AS scope, status::text AS status, frozen FROM overviews WHERE id = ${overviewId}
  `
  const charter = o ? parseCharter(o.charter) : null
  if (!o || !charter) return null
  const rows = await db.$queryRaw<
    {
      id: string
      story_id: string
      title: string
      label: string
      summary: string
      date_published: Date
      role: string
      role_kind: string | null
      locked: boolean
    }[]
  >`
    SELECT e.id, e.story_id, COALESCE(s.title, s.source_title) AS title, COALESCE(s.title_label, '') AS label, COALESCE(s.summary, '') AS summary,
           s.date_published, e.role::text AS role, e.role_kind, e.locked
    FROM overview_entries e JOIN stories s ON s.id = e.story_id
    WHERE e.overview_id = ${overviewId} AND e.status = 'active' AND s.status = 'published' AND s.date_published IS NOT NULL
    ORDER BY s.date_published, s.id
  `
  const [closing] =
    o.status === 'closing'
      ? await db.$queryRaw<{ story_id: string | null }[]>`
          SELECT story_id FROM overview_decisions
          WHERE overview_id = ${overviewId} AND kind = 'close' AND outcome = 'closing' AND undone_at IS NULL
          ORDER BY created_at DESC LIMIT 1
        `
      : []
  const entries: ReviewEntry[] = rows.map(r => ({
    entryId: r.id,
    storyId: r.story_id,
    title: r.title,
    label: r.label,
    summary: r.summary,
    date: utcDay(r.date_published),
    role: roleFrom(r.role, r.role_kind),
    locked: r.locked,
  }))
  return {
    overviewId,
    title: o.title,
    charter,
    scope: oneOf(o.scope, OVERVIEW_SCOPES, 'single'),
    frozen: o.frozen,
    entries,
    closingStoryId: closing?.story_id ?? null,
  }
}

/**
 * The monthly audit's picks: `auditSize` random public overviews (ongoing, not hidden), or none while
 * an audit was logged within `auditEveryDays` of `now`.
 */
export async function auditPicks(
  db: OverviewDb,
  now: Date,
  options: Pick<typeof config.overviews, 'auditSize' | 'auditEveryDays'> = config.overviews,
): Promise<string[]> {
  const since = new Date(now.getTime() - options.auditEveryDays * 86_400_000)
  const [recent] = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM overview_decisions WHERE kind = 'review' AND outcome = 'audited' AND created_at > ${since} LIMIT 1
  `
  if (recent) return []
  const picks = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM overviews WHERE scope = 'ongoing' AND NOT hidden ORDER BY random() LIMIT ${options.auditSize}
  `
  return picks.map(p => p.id)
}

/**
 * Every public overview that is not frozen (ongoing, not hidden), as its stands are refreshed: its
 * active entries of published stories oldest first, those stories' usable, structured page facts
 * (`loadMemberFacts`), and the signature of its last refresh that did not fail.
 */
export async function standsCases(db: OverviewDb): Promise<StandsCase[]> {
  const overviews = await db.$queryRaw<{ id: string; title: string; signature: string | null }[]>`
    SELECT o.id, o.title,
           (SELECT d.inputs->>'signature' FROM overview_decisions d
            WHERE d.overview_id = o.id AND d.kind = 'stands' AND d.outcome <> 'failed'
            ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS signature
    FROM overviews o
    WHERE o.scope = 'ongoing' AND NOT o.hidden AND NOT o.frozen
    ORDER BY o.founded_at, o.id
  `
  const cases: StandsCase[] = []
  for (const o of overviews) {
    const entries = await db.$queryRaw<{ story_id: string; title: string; date_published: Date; role: string; role_kind: string | null }[]>`
      SELECT e.story_id, COALESCE(s.title, s.source_title) AS title, s.date_published, e.role::text AS role, e.role_kind
      FROM overview_entries e JOIN stories s ON s.id = e.story_id
      WHERE e.overview_id = ${o.id} AND e.status = 'active' AND s.status = 'published' AND s.date_published IS NOT NULL
      ORDER BY s.date_published, s.id
    `
    const facts = await loadMemberFacts(
      db,
      entries.map(e => e.story_id),
    )
    cases.push({
      overviewId: o.id,
      title: o.title,
      entries: entries.map(e => ({ storyId: e.story_id, title: e.title, date: utcDay(e.date_published), role: roleFrom(e.role, e.role_kind) })),
      members: facts.map(f => ({ ...f, published: true })),
      lastSignature: o.signature,
    })
  }
  return cases
}
