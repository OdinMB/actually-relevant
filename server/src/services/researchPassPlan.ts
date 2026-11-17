/**
 * Which searches a research pass makes, and which pages it reads (`.context/research-passes.md`,
 * "The steps"): research's coverage queries and context's gap searches, `response` first from its
 * two angles while open, each skipping what any earlier pass of the story searched (the pool's
 * searches: a normalized query, a `response` angle) and the pages the pool holds or left out. Pure.
 */
import { config } from '../config.js'
import type { GapList } from '../schemas/storyContext.js'
import { domainOf, normalizedUrl } from './researchFilter.js'
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

/** Research's coverage queries a pass searches, in their order, and those an earlier pass made. */
export function coverageSearches<Q extends { query: string }>(queries: Q[], pool: Pick<Pool, 'searches'>): { search: Q[]; skipped: Q[] } {
  const made = new Set(madeSearches(pool).queries)
  return { search: queries.filter(q => !made.has(normalizedQuery(q.query))), skipped: queries.filter(q => made.has(normalizedQuery(q.query))) }
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
