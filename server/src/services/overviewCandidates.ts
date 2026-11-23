/**
 * A story's candidate overviews and founding partners (`.context/overviews.md`, "How a story is
 * linked", step 1), in two parts so the eval's replay runs the same code:
 * - SELECT only, through the client given (production's, or the eval's read-only session):
 *   `nearestPublished`, the story's published neighbours by exact cosine distance as of its own date,
 *   plus the earlier stories its research linked and its cluster's members; `membershipsOf`, those
 *   stories' active overviews and the overviews an editor detached the story from.
 * - Pure: `groupCandidates`, over an injected membership map (production's from the tables, the
 *   sandbox's in memory).
 */
import { config } from '../config.js'
import { waitsOf } from './overviewOwed.js'
import { holdsForRecenter, recenterMayCome } from './overviewRecenter.js'
import { LINK_OUTCOMES, type Membership, type Memberships, type OverviewScope, type OverviewStatus } from './overviewTypes.js'
import { oneOf } from './storyContextRecords.js'

/** The part of a Prisma client (or the eval's read-only session) this module uses. */
export interface OverviewDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

const DAY_MS = 86_400_000

/** A distance for a linked story without an embedding: past any cut, last in every ranking. */
const NO_DISTANCE = 2

/** A published story near the one being linked, as of its date. */
export interface Neighbour {
  id: string
  datePublished: Date
  /** Cosine distance to the story (`NO_DISTANCE` for a linked story without an embedding). */
  distance: number
  /** `near`: within the distance; `linked`: an earlier story research linked, or a cluster member. */
  via: 'near' | 'linked'
}

export interface CandidateOptions {
  maxDistance: number
  neighbourLimit: number
  memberLookbackDays: number
  foundingWindowDays: number
  candidateOverviews: number
  foundingCandidates: number
}

interface NeighbourRow {
  id: string
  date_published: Date
  distance: number | string | null
}

const asNeighbour =
  (via: Neighbour['via']) =>
  (r: NeighbourRow): Neighbour => ({
    id: r.id,
    datePublished: r.date_published,
    distance: r.distance === null ? NO_DISTANCE : Number(r.distance),
    via,
  })

/**
 * The story's published neighbours as of `asOf` (its own publication date): those within
 * `maxDistance` published in the member lookback before it, by exact distance (dedup's pattern: a
 * `MATERIALIZED` CTE filters first, so no index scan drops a match, `.context/embeddings.md`); then the
 * earlier stories its research linked (its pool's `earlier` sources, else its newest completed legacy
 * run's) and its cluster's other members, published on or before `asOf`, whatever their distance.
 * Nearest first; a story is listed once.
 */
export async function nearestPublished(
  db: OverviewDb,
  storyId: string,
  asOf: Date,
  options: Pick<CandidateOptions, 'maxDistance' | 'neighbourLimit' | 'memberLookbackDays'> = config.overviews,
): Promise<Neighbour[]> {
  const since = new Date(asOf.getTime() - options.memberLookbackDays * DAY_MS)
  const near = await db.$queryRaw<NeighbourRow[]>`
    WITH pool AS MATERIALIZED (
      SELECT s.id, s.date_published, e.embedding
      FROM story_embeddings e
      JOIN stories s ON s.id = e.story_id
      WHERE s.id <> ${storyId}
        AND s.status = 'published'
        AND s.date_published <= ${asOf}
        AND s.date_published >= ${since}
    ), scored AS (
      SELECT id, date_published,
             embedding <=> (SELECT embedding FROM story_embeddings WHERE story_id = ${storyId}) AS distance
      FROM pool
    )
    SELECT id, date_published, distance
    FROM scored
    WHERE distance <= ${options.maxDistance}
    ORDER BY distance ASC, id ASC
    LIMIT ${options.neighbourLimit}
  `
  const linked = await db.$queryRaw<NeighbourRow[]>`
    WITH pool_earlier AS (
      SELECT es.earlier_story_id AS id
      FROM evidence_sources es
      WHERE es.story_id = ${storyId} AND es.origin = 'earlier' AND es.earlier_story_id IS NOT NULL AND es.drop_reason IS NULL
    ), legacy_earlier AS (
      SELECT item->>'storyId' AS id
      FROM (
        SELECT r.result FROM story_research_runs r
        WHERE r.story_id = ${storyId} AND r.status = 'completed'
        ORDER BY r.started_at DESC
        LIMIT 1
      ) latest,
      jsonb_array_elements(CASE WHEN jsonb_typeof(latest.result->'earlier') = 'array' THEN latest.result->'earlier' ELSE '[]'::jsonb END) item
      WHERE NOT EXISTS (SELECT 1 FROM pool_earlier)
    ), cluster_members AS (
      SELECT m.id FROM stories self JOIN stories m ON m.cluster_id = self.cluster_id
      WHERE self.id = ${storyId} AND self.cluster_id IS NOT NULL
    ), linked AS (
      SELECT id FROM pool_earlier UNION SELECT id FROM legacy_earlier UNION SELECT id FROM cluster_members
    )
    SELECT s.id, s.date_published,
           e.embedding <=> (SELECT embedding FROM story_embeddings WHERE story_id = ${storyId}) AS distance
    FROM linked l
    JOIN stories s ON s.id = l.id
    LEFT JOIN story_embeddings e ON e.story_id = s.id
    WHERE s.id <> ${storyId} AND s.status = 'published' AND s.date_published <= ${asOf}
  `
  const byId = new Map<string, Neighbour>()
  for (const n of near.map(asNeighbour('near'))) byId.set(n.id, n)
  for (const n of linked.map(asNeighbour('linked'))) if (!byId.has(n.id)) byId.set(n.id, n)
  return [...byId.values()].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
}

/** The columns that say whether automation may still re-center an overview (`recenterMayCome`). */
interface RecenterColumns {
  status: OverviewStatus
  automated_recenters: number
  recentered_at: Date | null
  recentered_by: string | null
  recenter_undone_at: Date | null
}

interface MembershipRow extends RecenterColumns {
  story_id: string
  overview_id: string
  scope: OverviewScope
  closed_reason: string | null
  frozen: boolean
  last_entry_at: Date | null
  /** Its active entries of published stories (on or before `asOf` when given), as `holdsForRecenter` counts them. */
  active_entries: number
}

const recenterStateOf = (r: RecenterColumns) => ({
  status: r.status,
  automatedRecenters: r.automated_recenters,
  recenteredAt: r.recentered_at,
  recenteredBy: r.recentered_by,
  recenterUndoneAt: r.recenter_undone_at,
})
const recenterableAt = (r: RecenterColumns, now: Date): boolean => recenterMayCome(recenterStateOf(r), now)

/** A live `link` decision of a story, with the overview it names (its columns null with none), as `waitsOf` reads it. */
interface WaitRow extends Omit<RecenterColumns, 'status' | 'automated_recenters'> {
  story_id: string
  outcome: string
  overview_id: string | null
  linked_at: string | null
  created_at: Date
  date_published: Date | null
  status: OverviewStatus | null
  automated_recenters: number | null
  recenter_tried_at: Date | null
}

/**
 * The stories' active overviews, the overviews an editor detached each from (`locked`), those whose
 * latest founding check judged them to report no occurrence (`noOccurrence`, from the `found` decisions'
 * stored answers, the newest first, as A or B; an Undo of a founding leaves its check's judgment standing),
 * and the waits for a re-center (`heldForRecenter`, `heldBefore`, from their live `link` decisions,
 * `waitsOf`, ADR-0078). Each overview says whether a story that points past it waits for its re-center
 * (`mayHold`, `holdsForRecenter`: its active entries counted as its last entry is, automation's limits at
 * `now`, the run's wall clock). With `asOf` (the story being linked's date), an overview's last entry is
 * its newest active entry of a story still published, published on or before it, and its entries are
 * counted so, as linking a story sees the development on its own day (a member unpublished before the
 * job detached it keeps nothing alive); without, the overview's `last_entry_at` and every active entry
 * of a published story.
 */
export async function membershipsOf(db: OverviewDb, storyIds: readonly string[], asOf?: Date, now: Date = new Date()): Promise<Memberships> {
  const ids = [...new Set(storyIds)]
  if (ids.length === 0) return { active: new Map(), lockedOut: new Map() }
  const rows = asOf
    ? await db.$queryRaw<MembershipRow[]>`
        SELECT e.story_id, o.id AS overview_id, o.scope::text AS scope, o.status::text AS status, o.closed_reason, o.frozen,
               o.automated_recenters, o.recentered_at, o.recentered_by, o.recenter_undone_at,
               (SELECT max(s.date_published) FROM overview_entries m JOIN stories s ON s.id = m.story_id
                WHERE m.overview_id = o.id AND m.status = 'active' AND s.status = 'published' AND s.date_published <= ${asOf}) AS last_entry_at,
               (SELECT count(*)::int FROM overview_entries m JOIN stories s ON s.id = m.story_id
                WHERE m.overview_id = o.id AND m.status = 'active' AND s.status = 'published' AND s.date_published <= ${asOf}) AS active_entries
        FROM overview_entries e
        JOIN overviews o ON o.id = e.overview_id
        WHERE e.status = 'active' AND e.story_id = ANY(${ids}::text[])
      `
    : await db.$queryRaw<MembershipRow[]>`
        SELECT e.story_id, o.id AS overview_id, o.scope::text AS scope, o.status::text AS status, o.closed_reason, o.frozen, o.last_entry_at,
               o.automated_recenters, o.recentered_at, o.recentered_by, o.recenter_undone_at,
               (SELECT count(*)::int FROM overview_entries m JOIN stories s ON s.id = m.story_id
                WHERE m.overview_id = o.id AND m.status = 'active' AND s.status = 'published') AS active_entries
        FROM overview_entries e
        JOIN overviews o ON o.id = e.overview_id
        WHERE e.status = 'active' AND e.story_id = ANY(${ids}::text[])
      `
  const locked = await db.$queryRaw<{ story_id: string; overview_id: string }[]>`
    SELECT DISTINCT story_id, overview_id FROM overview_entries
    WHERE status = 'detached' AND locked AND story_id = ANY(${ids}::text[])
  `
  const active = new Map<string, Membership>(
    rows.map(r => [
      r.story_id,
      {
        overviewId: r.overview_id,
        scope: r.scope,
        status: r.status,
        closedReason: r.closed_reason,
        frozen: r.frozen,
        lastEntryAt: r.last_entry_at,
        mayHold: holdsForRecenter({ ...recenterStateOf(r), activeEntries: r.active_entries }, now),
      },
    ]),
  )
  const links = await db.$queryRaw<WaitRow[]>`
    SELECT d.story_id, d.outcome, d.overview_id, d.inputs->>'linkedAt' AS linked_at, d.created_at, s.date_published,
           o.status::text AS status, o.automated_recenters, o.recentered_at, o.recentered_by, o.recenter_undone_at, o.recenter_tried_at
    FROM overview_decisions d
    JOIN stories s ON s.id = d.story_id
    LEFT JOIN overviews o ON o.id = d.overview_id
    WHERE d.kind = 'link' AND d.undone_at IS NULL AND d.story_id = ANY(${ids}::text[])
  `
  const waits = waitsOf(
    links.flatMap(l =>
      l.date_published
        ? [
            {
              storyId: l.story_id,
              outcome: oneOf(l.outcome, LINK_OUTCOMES, 'failed'),
              overviewId: l.overview_id,
              at: l.linked_at ? new Date(l.linked_at) : l.created_at,
              datePublished: l.date_published,
              overview:
                l.status !== null && l.automated_recenters !== null
                  ? { recenterable: recenterableAt({ ...l, status: l.status, automated_recenters: l.automated_recenters }, now), triedAt: l.recenter_tried_at }
                  : null,
            },
          ]
        : [],
    ),
    now,
  )
  const lockedOut = new Map<string, string[]>()
  for (const r of locked) lockedOut.set(r.story_id, [...(lockedOut.get(r.story_id) ?? []), r.overview_id])
  // Each story's latest founding check, as A (the earlier story; the partner on a tie) or B: its `occurred`
  const checked = await db.$queryRaw<{ story_id: string; occurred: string | null }[]>`
    WITH attempts AS (
      SELECT d.id, d.created_at, d.story_id AS linked, d.inputs->>'partnerId' AS partner, d.answer->'check' AS chk,
             (p.date_published <= s.date_published) AS partner_is_a
      FROM overview_decisions d
      JOIN stories s ON s.id = d.story_id
      JOIN stories p ON p.id = d.inputs->>'partnerId'
      WHERE d.kind = 'found'
        AND (d.story_id = ANY(${ids}::text[]) OR d.inputs->>'partnerId' = ANY(${ids}::text[]))
    ), sides AS (
      SELECT id, created_at, linked AS story_id, CASE WHEN partner_is_a THEN chk->'b'->>'occurred' ELSE chk->'a'->>'occurred' END AS occurred FROM attempts
      UNION ALL
      SELECT id, created_at, partner AS story_id, CASE WHEN partner_is_a THEN chk->'a'->>'occurred' ELSE chk->'b'->>'occurred' END AS occurred FROM attempts
    )
    SELECT DISTINCT ON (story_id) story_id, occurred
    FROM sides
    WHERE story_id = ANY(${ids}::text[]) AND occurred IS NOT NULL
    ORDER BY story_id, created_at DESC, id DESC
  `
  return { active, lockedOut, noOccurrence: new Set(checked.filter(r => r.occurred === 'no').map(r => r.story_id)), ...waits }
}

/** A founding attempt as the occurrence rule reads it: the linked story, its partner, their days, and the check's per-story answers (A the earlier, the partner on a tie). */
export interface CheckedAttempt {
  storyId: string
  partnerId: string
  storyDate: Date
  partnerDate: Date
  check: { a: { occurred?: string }; b: { occurred?: string } } | null
}

/**
 * The stories whose latest founding check, of the attempts given in the order made, judged that they
 * report no occurrence: production reads the same from its `found` decisions (`membershipsOf`), the
 * eval's sandbox from its own. A check with no `occurred` answer says nothing either way. Pure.
 */
export function noOccurrenceOf(attempts: readonly CheckedAttempt[]): Set<string> {
  const latest = new Map<string, string>()
  for (const t of attempts) {
    if (!t.check) continue
    const partnerIsA = t.partnerDate.getTime() <= t.storyDate.getTime()
    const sides: [string, string | undefined][] = [
      [t.storyId, (partnerIsA ? t.check.b : t.check.a).occurred],
      [t.partnerId, (partnerIsA ? t.check.a : t.check.b).occurred],
    ]
    for (const [id, occurred] of sides) if (occurred) latest.set(id, occurred)
  }
  return new Set([...latest].filter(([, occurred]) => occurred === 'no').map(([id]) => id))
}

/** A candidate overview, ranked by its nearest member. */
export interface RankedOverview {
  overviewId: string
  distance: number
  frozen: boolean
  /** A story that points past it waits for its re-center (`Membership.mayHold`, ADR-0078). */
  mayHold: boolean
}

export interface Candidates {
  /** Nearest first, at most `candidateOverviews`. */
  overviews: RankedOverview[]
  /** Unlinked neighbours that may found a development with the story, nearest first, at most `foundingCandidates`. */
  partners: Neighbour[]
  /** Unlinked neighbours within the distance and window left out as partners because a founding check judged them to report no occurrence. */
  excludedPartners: string[]
  /** Unlinked neighbours within the distance and window left out as partners because they wait for an overview's re-center (ADR-0078). */
  heldPartners: string[]
}

/**
 * Whether an overview may take a story dated `asOf`: not closed unless it faded (a faded one reopens;
 * one an editor closed takes none until reopened, as any other closed reason), and with an
 * entry within the lookback before it. `lastEntryAt` is the last entry as of the story's own day
 * (`membershipsOf` with `asOf`, the sandbox's alike), so an entry published after the story never
 * keeps an overview alive for it.
 */
const takesStories = (m: Membership, asOf: Date, lookbackDays: number): boolean =>
  !(m.status === 'closed' && m.closedReason !== 'faded') && m.lastEntryAt !== null && m.lastEntryAt.getTime() >= asOf.getTime() - lookbackDays * DAY_MS

/**
 * The story's candidates from its neighbours and their memberships: the overviews of neighbours that
 * are active members of an overview that still takes stories, minus those an editor detached the story
 * from, ranked by their nearest member; and the neighbours with no active entry, within the distance
 * and the founding window before the story, as founding partners, except those a founding check judged
 * to report no occurrence (`noOccurrence`) and those waiting for an overview's re-center
 * (`heldForRecenter`, ADR-0078), each left out before the cut so the slot goes to the next one. A
 * frozen overview stays a candidate, so a story that belongs there is held rather than settled
 * elsewhere. Pure.
 */
export function groupCandidates(
  story: { id: string; datePublished: Date },
  neighbours: readonly Neighbour[],
  memberships: Memberships,
  options: CandidateOptions = config.overviews,
): Candidates {
  const lockedOut = new Set(memberships.lockedOut.get(story.id) ?? [])
  const nearestOf = new Map<string, RankedOverview>()
  const partners: Neighbour[] = []
  const excludedPartners: string[] = []
  const heldPartners: string[] = []
  const windowStart = story.datePublished.getTime() - options.foundingWindowDays * DAY_MS
  for (const n of neighbours) {
    if (n.id === story.id || n.datePublished.getTime() > story.datePublished.getTime()) continue
    const m = memberships.active.get(n.id)
    if (!m) {
      if (n.distance > options.maxDistance || n.datePublished.getTime() < windowStart) continue
      if (memberships.noOccurrence?.has(n.id)) excludedPartners.push(n.id)
      else if (memberships.heldForRecenter?.has(n.id)) heldPartners.push(n.id)
      else partners.push(n)
      continue
    }
    if (lockedOut.has(m.overviewId) || !takesStories(m, story.datePublished, options.memberLookbackDays)) continue
    const known = nearestOf.get(m.overviewId)
    if (!known || n.distance < known.distance)
      nearestOf.set(m.overviewId, { overviewId: m.overviewId, distance: n.distance, frozen: m.frozen, mayHold: m.mayHold === true })
  }
  const byDistance =
    <T extends { distance: number }>(key: (x: T) => string) =>
    (a: T, b: T) =>
      a.distance - b.distance || key(a).localeCompare(key(b))
  return {
    overviews: [...nearestOf.values()].sort(byDistance(o => o.overviewId)).slice(0, options.candidateOverviews),
    partners: partners.sort(byDistance(p => p.id)).slice(0, options.foundingCandidates),
    excludedPartners,
    heldPartners,
  }
}
