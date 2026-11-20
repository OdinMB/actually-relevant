/**
 * What the overview step's upkeep reads (`.context/overviews.md`, "The job", parts 2 to 5), SELECT only
 * through the client given: the raw rows of the closing checks due and of an overview's review, which
 * `overviewCases.ts` turns into cases as the eval's sandbox does, every overview's state for the status
 * machine (`overviewStateOf`, from its row and its active entries), the monthly audit's picks, and
 * each public overview's stands case (its members' usable facts, skipped when nothing they are made of
 * changed, and the last refresh's record).
 */
import { config } from '../config.js'
import { utcDay } from '../lib/days.js'
import type { CloseCase } from './overviewClose.js'
import type { OverviewDb } from './overviewCandidates.js'
import { closeCasesOf, entryRole, reviewCaseOf, UNSETTLED_CLOSE_OUTCOMES, type CaseDecision } from './overviewCases.js'
import { REPORTS_END_EVENT } from './overviewDecisions.js'
import { linkStories } from './overviewInput.js'
import { publicOverviewSql } from './overviewPublicRule.js'
import type { ReviewCase } from './overviewReview.js'
import { OVERVIEW_COLUMNS, overviewRowFrom, readCaseEntries, readOverviewRows, type RawOverview } from './overviewRow.js'
import { overviewStateOf, type StateEntry } from './overviewState.js'
import { ENTRY_ROLES, type OverviewState } from './overviewTypes.js'
import type { StandsCase } from './overviewUpkeep.js'
import { loadMemberFacts } from './passRecords.js'
import { oneOf } from './storyContextRecords.js'

/**
 * The closing checks due (`closeCasesOf`), from the live link decisions flagged as reporting their
 * overview's end event, their overviews and those overviews' active entries. The SELECT leaves out
 * ahead what `closeCasesOf` would: a story no longer an active published member, an overview not open
 * or quiet, frozen or naming no end event, and a pair already judged.
 */
export async function pendingClosings(db: OverviewDb, options: Pick<typeof config.overviews, 'candidateEntries'> = config.overviews): Promise<CloseCase[]> {
  const joins = await db.$queryRaw<CaseDecision[]>`
    SELECT d.kind::text AS kind, d.outcome, d.overview_id AS "overviewId", d.story_id AS "storyId", (d.undone_at IS NOT NULL) AS undone, d.inputs
    FROM overview_decisions d
    JOIN overview_entries e ON e.story_id = d.story_id AND e.overview_id = d.overview_id AND e.status = 'active'
    JOIN overviews o ON o.id = d.overview_id
    JOIN stories s ON s.id = d.story_id
    WHERE d.kind = 'link' AND d.outcome = 'joined' AND d.undone_at IS NULL AND d.inputs->>${REPORTS_END_EVENT} = 'true'
      AND s.status = 'published' AND o.status IN ('open', 'quiet') AND NOT o.frozen AND o.charter->>'endEvent' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM overview_decisions c
        WHERE c.kind = 'close' AND c.story_id = d.story_id AND c.overview_id = d.overview_id AND c.outcome <> ALL(${[...UNSETTLED_CLOSE_OUTCOMES]}::text[])
      )
  `
  if (joins.length === 0) return []
  const overviewIds = [...new Set(joins.flatMap(j => j.overviewId ?? []))]
  const [overviews, entries, stories] = await Promise.all([
    readOverviewRows(db, overviewIds),
    readCaseEntries(db, overviewIds, 'active'),
    linkStories(
      db,
      joins.flatMap(j => j.storyId ?? []),
    ),
  ])
  return closeCasesOf({ joins, closes: [], overviews, entries, stories: new Map(stories.map(s => [s.id, s])) }, options)
}

/**
 * Every overview with an active entry, oldest founding first, as the status machine reads it
 * (`overviewStateOf`): its row, its active entries with their stories' publication, and the newest
 * reader's report that queued a review (`feedback.queues_review`). One without a readable charter,
 * which no write could be planned on, is left out.
 */
export async function overviewStates(
  db: OverviewDb,
  now: Date,
  options: Pick<typeof config.overviews, 'nightHours'> = config.overviews,
): Promise<OverviewState[]> {
  const rows = (
    await db.$queryRaw<RawOverview[]>`
      SELECT ${OVERVIEW_COLUMNS}
      FROM overviews o
      WHERE EXISTS (SELECT 1 FROM overview_entries e WHERE e.overview_id = o.id AND e.status = 'active')
      ORDER BY o.founded_at, o.id
    `
  ).flatMap(r => overviewRowFrom(r) ?? [])
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id)
  const [entries, reports] = await Promise.all([
    readCaseEntries(db, ids, 'active'),
    db.$queryRaw<{ overview_id: string; report_at: Date }[]>`
      SELECT f.overview_id, MAX(f.created_at) AS report_at
      FROM feedback f
      WHERE f.queues_review AND f.overview_id = ANY(${ids}::text[])
      GROUP BY f.overview_id
    `,
  ])
  return rows.map(r => {
    const own: StateEntry[] = entries.filter(e => e.overviewId === r.id)
    return overviewStateOf(r, own, reports.find(f => f.overview_id === r.id)?.report_at ?? null, now, options)
  })
}

/** An overview as its review reads it (`reviewCaseOf`); null for an overview gone or without a readable charter. */
export async function reviewCase(db: OverviewDb, overviewId: string): Promise<ReviewCase | null> {
  const [o] = await readOverviewRows(db, [overviewId])
  return o ? reviewCaseOf(o, await readCaseEntries(db, [overviewId], 'active')) : null
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
      entries: entries.map(e => ({
        storyId: e.story_id,
        title: e.title,
        date: utcDay(e.date_published),
        role: entryRole({ role: oneOf(e.role, ENTRY_ROLES, 'routine'), roleKind: e.role_kind }),
      })),
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
