/**
 * What one research pass reads (`.context/research-passes.md`, "Input"): the story as research's
 * loader gives it, its evidence pool, its current article version and the places readers see, the
 * reusable facts of the earlier stories research may link, and whether an editor's pass may start.
 * SELECT only, through the client it is given, so the eval can pass its read-only session. The
 * legacy import is the claim's (`legacyPool.ts`, in the pass's transaction), never this module's.
 * The earlier stories' facts are context's (`context_facts`) until passes store them: reading
 * their pool facts too comes with the wiring.
 */
import { utcDay } from '../lib/days.js'
import { currentVersion, loadPool } from './passRecords.js'
import type { OfferedFact, PassInput } from './researchPass.js'
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
  const [pool, version] = await Promise.all([loadPool(db, storyId), currentVersion(db, storyId)])
  return storyInput(db, storyId, passId, now, pool, version)
}

/**
 * A first pass's input: `loadPassInput`'s without reading the pass tables, so with an empty pool, no
 * version and the story's own columns. The eval's replay of a first pass on a story of any history.
 */
export async function loadFirstPassInput(db: ResearchDb, storyId: string, passId: string, now: Date = new Date()): Promise<PassInput | null> {
  return storyInput(db, storyId, passId, now, EMPTY_POOL, null)
}

async function storyInput(
  db: ResearchDb,
  storyId: string,
  passId: string,
  now: Date,
  pool: Pool,
  version: ArticleVersionData | null,
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

export interface PassEligibility {
  status: string
  /** A pass of the story is running: one at a time. */
  running: boolean
  /**
   * `later` when the story has an article to judge: a current version, or researched text the legacy
   * import makes version 1. A story whose first passes kept no article gets a first pass again.
   */
  kind: 'first' | 'later'
}

/** What an editor's pass needs of a story (`.context/research-passes.md`, "Admin"); null for an unknown story. */
export async function passEligibility(db: ResearchDb, storyId: string): Promise<PassEligibility | null> {
  const [row] = await db.$queryRaw<{ status: string; running: boolean; versioned: boolean }[]>`
    SELECT s.status::text AS status,
           EXISTS (SELECT 1 FROM research_passes p WHERE p.story_id = s.id AND p.status = 'running') AS running,
           (s.research IS NOT NULL OR EXISTS (SELECT 1 FROM article_versions v WHERE v.story_id = s.id AND v.status = 'current')) AS versioned
    FROM stories s WHERE s.id = ${storyId}`
  return row ? { status: row.status, running: row.running, kind: row.versioned ? 'later' : 'first' } : null
}
