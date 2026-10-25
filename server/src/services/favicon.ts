import { access, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { Readable } from 'stream'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { isAllowedUrl, ssrfGuard } from '../utils/urlValidation.js'
import * as feedService from './feed.js'

const log = createLogger('favicon')
const FAVICON_DIR = config.crawl.faviconDir
const MAX_FAVICON_BYTES = 100_000
const FETCH_TIMEOUT_MS = 10_000
const CONCURRENCY = 5
// Google's generic globe icon for unknown domains is very small (~300 bytes at 32px).
// Real favicons are almost always larger.
const MAX_HTML_BYTES = 2 * 1024 * 1024 // 2 MB cap for HTML pages when looking for favicon links
const GOOGLE_GLOBE_MAX_BYTES = 400

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true })
}

function faviconPath(feedId: string): string {
  return join(FAVICON_DIR, `${feedId}.png`)
}

async function faviconExists(feedId: string): Promise<boolean> {
  try {
    await access(faviconPath(feedId))
    return true
  } catch {
    return false
  }
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
    headers: accept ? { Accept: accept } : undefined,
    validateStatus: () => true,
    ...ssrfGuard,
  })
  if (res.status < 200 || res.status >= 300) {
    res.data.destroy()
    return null
  }
  return { contentType: String(res.headers['content-type'] ?? ''), body: res.data }
}

/** Read a stream up to maxBytes; with `truncate`, keep the first maxBytes, else give up (null). */
async function readCapped(body: Readable, maxBytes: number, truncate: boolean): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buf.byteLength
    chunks.push(buf)
    if (totalBytes > maxBytes) {
      body.destroy()
      if (!truncate) return null
      break
    }
  }
  return Buffer.concat(chunks)
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

/** Try Google Favicon API. Returns null if response is the generic globe icon. */
async function tryGoogleApi(hostname: string): Promise<Buffer | null> {
  const buffer = await fetchImage(`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`)
  if (!buffer) return null
  // Filter out Google's generic globe icon for unknown domains
  if (buffer.length <= GOOGLE_GLOBE_MAX_BYTES) return null
  return buffer
}

/** Parse HTML for <link rel="icon"> and download the best match. */
async function tryHtmlParsing(origin: string): Promise<Buffer | null> {
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
      const iconUrl = new URL(link.href, origin).href
      const buffer = await fetchImage(iconUrl)
      if (buffer) return buffer
    }

    return null
  } catch {
    return null
  }
}

/** Try fetching /favicon.ico directly from the origin. */
async function tryDirectFavicon(origin: string): Promise<Buffer | null> {
  return fetchImage(`${origin}/favicon.ico`)
}

export interface FaviconResult {
  success: boolean
  message: string
}

export async function fetchFavicon(feedId: string, feedUrl: string, homeUrl?: string | null, force = false): Promise<FaviconResult> {
  if (!UUID_RE.test(feedId)) {
    throw new Error(`Invalid feed ID format: ${feedId}`)
  }

  if (!force && (await faviconExists(feedId))) {
    log.debug({ feedId }, 'favicon already exists, skipping')
    return { success: true, message: 'Already exists' }
  }

  // Prefer homepage URL for favicon (cleaner domain), fall back to RSS URL
  const primaryUrl = homeUrl ? new URL(homeUrl) : new URL(feedUrl)
  const hostname = primaryUrl.hostname

  // Try the feed's hostname, then progressively shorter domains
  // e.g. feeder-prod.int.politico.com → int.politico.com → politico.com
  const domains = [hostname]
  const parts = hostname.split('.')
  for (let i = 1; i <= parts.length - 2; i++) {
    domains.push(parts.slice(i).join('.'))
  }

  let buffer: Buffer | null = null
  for (const domain of domains) {
    const origin = `${primaryUrl.protocol}//${domain}`
    buffer = (await tryGoogleApi(domain)) ?? (await tryHtmlParsing(origin)) ?? (await tryDirectFavicon(origin))
    if (buffer) break
  }

  if (!buffer) {
    log.warn({ feedId, hostname }, 'no favicon found')
    return { success: false, message: `No favicon found for ${hostname}` }
  }

  await ensureDir(FAVICON_DIR)
  await writeFile(faviconPath(feedId), buffer)
  log.info({ feedId, hostname }, 'favicon saved')
  return { success: true, message: 'Favicon saved' }
}

export async function fetchAllFavicons(): Promise<{ succeeded: number; failed: number; skipped: number; errors: string[] }> {
  const feeds = await feedService.getFeeds({ active: true })
  let succeeded = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    const batch = feeds.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async feed => {
        if (await faviconExists(feed.id)) return 'skipped' as const
        const result = await fetchFavicon(feed.id, feed.rssUrl, feed.url)
        return result.success ? ('fetched' as const) : ('not_found' as const)
      }),
    )
    for (const [idx, result] of results.entries()) {
      const feed = batch[idx]!
      if (result.status === 'fulfilled') {
        if (result.value === 'skipped') skipped++
        else if (result.value === 'fetched') succeeded++
        else {
          failed++
          errors.push(`${feed.title}: not found`)
        }
      } else {
        failed++
        errors.push(`${feed.title}: ${result.reason?.message || 'Unknown error'}`)
        log.warn({ feedId: feed.id, err: result.reason }, 'failed to fetch favicon')
      }
    }
  }

  return { succeeded, failed, skipped, errors }
}
