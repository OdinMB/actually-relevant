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
import type { Membership, Memberships, OverviewScope, OverviewStatus } from './overviewTypes.js'

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

interface MembershipRow {
  story_id: string
  overview_id: string
  scope: OverviewScope
  status: OverviewStatus
  closed_reason: string | null
  frozen: boolean
  last_entry_at: Date | null
}

/**
 * The stories' active overviews, and the overviews an editor detached each from (`locked`). With
 * `asOf` (the story being linked's date), an overview's last entry is its newest active entry of a
 * story still published, published on or before it, as linking a story sees the development on its
 * own day (a member unpublished before the job detached it keeps nothing alive); without, the
 * overview's `last_entry_at`.
 */
export async function membershipsOf(db: OverviewDb, storyIds: readonly string[], asOf?: Date): Promise<Memberships> {
  const ids = [...new Set(storyIds)]
  if (ids.length === 0) return { active: new Map(), lockedOut: new Map() }
  const rows = asOf
    ? await db.$queryRaw<MembershipRow[]>`
        SELECT e.story_id, o.id AS overview_id, o.scope::text AS scope, o.status::text AS status, o.closed_reason, o.frozen,
               (SELECT max(s.date_published) FROM overview_entries m JOIN stories s ON s.id = m.story_id
                WHERE m.overview_id = o.id AND m.status = 'active' AND s.status = 'published' AND s.date_published <= ${asOf}) AS last_entry_at
        FROM overview_entries e
        JOIN overviews o ON o.id = e.overview_id
        WHERE e.status = 'active' AND e.story_id = ANY(${ids}::text[])
      `
    : await db.$queryRaw<MembershipRow[]>`
        SELECT e.story_id, o.id AS overview_id, o.scope::text AS scope, o.status::text AS status, o.closed_reason, o.frozen, o.last_entry_at
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
      { overviewId: r.overview_id, scope: r.scope, status: r.status, closedReason: r.closed_reason, frozen: r.frozen, lastEntryAt: r.last_entry_at },
    ]),
  )
  const lockedOut = new Map<string, string[]>()
  for (const r of locked) lockedOut.set(r.story_id, [...(lockedOut.get(r.story_id) ?? []), r.overview_id])
  return { active, lockedOut }
}

/** A candidate overview, ranked by its nearest member. */
export interface RankedOverview {
  overviewId: string
  distance: number
  frozen: boolean
}

export interface Candidates {
  /** Nearest first, at most `candidateOverviews`. */
  overviews: RankedOverview[]
  /** Unlinked neighbours that may found a development with the story, nearest first, at most `foundingCandidates`. */
  partners: Neighbour[]
}

/**
 * Whether an overview may take a story dated `asOf`: not closed (a faded one reopens), and with an
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
 * and the founding window before the story, as founding partners. A frozen overview stays a candidate,
 * so a story that belongs there is held rather than settled elsewhere. Pure.
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
  const windowStart = story.datePublished.getTime() - options.foundingWindowDays * DAY_MS
  for (const n of neighbours) {
    if (n.id === story.id || n.datePublished.getTime() > story.datePublished.getTime()) continue
    const m = memberships.active.get(n.id)
    if (!m) {
      if (n.distance <= options.maxDistance && n.datePublished.getTime() >= windowStart) partners.push(n)
      continue
    }
    if (lockedOut.has(m.overviewId) || !takesStories(m, story.datePublished, options.memberLookbackDays)) continue
    const known = nearestOf.get(m.overviewId)
    if (!known || n.distance < known.distance) nearestOf.set(m.overviewId, { overviewId: m.overviewId, distance: n.distance, frozen: m.frozen })
  }
  const byDistance =
    <T extends { distance: number }>(key: (x: T) => string) =>
    (a: T, b: T) =>
      a.distance - b.distance || key(a).localeCompare(key(b))
  return {
    overviews: [...nearestOf.values()].sort(byDistance(o => o.overviewId)).slice(0, options.candidateOverviews),
    partners: partners.sort(byDistance(p => p.id)).slice(0, options.foundingCandidates),
  }
}
