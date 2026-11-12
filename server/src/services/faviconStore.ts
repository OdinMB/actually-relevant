/**
 * Feed favicons in the database (`feed_favicons`, .context/feed-management.md, "Favicons"): one 32 px
 * PNG per feed, written by the fetcher (favicon.ts) and read by GET /api/feeds/:id/favicon. Stored
 * favicons are kept in memory for the public route; a save drops the feed's copy, so the next request
 * reads the new one. A missing favicon is not remembered.
 */
import { createHash } from 'crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { TTLCache, cached } from '../lib/cache.js'
import { registerPublicCache } from '../lib/publicCaches.js'

export interface ServedFavicon {
  png: Buffer
  /** Strong ETag of the bytes, quoted */
  etag: string
}

const cache = new TTLCache<ServedFavicon | null>(config.favicon.memoryCacheMinutes * 60_000, { maxEntries: config.favicon.memoryCacheEntries })
registerPublicCache('feed-favicons', cache)

/** Strong ETag of a favicon's bytes, quoted (also used for research sources' favicons, sourceFavicons.ts). */
export const etagOf = (png: Buffer) => `"${createHash('sha256').update(png).digest('base64url').slice(0, 27)}"`

/** The feed's stored favicon, or null when it has none. */
export function getFavicon(feedId: string): Promise<ServedFavicon | null> {
  return cached(
    cache,
    feedId,
    async () => {
      const row = await prisma.feedFavicon.findUnique({ where: { feedId }, select: { png: true } })
      if (!row) return null
      const png = Buffer.from(row.png)
      return { png, etag: etagOf(png) }
    },
    favicon => favicon !== null,
  )
}

export async function hasFavicon(feedId: string): Promise<boolean> {
  return (await prisma.feedFavicon.findUnique({ where: { feedId }, select: { feedId: true } })) !== null
}

/** Store the feed's favicon, replacing any earlier one. `sourceUrl` is the image it was made from. */
export async function saveFavicon(feedId: string, png: Buffer, sourceUrl: string): Promise<void> {
  const bytes = new Uint8Array(png) // Prisma's Bytes type: a Uint8Array over a plain ArrayBuffer
  await prisma.feedFavicon.upsert({
    where: { feedId },
    create: { feedId, png: bytes, sourceUrl },
    update: { png: bytes, sourceUrl, fetchedAt: new Date() },
  })
  cache.invalidate(feedId)
}

/** Every active feed, with what the fetcher needs and whether a favicon is stored for it. */
export async function activeFeedsForFavicons() {
  const feeds = await prisma.feed.findMany({
    where: { active: true },
    select: { id: true, title: true, rssUrl: true, url: true, favicon: { select: { feedId: true } } },
    orderBy: { title: 'asc' },
  })
  return feeds.map(({ favicon, ...feed }) => ({ ...feed, hasFavicon: favicon !== null }))
}

/** Test-only: forget every in-memory favicon. */
export function _resetFaviconCache(): void {
  cache.clear()
}
