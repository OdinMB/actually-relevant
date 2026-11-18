/**
 * What one research pass reads (`.context/research-passes.md`, "Input"): the story as research's
 * loader gives it, its evidence pool, its current article version and the places readers see, the
 * coverage plan its last pass kept, the reusable facts of the earlier stories research may link, and
 * whether an editor's pass may start.
 * SELECT only, through the client it is given, so the eval can pass its read-only session. The
 * legacy import is the claim's (`legacyPool.ts`, in the pass's transaction), never this module's.
 * An earlier story's facts are its pool's once it has one, else its context facts (`reusableFacts`).
 */
import { utcDay } from '../lib/days.js'
import { currentVersion, loadPool } from './passRecords.js'
import type { PassInput } from './researchPass.js'
import type { OfferedFact } from './researchPassPool.js'
import { storedPlan, type CoveragePlan } from './researchPassPlan.js'
import { researchStoriesByIds, type ResearchDb } from './researchInput.js'
import { EMPTY_POOL, type ArticleVersionData, type Pool } from './researchPool.js'
import { storyLayout } from './storyContextLayout.js'
import { reusableFacts } from './storyContextInput.js'

interface StoryRow {
  research: unknown
  /** Null for a story not yet published. */
  date_published: Date | null
}

/**
 * One story's pass input, or null when research cannot run on it (`researchStoriesByIds`). A
 * published story's day is its publishing day, any other's `now`'s. The current version's text is
 * what the gap list reads; with none, the story's own columns. The earlier stories' facts come
 * uncapped: the pass offers those of the stories it links, at most `maxReusedFacts`.
 */
export async function loadPassInput(db: ResearchDb, storyId: string, passId: string, now: Date = new Date()): Promise<PassInput | null> {
  const [pool, version, lastPassDay, carried, plan] = await Promise.all([
    loadPool(db, storyId),
    currentVersion(db, storyId),
    lastPassDayOf(db, storyId, passId),
    carriedPasses(db, storyId, passId),
    lastPlanOf(db, storyId, passId),
  ])
  return storyInput(db, storyId, passId, now, pool, version, { lastPassDay, carried, plan })
}

/**
 * A first pass's input: `loadPassInput`'s without reading the pass tables, so with an empty pool, no
 * version and the story's own columns. The eval's replay of a first pass on a story of any history.
 */
export async function loadFirstPassInput(db: ResearchDb, storyId: string, passId: string, now: Date = new Date()): Promise<PassInput | null> {
  return storyInput(db, storyId, passId, now, EMPTY_POOL, null, { lastPassDay: null, carried: [], plan: null })
}

/**
 * The coverage plan the story's last pass kept (`PassRecord.plan`), completed or failed alike: its
 * answers stay good for as long as their prompts do. Null for none; the running pass itself never counts.
 */
async function lastPlanOf(db: ResearchDb, storyId: string, passId: string): Promise<CoveragePlan | null> {
  const [row] = await db.$queryRaw<{ plan: unknown }[]>`
    SELECT p.record->'plan' AS plan FROM research_passes p
    WHERE p.story_id = ${storyId} AND p.id <> ${passId} AND p.record->'plan' IS NOT NULL
    ORDER BY p.number DESC LIMIT 1`
  return storedPlan(row?.plan ?? null)
}

/**
 * The day the story's last completed pass, or legacy research run, started (`YYYY-MM-DD`): where a later
 * pass's coverage window opens. Null for a story with neither; the running pass itself never counts.
 */
async function lastPassDayOf(db: ResearchDb, storyId: string, passId: string): Promise<string | null> {
  const [row] = await db.$queryRaw<{ last: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max(p.started_at) FROM research_passes p WHERE p.story_id = ${storyId} AND p.status = 'completed' AND p.id <> ${passId}),
      (SELECT max(r.started_at) FROM story_research_runs r WHERE r.story_id = ${storyId} AND r.status = 'completed')
    ) AS last`
  return row?.last ? utcDay(row.last) : null
}

/**
 * The later passes whose facts the article never took a judgment on, which the next later pass judges
 * as its own: every later pass that ended (completed or failed) after the story's last pass whose
 * judgment the article took. That is a first pass that made a version, a later pass whose update was
 * applied, or one that found nothing to change. So a technical failure, a budget stop, an update not
 * applied (the story changed, or the step went off) and one that failed its checks are carried until
 * a pass settles them; a skipped pass stored no facts. The running pass itself never counts.
 */
async function carriedPasses(db: ResearchDb, storyId: string, passId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM research_passes p
    WHERE p.story_id = ${storyId} AND p.id <> ${passId} AND p.kind = 'later' AND p.status IN ('completed', 'failed')
      AND p.number > COALESCE((
        SELECT max(q.number) FROM research_passes q
        WHERE q.story_id = ${storyId} AND q.id <> ${passId}
          AND ((q.kind = 'first' AND q.version_id IS NOT NULL)
            OR (q.kind = 'later' AND q.status = 'completed' AND (q.outcome = 'unchanged' OR (q.outcome = 'updated' AND q.version_id IS NOT NULL))))
      ), 0)
    ORDER BY p.number`
  return rows.map(r => r.id)
}

async function storyInput(
  db: ResearchDb,
  storyId: string,
  passId: string,
  now: Date,
  pool: Pool,
  version: ArticleVersionData | null,
  history: Pick<PassInput, 'lastPassDay' | 'carried' | 'plan'>,
): Promise<PassInput | null> {
  const [story] = await researchStoriesByIds(db, [storyId])
  if (!story) return null
  const [row] = await db.$queryRaw<StoryRow[]>`
    SELECT s.research, CASE WHEN s.status = 'published' THEN s.date_published END AS date_published
    FROM stories s WHERE s.id = ${storyId}`
  if (!row) return null
  const storyDay = utcDay(row.date_published ?? now)
  const earlierIds = story.earlier.map(e => e.id)
  const reusable: OfferedFact[] = (await reusableFacts(db, earlierIds, storyDay, Number.POSITIVE_INFINITY)).map(({ storyId: earlierId, ...fact }) => ({
    storyId: earlierId,
    fact,
  }))
  const text = version ?? {
    title: story.published.title,
    summary: story.published.summary,
    relevanceReasons: story.published.whyThisMatters || null,
    antifactors: story.published.caveats || null,
    research: row.research,
  }
  return {
    passId,
    story,
    pool,
    version,
    ...history,
    today: utcDay(now),
    current: {
      title: text.title ?? story.published.title,
      summary: text.summary ?? '',
      layout: storyLayout({
        url: story.original.url,
        summary: text.summary,
        relevanceReasons: text.relevanceReasons,
        antifactors: text.antifactors,
        research: text.research,
      }),
    },
    storyDay,
    reusable,
  }
}

/**
 * What an editor's pass needs of a story before its claim (`.context/research-passes.md`, "Admin
 * routes"); which kind of pass it gets is the claim's to decide (`claimPass`).
 */
export interface PassEligibility {
  status: string
  /** A pass of the story is running: one at a time. */
  running: boolean
}

/** What an editor's pass needs of a story; null for an unknown story. */
export async function passEligibility(db: ResearchDb, storyId: string): Promise<PassEligibility | null> {
  const [row] = await db.$queryRaw<PassEligibility[]>`
    SELECT s.status::text AS status,
           EXISTS (SELECT 1 FROM research_passes p WHERE p.story_id = s.id AND p.status = 'running') AS running
    FROM stories s WHERE s.id = ${storyId}`
  return row ?? null
}
