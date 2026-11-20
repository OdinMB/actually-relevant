/**
 * What the overview step's upkeep reads (`.context/overviews.md`, "The job", parts 2 to 5), SELECT only
 * through the client given: the joined stories flagged as reporting their overview's end event and
 * not yet judged, every overview's state for the status machine (`overviewStateOf`, from its row's
 * columns and its active entries), an overview as its review reads it, the monthly audit's picks, and
 * each public overview's stands case (its members' usable facts, skipped when nothing they are made of
 * changed, and the last refresh's record).
 */
import { config } from '../config.js'
import { utcDay } from '../lib/days.js'
import type { CloseCase } from './overviewClose.js'
import type { OverviewDb } from './overviewCandidates.js'
import { REPORTS_END_EVENT } from './overviewDecisions.js'
import { linkStories, parseCharter } from './overviewInput.js'
import { publicOverviewSql } from './overviewPublicRule.js'
import type { ReviewCase, ReviewEntry } from './overviewReview.js'
import { overviewStateOf, type StateEntry, type StateRow } from './overviewState.js'
import { ENTRY_ROLES, OVERVIEW_SCOPES, OVERVIEW_STATUSES, ROLE_KINDS, namesEndEvent, type OverviewState, type Role } from './overviewTypes.js'
import type { StandsCase } from './overviewUpkeep.js'
import { loadMemberFacts } from './passRecords.js'
import { oneOf } from './storyContextRecords.js'

const roleFrom = (role: string, kind: string | null): Role => {
  const r = oneOf(role, ENTRY_ROLES, 'routine')
  return { role: r, roleKind: r === 'routine' || kind === null ? null : oneOf(kind, ROLE_KINDS, 'milestone') }
}

/**
 * The stories a join flagged as reporting their overview's end event (`reportsEndEvent` on a live
 * `joined` link decision), still active members and published, of an overview that is open or quiet,
 * not frozen and names an end event (one with none closes only by fading, whatever was flagged before
 * an editor took it out), with no `close` decision for that pair but a failed or stale one (an undone
 * one included: an editor's undo of a closing is not judged again); oldest first. Each with the
 * overview's charter and its newest `candidateEntries` other entries published on or before the story's day.
 */
export async function pendingClosings(db: OverviewDb, options: Pick<typeof config.overviews, 'candidateEntries'> = config.overviews): Promise<CloseCase[]> {
  const rows = await db.$queryRaw<{ story_id: string; overview_id: string; charter: unknown }[]>`
    SELECT d.story_id, d.overview_id, o.charter
    FROM overview_decisions d
    JOIN overview_entries e ON e.story_id = d.story_id AND e.overview_id = d.overview_id AND e.status = 'active'
    JOIN overviews o ON o.id = d.overview_id
    JOIN stories s ON s.id = d.story_id
    WHERE d.kind = 'link' AND d.outcome = 'joined' AND d.undone_at IS NULL AND d.inputs->>${REPORTS_END_EVENT} = 'true'
      AND s.status = 'published' AND o.status IN ('open', 'quiet') AND NOT o.frozen AND o.charter->>'endEvent' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM overview_decisions c
        WHERE c.kind = 'close' AND c.story_id = d.story_id AND c.overview_id = d.overview_id AND c.outcome NOT IN ('failed', 'stale')
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
    if (!story || !charter || !namesEndEvent(charter)) continue
    const entries = await db.$queryRaw<{ title: string; date_published: Date }[]>`
      SELECT COALESCE(s.title, s.source_title) AS title, s.date_published
      FROM overview_entries e JOIN stories s ON s.id = e.story_id
      WHERE e.overview_id = ${r.overview_id} AND e.status = 'active' AND s.status = 'published' AND s.id <> ${r.story_id}
        AND s.date_published <= ${story.datePublished}
      ORDER BY s.date_published DESC, s.id
      LIMIT ${options.candidateEntries}
    `
    cases.push({ overviewId: r.overview_id, charter, story, entries: entries.map(e => ({ title: e.title, date: utcDay(e.date_published) })) })
  }
  return cases
}

interface StateQueryRow {
  id: string
  title: string
  scope: string
  status: string
  closed_reason: string | null
  frozen: boolean
  frozen_by: string | null
  frozen_at: Date | null
  hidden: boolean
  last_entry_at: Date | null
  closing_since: Date | null
  closing_story_id: string | null
  closure_reviewed_at: Date | null
  entries_at_last_review: number
  reviewed_at: Date | null
  reopened_at: Date | null
  joins_counted_from: Date | null
  recentered_at: Date | null
  recentered_by: string | null
}

const stateRow = (r: StateQueryRow): StateRow => ({
  id: r.id,
  title: r.title,
  scope: oneOf(r.scope, OVERVIEW_SCOPES, 'single'),
  status: oneOf(r.status, OVERVIEW_STATUSES, 'open'),
  closedReason: r.closed_reason,
  frozen: r.frozen,
  frozenBy: r.frozen_by,
  frozenAt: r.frozen_at,
  hidden: r.hidden,
  lastEntryAt: r.last_entry_at,
  closingSince: r.closing_since,
  closingStoryId: r.closing_story_id,
  closureReviewedAt: r.closure_reviewed_at,
  entriesAtLastReview: r.entries_at_last_review,
  reviewedAt: r.reviewed_at,
  reopenedAt: r.reopened_at,
  joinsCountedFrom: r.joins_counted_from,
  recenteredAt: r.recentered_at,
  recenteredBy: r.recentered_by,
})

/**
 * Every overview with an active entry, oldest founding first, as the status machine reads it
 * (`overviewStateOf`): its row, its active entries with their stories' publication, and the newest
 * reader's report that queued a review (`feedback.queues_review`).
 */
export async function overviewStates(
  db: OverviewDb,
  now: Date,
  options: Pick<typeof config.overviews, 'nightHours'> = config.overviews,
): Promise<OverviewState[]> {
  const rows = await db.$queryRaw<StateQueryRow[]>`
    SELECT o.id, o.title, o.scope::text AS scope, o.status::text AS status, o.closed_reason, o.frozen, o.frozen_by, o.frozen_at, o.hidden,
           o.last_entry_at, o.closing_since, o.closing_story_id, o.closure_reviewed_at, o.entries_at_last_review, o.reviewed_at,
           o.reopened_at, o.joins_counted_from, o.recentered_at, o.recentered_by
    FROM overviews o
    WHERE EXISTS (SELECT 1 FROM overview_entries e WHERE e.overview_id = o.id AND e.status = 'active')
    ORDER BY o.founded_at, o.id
  `
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id)
  const [entries, reports] = await Promise.all([
    db.$queryRaw<
      { id: string; overview_id: string; story_id: string | null; joined_by: string; joined_at: Date; published: boolean; date_published: Date | null }[]
    >`
      SELECT e.id, e.overview_id, e.story_id, e.joined_by, e.joined_at, (s.status = 'published') AS published, s.date_published
      FROM overview_entries e JOIN stories s ON s.id = e.story_id
      WHERE e.status = 'active' AND e.overview_id = ANY(${ids}::text[])
    `,
    db.$queryRaw<{ overview_id: string; report_at: Date }[]>`
      SELECT f.overview_id, MAX(f.created_at) AS report_at
      FROM feedback f
      WHERE f.queues_review AND f.overview_id = ANY(${ids}::text[])
      GROUP BY f.overview_id
    `,
  ])
  return rows.map(r => {
    const own: StateEntry[] = entries
      .filter(e => e.overview_id === r.id)
      .map(e => ({
        id: e.id,
        storyId: e.story_id,
        status: 'active',
        joinedBy: e.joined_by,
        joinedAt: e.joined_at,
        published: e.published,
        datePublished: e.date_published,
      }))
    return overviewStateOf(stateRow(r), own, reports.find(f => f.overview_id === r.id)?.report_at ?? null, now, options)
  })
}

/**
 * An overview as its review reads it: title, charter, scope and freeze, its active entries of
 * published stories oldest first, while closing the story whose end-event report began it, and the OUT
 * entries an editor's undo locked out. Null for an overview gone or without a readable charter.
 */
export async function reviewCase(db: OverviewDb, overviewId: string): Promise<ReviewCase | null> {
  const [o] = await db.$queryRaw<
    { title: string; charter: unknown; scope: string; status: string; frozen: boolean; closing_story_id: string | null; locked_out: unknown }[]
  >`
    SELECT title, charter, scope::text AS scope, status::text AS status, frozen, closing_story_id, locked_out FROM overviews WHERE id = ${overviewId}
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
    closingStoryId: o.status === 'closing' ? o.closing_story_id : null,
    lockedOut: Array.isArray(o.locked_out) ? o.locked_out.filter((x): x is string => typeof x === 'string') : [],
  }
}

/**
 * The monthly audit's picks: `auditSize` random public overviews, or none while an audit was logged
 * within `auditEveryDays` of `now`, or one failed within `failedAuditHours` (so a failing audit is
 * tried again the next day, not every run).
 */
export async function auditPicks(
  db: OverviewDb,
  now: Date,
  options: Pick<typeof config.overviews, 'auditSize' | 'auditEveryDays' | 'failedAuditHours'> = config.overviews,
): Promise<string[]> {
  const since = new Date(now.getTime() - options.auditEveryDays * 86_400_000)
  const failedSince = new Date(now.getTime() - options.failedAuditHours * 3_600_000)
  const [recent] = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM overview_decisions
    WHERE kind = 'review' AND ((outcome = 'audited' AND created_at > ${since}) OR (outcome = 'audit_failed' AND created_at > ${failedSince}))
    LIMIT 1
  `
  if (recent) return []
  const picks = await db.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM overviews o WHERE ${publicOverviewSql('o')} ORDER BY random() LIMIT ${options.auditSize}
  `
  return picks.map(p => p.id)
}

/**
 * Every public overview that is not frozen, as its stands are refreshed: its active entries of
 * published stories oldest first, the last refresh that did not fail (its signature, marker and the day
 * its offer next changes), and a marker of what the offer is made of (the title, the entries' roles and
 * the members' pool facts: each fact's verdict, status and source in use). When the marker is the last
 * refresh's and its day has not come, nothing the offer is made of changed, so the facts are not read
 * (`unchanged`); otherwise its members' usable, structured page facts (`loadMemberFacts`).
 */
export async function standsCases(db: OverviewDb, today: string): Promise<StandsCase[]> {
  const overviews = await db.$queryRaw<{ id: string; title: string; signature: string | null; marker: string | null; until: string | null }[]>`
    SELECT o.id, o.title, last.inputs->>'signature' AS signature, last.inputs->>'marker' AS marker, last.inputs->>'until' AS until
    FROM overviews o
    LEFT JOIN LATERAL (
      SELECT d.inputs FROM overview_decisions d
      WHERE d.overview_id = o.id AND d.kind = 'stands' AND d.outcome <> 'failed'
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1
    ) last ON true
    WHERE ${publicOverviewSql('o')} AND NOT o.frozen
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
    const storyIds = entries.map(e => e.story_id)
    const marker = await standsMarker(db, o.title, entries)
    const unchanged = o.marker !== null && o.marker === marker && (o.until === null || today < o.until)
    const facts = unchanged ? [] : await loadMemberFacts(db, storyIds)
    cases.push({
      overviewId: o.id,
      title: o.title,
      entries: entries.map(e => ({ storyId: e.story_id, title: e.title, date: utcDay(e.date_published), role: roleFrom(e.role, e.role_kind) })),
      members: facts.map(f => ({ ...f, published: true })),
      lastSignature: o.signature,
      marker,
      unchanged,
    })
  }
  return cases
}

/**
 * The marker of what a stands offer is made of: the title the prompt reads (so a retitle or re-center
 * forces a fresh write), the entries and their roles, and every pool fact of theirs `loadMemberFacts`
 * could read, with what decides whether it does.
 */
async function standsMarker(db: OverviewDb, title: string, entries: readonly { story_id: string; role: string; role_kind: string | null }[]): Promise<string> {
  const members = entries.map(e => `${e.story_id}:${e.role}:${e.role_kind ?? ''}`).sort()
  if (entries.length === 0) return `${title}|none`
  const [row] = await db.$queryRaw<{ n: bigint; facts: string | null }[]>`
    SELECT COUNT(*) AS n,
           md5(string_agg(f.id || ':' || f.verdict::text || ':' || f.status::text || ':' || COALESCE(f.structure_model, '') || ':' ||
                          COALESCE(s.ref, '') || ':' || COALESCE(s.drop_reason, '') || ':' || s.origin::text, ',' ORDER BY f.id)) AS facts
    FROM pool_facts f JOIN evidence_sources s ON s.id = f.source_id
    WHERE f.story_id = ANY(${entries.map(e => e.story_id)}::text[])
  `
  return `${title}|${members.join(',')}|${String(row?.n ?? 0)}:${row?.facts ?? ''}`
}
