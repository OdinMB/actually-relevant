/**
 * Finds a feed's favicon on the web and stores it (.context/feed-management.md, "Favicons"): for the
 * homepage's host, then each shorter parent domain, the Google favicon API, the page's
 * `<link rel=icon>` entries and `/favicon.ico`. Each image is made into the stored 32 px PNG
 * (faviconImage.ts) and saved in the database (faviconStore.ts). The search itself (`findIcon`)
 * also finds research sources' favicons (sourceFavicons.ts).
 */
import type { Readable } from 'stream'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { createLogger } from '../lib/logger.js'
import { CRAWLER_USER_AGENT } from '../lib/crawlerIdentity.js'
import { readCapped } from '../lib/streamRead.js'
import { isAllowedUrl, ssrfGuard } from '../utils/urlValidation.js'
import { toFaviconPng } from './faviconImage.js'
import { activeFeedsForFavicons, hasFavicon, saveFavicon } from './faviconStore.js'

const log = createLogger('favicon')
const MAX_FAVICON_BYTES = 100_000
const FETCH_TIMEOUT_MS = 10_000
const CONCURRENCY = 5
// Google's generic globe icon for unknown domains is very small (~300 bytes at 32px).
// Real favicons are almost always larger.
const MAX_HTML_BYTES = 2 * 1024 * 1024 // 2 MB cap for HTML pages when looking for favicon links
const GOOGLE_GLOBE_MAX_BYTES = 400

/** What the fetcher needs of a feed: its id, and the addresses whose host it looks under. */
export interface FaviconSource {
  id: string
  rssUrl: string
  url: string | null
}

/** Whether a feed write sets an address the favicon is looked up from, so a stored one may be stale. */
export function setsFaviconSource(changes: object): boolean {
  return 'url' in changes || 'rssUrl' in changes
}

/** A favicon found: the stored PNG, and the image it was made from. */
export interface Icon {
  png: Buffer
  sourceUrl: string
}

/**
 * GET through the SSRF guard (utils/urlValidation.ts: URL check, resolved addresses, every
 * redirect), as a stream so the caller can stop reading at its size cap. Null unless a 2xx.
 */
async function guardedGet(url: string, accept?: string): Promise<{ contentType: string; body: Readable } | null> {
  if (!isAllowedUrl(url)) {
    log.warn({ url }, 'blocked disallowed favicon URL')
    return null
  }
  const res = await axios.get<Readable>(url, {
    responseType: 'stream',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // the whole exchange, body included
    maxRedirects: 5,
    headers: { 'User-Agent': CRAWLER_USER_AGENT, ...(accept ? { Accept: accept } : {}) },
    validateStatus: () => true,
    ...ssrfGuard,
  })
  if (res.status < 200 || res.status >= 300) {
    res.data.destroy()
    return null
  }
  return { contentType: String(res.headers['content-type'] ?? ''), body: res.data }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await guardedGet(url)
    if (!res) return null
    if (!res.contentType.startsWith('image/')) {
      res.body.destroy()
      return null
    }

    // Read body in chunks to avoid allocating huge buffers for unexpected responses
    const buffer = await readCapped(res.body, MAX_FAVICON_BYTES, false)
    if (!buffer || buffer.byteLength === 0) return null
    return buffer
  } catch {
    return null
  }
}

/** Download an image of at least `minBytes` and make it into the stored PNG; null when either fails. */
async function fetchIcon(url: string, minBytes = 1): Promise<Icon | null> {
  const image = await fetchImage(url)
  if (!image || image.byteLength < minBytes) return null
  const png = await toFaviconPng(image)
  return png ? { png, sourceUrl: url } : null
}

/** Try Google Favicon API, passing over its generic globe icon. */
function tryGoogleApi(hostname: string): Promise<Icon | null> {
  return fetchIcon(`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`, GOOGLE_GLOBE_MAX_BYTES + 1)
}

/** Parse HTML for <link rel="icon"> and download the best match. */
async function tryHtmlParsing(origin: string): Promise<Icon | null> {
  try {
    const res = await guardedGet(origin, 'text/html')
    if (!res) return null

    // Read body in chunks to cap memory usage — we only need the <head> for favicon links
    const page = await readCapped(res.body, MAX_HTML_BYTES, true)
    if (!page) return null
    const $ = cheerio.load(page.toString('utf8'))

    // Collect all icon link tags, prefer larger sizes
    const iconLinks: { href: string; size: number }[] = []
    $('link[rel*="icon"]').each((_, el) => {
      const href = $(el).attr('href')
      if (!href) return
      const sizes = $(el).attr('sizes') || ''
      const match = sizes.match(/(\d+)x\d+/)
      const size = match ? parseInt(match[1]!) : 0
      iconLinks.push({ href, size })
    })

    // Sort: prefer sizes closest to 32, then largest
    iconLinks.sort((a, b) => {
      const distA = a.size ? Math.abs(a.size - 32) : 999
      const distB = b.size ? Math.abs(b.size - 32) : 999
      return distA - distB
    })

    for (const link of iconLinks) {
      const icon = await fetchIcon(new URL(link.href, origin).href)
      if (icon) return icon
    }

    return null
  } catch {
    return null
  }
}

/** Try fetching /favicon.ico directly from the origin. */
function tryDirectFavicon(origin: string): Promise<Icon | null> {
  return fetchIcon(`${origin}/favicon.ico`)
}

export interface FaviconResult {
  success: boolean
  message: string
}

/**
 * Search for the favicon of `primaryUrl`'s site: `firstTry` first when given (an icon address
 * someone already knows, such as Tavily's), then for the host and each shorter parent domain the
 * Google favicon API, the page's `<link rel=icon>` and `/favicon.ico`. Every fetch goes through the
 * SSRF guard. Null when none yields an image that makes a PNG.
 */
export async function findIcon(primaryUrl: URL, firstTry?: string): Promise<Icon | null> {
  if (firstTry) {
    const icon = await fetchIcon(firstTry)
    if (icon) return icon
  }

  // Try the hostname, then progressively shorter domains
  // e.g. feeder-prod.int.politico.com → int.politico.com → politico.com
  const hostname = primaryUrl.hostname
  const domains = [hostname]
  const parts = hostname.split('.')
  for (let i = 1; i <= parts.length - 2; i++) {
    domains.push(parts.slice(i).join('.'))
  }

  for (const domain of domains) {
    const origin = `${primaryUrl.protocol}//${domain}`
    const icon = (await tryGoogleApi(domain)) ?? (await tryHtmlParsing(origin)) ?? (await tryDirectFavicon(origin))
    if (icon) return icon
  }
  return null
}

/** Find and store the feed's favicon; without `force`, a feed that has one is left alone. */
export async function fetchFavicon(feed: FaviconSource, force = false): Promise<FaviconResult> {
  if (!force && (await hasFavicon(feed.id))) {
    log.debug({ feedId: feed.id }, 'favicon already exists, skipping')
    return { success: true, message: 'Already exists' }
  }

  // Prefer homepage URL for favicon (cleaner domain), fall back to RSS URL
  const primaryUrl = new URL(feed.url || feed.rssUrl)
  const hostname = primaryUrl.hostname
  const icon = await findIcon(primaryUrl)

  if (!icon) {
    log.warn({ feedId: feed.id, hostname }, 'no favicon found')
    return { success: false, message: `No favicon found for ${hostname}` }
  }

  await saveFavicon(feed.id, icon.png, icon.sourceUrl)
  log.info({ feedId: feed.id, hostname, sourceUrl: icon.sourceUrl }, 'favicon saved')
  return { success: true, message: 'Favicon saved' }
}

/** Fetch each feed's favicon, CONCURRENCY at a time; one settled outcome per feed, in order. */
async function fetchEach(feeds: FaviconSource[], force: boolean): Promise<PromiseSettledResult<FaviconResult>[]> {
  const outcomes: PromiseSettledResult<FaviconResult>[] = []
  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    outcomes.push(...(await Promise.allSettled(feeds.slice(i, i + CONCURRENCY).map(feed => fetchFavicon(feed, force)))))
  }
  return outcomes
}

/** Fill in the favicon of every active feed that has none stored ("Fetch All Favicons"). */
export async function fetchAllFavicons(): Promise<{ succeeded: number; failed: number; skipped: number; errors: string[] }> {
  const feeds = await activeFeedsForFavicons()
  const missing = feeds.filter(feed => !feed.hasFavicon)
  const outcomes = await fetchEach(missing, true)

  let succeeded = 0
  const errors: string[] = []
  for (const [i, outcome] of outcomes.entries()) {
    const feed = missing[i]!
    if (outcome.status === 'fulfilled' && outcome.value.success) succeeded++
    else if (outcome.status === 'fulfilled') errors.push(`${feed.title}: not found`)
    else {
      errors.push(`${feed.title}: ${outcome.reason?.message || 'Unknown error'}`)
      log.warn({ feedId: feed.id, err: outcome.reason }, 'failed to fetch favicon')
    }
  }

  return { succeeded, failed: errors.length, skipped: feeds.length - missing.length, errors }
}

/**
 * Refetch these feeds' favicons after the caller has answered: a feed just created, or one whose
 * address changed (after the write has committed, so the feed row exists for the favicon's key).
 * CONCURRENCY at a time; every failure is logged, and the promise never rejects, so callers leave it
 * unawaited.
 */
export async function fetchFaviconsInBackground(feeds: FaviconSource[]): Promise<void> {
  try {
    const outcomes = await fetchEach(feeds, true)
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') log.warn({ feedId: feeds[i]!.id, err: outcome.reason }, 'failed to fetch favicon')
    }
  } catch (err) {
    log.error({ err }, 'background favicon fetch failed')
  }
}
