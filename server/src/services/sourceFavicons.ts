/**
 * Outlet favicons for research sources (`source_favicons`, .context/story-research.md, "Reader
 * format"): one 32 px PNG per host, so readers' browsers never ask the outlets (no tracking). Fetched
 * in the background with the feed favicons' search (favicon.ts `findIcon`), Tavily's icon address
 * first; a host where none was found is recorded with a null PNG and not looked up again for
 * `config.favicon.sourceNegativeCacheDays`. Read by GET /api/source-favicons/:host, kept in memory
 * like the feed favicons. Applying a research run to a story starts the fetch (researchApply.ts).
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { TTLCache, cached } from '../lib/cache.js'
import { createLogger } from '../lib/logger.js'
import { registerPublicCache } from '../lib/publicCaches.js'
import { findIcon } from './favicon.js'
import { etagOf, type ServedFavicon } from './faviconStore.js'

const log = createLogger('source-favicons')
const CONCURRENCY = 5
const DAY_MS = 24 * 60 * 60 * 1000

/** A lowercase DNS name of two labels or more, each 1-63 letters, digits or inner hyphens, ending in letters: no IP, port or path. */
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Whether `host` is a plain host name the route serves and the fetcher looks up. */
export function isSourceHost(host: string): boolean {
  return HOST_PATTERN.test(host)
}

const cache = new TTLCache<ServedFavicon | null>(config.favicon.memoryCacheMinutes * 60_000, { maxEntries: config.favicon.memoryCacheEntries })
registerPublicCache('source-favicons', cache)

/** The host's stored favicon, or null when none is stored or none was found. */
export function getSourceFavicon(host: string): Promise<ServedFavicon | null> {
  return cached(
    cache,
    host,
    async () => {
      const row = await prisma.sourceFavicon.findUnique({ where: { host }, select: { png: true } })
      if (!row?.png) return null
      const png = Buffer.from(row.png)
      return { png, etag: etagOf(png) }
    },
    favicon => favicon !== null,
  )
}

/** A source whose outlet's favicon the story page shows: its host, and the icon address search gave, if any. */
export interface SourceIconHint {
  host: string
  favicon: string | null
}

async function fetchAndStore(host: string, firstTry: string | null, now: Date): Promise<void> {
  const icon = await findIcon(new URL(`https://${host}`), firstTry ?? undefined)
  const data = { png: icon ? new Uint8Array(icon.png) : null, sourceUrl: icon?.sourceUrl ?? null, fetchedAt: now }
  await prisma.sourceFavicon.upsert({ where: { host }, create: { host, ...data }, update: data })
  cache.invalidate(host)
}

/** Each plain host once, with the first icon address any of its sources has. */
function hintsByHost(sources: SourceIconHint[]): Map<string, string | null> {
  const byHost = new Map<string, string | null>()
  for (const s of sources) {
    if (isSourceHost(s.host) && !byHost.get(s.host)) byHost.set(s.host, s.favicon)
  }
  return byHost
}

/**
 * Fetch the favicons of these sources' hosts, after the caller has answered: every host without a
 * stored PNG whose last look found none longer ago than the negative cache. CONCURRENCY at a time;
 * every failure is logged and the promise never rejects, so callers leave it unawaited.
 */
export async function fetchSourceFaviconsInBackground(sources: SourceIconHint[], now: Date = new Date()): Promise<void> {
  try {
    const byHost = hintsByHost(sources)
    const known = await prisma.sourceFavicon.findMany({ where: { host: { in: [...byHost.keys()] } }, select: { host: true, png: true, fetchedAt: true } })
    const lookedRecently = (fetchedAt: Date) => now.getTime() - fetchedAt.getTime() < config.favicon.sourceNegativeCacheDays * DAY_MS
    const settled = new Set(known.filter(k => k.png !== null || lookedRecently(k.fetchedAt)).map(k => k.host))
    const due = [...byHost].filter(([host]) => !settled.has(host))
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      const batch = due.slice(i, i + CONCURRENCY)
      const outcomes = await Promise.allSettled(batch.map(([host, firstTry]) => fetchAndStore(host, firstTry, now)))
      for (const [j, outcome] of outcomes.entries()) {
        if (outcome.status === 'rejected') log.warn({ host: batch[j]![0], err: outcome.reason }, 'failed to fetch a source favicon')
      }
    }
  } catch (err) {
    log.error({ err }, 'background source favicon fetch failed')
  }
}

/** Test-only: forget every in-memory favicon. */
export function _resetSourceFaviconCache(): void {
  cache.clear()
}
