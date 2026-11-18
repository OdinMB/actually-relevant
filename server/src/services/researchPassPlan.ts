/**
 * Which searches a research pass makes, and which pages it reads (`.context/research-passes.md`,
 * "The steps"): research's coverage queries, each skipped once an earlier pass searched it over the
 * same days, and context's gap searches, `response` first from its two angles while open, each
 * skipping what any earlier pass of the story searched (the pool's searches: a normalized query, a
 * `response` angle); the pages the pool holds or left out are never read again; and a
 * later pass's window since the last pass, with only the earlier stories new since. Pure.
 */
import { config } from '../config.js'
import type { GapList } from '../schemas/storyContext.js'
import { domainOf, normalizedUrl, type SearchWindow } from './researchFilter.js'
import type { ResearchStory } from './researchInput.js'
import type { Pool } from './researchPool.js'
import { planSearches, type ResponseAngle } from './storyContextPipeline.js'
import { normalizedQuery } from './storyContextSources.js'

const ANGLES: readonly ResponseAngle[] = ['action', 'elsewhere']

/** What the story's earlier passes searched: every query (coverage and gap alike), and the `response` angles. */
export function madeSearches(pool: Pick<Pool, 'searches'>): { queries: string[]; angles: ResponseAngle[] } {
  return {
    queries: [...new Set(pool.searches.map(s => normalizedQuery(s.query)))],
    angles: ANGLES.filter(a => pool.searches.some(s => s.slot === 'response' && s.angle === a)),
  }
}

/**
 * Research's coverage queries a pass searches over `window`, in their order, and those an earlier
 * pass's coverage search already made over every day of it. A query made over fewer days is searched
 * again, so a later pass finds what was reported since; a search with no window recorded (a legacy
 * run's) covered none.
 */
export function coverageSearches<Q extends { query: string }>(queries: Q[], pool: Pick<Pool, 'searches'>, window: SearchWindow): { search: Q[]; skipped: Q[] } {
  const covered = new Set(
    pool.searches
      .filter(s => s.kind === 'coverage' && s.windowStart !== null && s.windowEnd !== null && s.windowStart <= window.start && s.windowEnd >= window.end)
      .map(s => normalizedQuery(s.query)),
  )
  const made = (q: Q) => covered.has(normalizedQuery(q.query))
  return { search: queries.filter(q => !made(q)), skipped: queries.filter(made) }
}

/** Context's gap searches from the gap list (`planSearches`), at most `research.pass.maxGapSearches`, those made before skipped and listed. */
export function gapSearches(gap: GapList, story: { title: string; text: string }, pool: Pick<Pool, 'searches'>) {
  return planSearches(gap, story, madeSearches(pool), config.research.pass.maxGapSearches)
}

/** The pages a pass never reads again, by `normalizedUrl`: those the pool holds and those it left out. */
export function knownPages(pool: Pick<Pool, 'sources' | 'dropped'>): Set<string> {
  return new Set([...pool.sources.filter(s => s.url !== '').map(s => normalizedUrl(s.url)), ...pool.dropped.map(d => normalizedUrl(d.url))])
}

/** What the gap searches' source filter reads (`pickNewSources`): the pool's pages, their domains, and the pages left out. */
export function readPages(pool: Pick<Pool, 'sources' | 'dropped'>): { urls: string[]; domains: string[]; read: string[] } {
  const urls = pool.sources.filter(s => s.url !== '').map(s => s.url)
  return { urls, domains: [...new Set(urls.map(domainOf).filter(Boolean))], read: pool.dropped.map(d => d.url) }
}

/**
 * A later pass's coverage window: from the last pass's day to today (capped by `latest`, the eval's
 * sampling time), what other outlets reported since. Both `YYYY-MM-DD`; a start past the end is the end.
 */
export function laterWindow(lastPassDay: string, today: string, latest?: string): SearchWindow {
  const cap = latest?.slice(0, 10)
  const end = cap !== undefined && cap < today.slice(0, 10) ? cap : today.slice(0, 10)
  const start = lastPassDay.slice(0, 10)
  return { start: start > end ? end : start, end }
}

/** The story as a later pass reads it: only our earlier stories published since its window opened and not in the pool yet. */
export function laterStory(story: ResearchStory, pool: Pick<Pool, 'sources'>, window: SearchWindow): ResearchStory {
  const linked = new Set(pool.sources.flatMap(s => (s.earlierStoryId ? [s.earlierStoryId] : [])))
  return { ...story, earlier: story.earlier.filter(e => !linked.has(e.id) && e.datePublished.slice(0, 10) >= window.start) }
}
