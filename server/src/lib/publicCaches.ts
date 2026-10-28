/**
 * The in-memory caches that hold what public visitors see (homepage, issues, sources, RSS and
 * podcast feeds, sitemap, related stories, story link previews). Each registers itself where it is
 * created, so the admin "Clear cache" control empties all of them at once (`.context/admin-dashboard.md`).
 * Caches that hold nothing visitors read (search embeddings, social metrics) stay out.
 */
import { createLogger } from './logger.js'

const log = createLogger('cache')

/** A TTLCache, a BoundedCache, or anything else that can say how full it is and empty itself. */
export interface ClearableCache {
  readonly size: number
  clear(): void
}

const registry = new Map<string, ClearableCache>()

export function registerPublicCache(name: string, cache: ClearableCache): void {
  registry.set(name, cache)
}

export interface ClearedCache {
  name: string
  entries: number
}

/** Empty every registered public cache; the next request for each rebuilds it from the database. */
export function clearPublicCaches(): ClearedCache[] {
  const cleared = [...registry].map(([name, cache]) => {
    const entries = cache.size
    cache.clear()
    return { name, entries }
  })
  log.info({ cleared }, 'public caches cleared')
  return cleared
}
