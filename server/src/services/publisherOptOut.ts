/**
 * The publisher opt-out check (.context/content-extraction.md, "Publisher opt-out check"): whether a
 * publisher has reserved an article against our use in machine-readable form, as the source policy
 * honors (.context/feed-management.md, "Source Policy"). It works from the article URL alone, so any
 * caller can use it, feeds or not. Each origin's robots.txt and /.well-known/tdmrep.json are read
 * once and kept in memory; the page-level TDMRep markers are read where the page is fetched
 * (extractor.ts).
 */
import type { Readable } from 'stream'
import axios from 'axios'
import { config } from '../config.js'
import { TTLCache } from '../lib/cache.js'
import { createLogger } from '../lib/logger.js'
import { withRetry } from '../lib/retry.js'
import { crawlLimiter } from '../lib/crawlLimiter.js'
import { readCapped } from '../lib/streamRead.js'
import { CRAWLER_PRODUCT_TOKEN, CRAWLER_USER_AGENT } from '../lib/crawlerIdentity.js'
import { isPathAllowed, parseRobotsTxt, type RobotsPolicy } from '../lib/robotsTxt.js'
import { isTdmReserved, parseTdmRep, type TdmRule } from '../lib/tdmRep.js'
import { BlockedUrlError, isAllowedUrl, ssrfGuard } from '../utils/urlValidation.js'
import { summarizeError } from '../utils/errors.js'
import type { SourcePolicy } from './researchFilter.js'

const log = createLogger('publisherOptOut')

/** A publisher's reservation of an article, or our failure to learn whether it made one. */
export interface Reservation {
  reason: string
  /** robots.txt could not be read: treated as disallowing until a later check (RFC 9309, "unreachable"). */
  unverified: boolean
}

export type OptOutVerdict = { reserved: false } | ({ reserved: true } & Reservation)

/** How the caller uses the article: robots.txt path rules apply only when it fetches the page. */
export interface ArticleUse {
  fetchesPage: boolean
}

/** What a host's two files say, as read at `readAt`. */
interface HostSignals {
  robots: RobotsPolicy | { unreachable: string }
  tdm: TdmRule[]
  /** A file could not be read (5xx, timeout, network): ask again after `retryMinutes`, not the full lifetime. */
  incomplete: boolean
  readAt: number
}

const cache = new TTLCache<HostSignals>(config.publisherOptOut.cacheHours * 3_600_000, { maxEntries: config.publisherOptOut.cacheEntries })

/** A 5xx answer, thrown so `withRetry` retries it (it reads `status`). */
class ServerErrorStatus extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

/** What axios rejects with once follow-redirects has followed `maxRedirects` redirects. */
function isTooManyRedirects(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'ERR_FR_TOO_MANY_REDIRECTS'
}

/**
 * GET a small file of the host: the first `maxFileBytes` of a 2xx body, '' for any other answer and
 * for a file behind more than 5 redirects (RFC 9309 §2.3.1.2 lets a crawler take it as unavailable,
 * as a 4xx is). Throws on a 5xx, a timeout, a network error or a URL the SSRF guard refuses.
 */
async function fetchSmallFile(url: string): Promise<string> {
  if (!isAllowedUrl(url)) throw new BlockedUrlError(`Blocked URL: ${url}`)
  return crawlLimiter.run(url, () =>
    withRetry(async () => {
      const res = await axios
        .get<Readable>(url, {
          responseType: 'stream',
          signal: AbortSignal.timeout(config.publisherOptOut.fetchTimeoutMs), // the whole exchange, body included
          maxRedirects: 5,
          headers: { 'User-Agent': CRAWLER_USER_AGENT },
          validateStatus: () => true,
          ...ssrfGuard, // resolved addresses and every redirect checked (utils/urlValidation.ts)
        })
        .catch((err: unknown) => {
          if (isTooManyRedirects(err)) return null
          throw err
        })
      if (res === null) return ''
      if (res.status < 200 || res.status >= 300) {
        res.data.destroy()
        if (res.status >= 500) throw new ServerErrorStatus(res.status)
        return ''
      }
      const body = await readCapped(res.data, config.publisherOptOut.maxFileBytes, true)
      return body?.toString('utf8') ?? ''
    }),
  )
}

async function readHostSignals(origin: string): Promise<HostSignals> {
  const [robots, tdm] = await Promise.all([
    // Any 4xx reads as '' and so allows everything (RFC 9309, "unavailable")
    fetchSmallFile(`${origin}/robots.txt`).then(
      text => parseRobotsTxt(text, CRAWLER_PRODUCT_TOKEN),
      (err: unknown) => ({ unreachable: summarizeError(err) }),
    ),
    fetchSmallFile(`${origin}/.well-known/tdmrep.json`).then(
      text => parseTdmRep(text),
      (err: unknown) => {
        log.info({ origin, reason: summarizeError(err) }, 'tdmrep.json could not be read; no reservation assumed')
        return null
      },
    ),
  ])
  if ('unreachable' in robots) log.warn({ origin, reason: robots.unreachable }, 'robots.txt unreachable; its articles are skipped until it is read')
  return { robots, tdm: tdm ?? [], incomplete: 'unreachable' in robots || tdm === null, readAt: Date.now() }
}

function hostSignals(origin: string): Promise<HostSignals> {
  const hit = cache.get(origin)
  if (hit?.incomplete && Date.now() - hit.readAt > config.publisherOptOut.retryMinutes * 60_000) cache.invalidate(origin)
  return cache.load(origin, () => readHostSignals(origin))
}

function reserved(reason: string, unverified = false): OptOutVerdict {
  return { reserved: true, reason, unverified }
}

/**
 * Whether the publisher reserved this article against our use: robots.txt disallowing its path for
 * us (only when we fetch the page), Content-Signal `ai-input=no`, or a reserving tdmrep.json rule.
 * An unreadable robots.txt counts as a reservation, unverified. Never throws.
 */
export async function checkOptOut(url: string, use: ArticleUse): Promise<OptOutVerdict> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return reserved('not a valid URL', true)
  }
  const signals = await hostSignals(parsed.origin)
  const path = parsed.pathname + parsed.search
  const { robots } = signals

  if ('unreachable' in robots) return reserved(`robots.txt unreachable (${robots.unreachable})`, true)
  if (use.fetchesPage && !isPathAllowed(robots.rules, path)) {
    return reserved(robots.group === 'own' ? `robots.txt disallows ${CRAWLER_PRODUCT_TOKEN}` : 'robots.txt disallows all crawlers')
  }
  if (robots.aiInputDenied) return reserved('Content-Signal ai-input=no')
  if (isTdmReserved(signals.tdm, path)) return reserved('TDMRep reservation (/.well-known/tdmrep.json)')
  return { reserved: false }
}

/**
 * Story research's source policy (ADR-0056, `story-research.md`): a source is dropped on any
 * reservation, robots.txt path rules included, since Tavily reads the page on our behalf; an
 * unreadable robots.txt drops it too.
 */
export const researchSourcePolicy: SourcePolicy = {
  optedOut: async url => (await checkOptOut(url, { fetchesPage: true })).reserved,
}

/** The reservation as the admin reads it, on the feed and in a refused single-URL crawl. */
export function optOutMessage(reservation: Reservation): string {
  return `${reservation.unverified ? 'Publisher opt-out unknown' : 'Publisher opted out'}: ${reservation.reason}`
}

// Exported for testing only
export function _resetOptOutCache(): void {
  cache.clear()
}
