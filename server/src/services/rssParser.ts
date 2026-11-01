import Parser from 'rss-parser'
import axios from 'axios'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { withRetry } from '../lib/retry.js'
import { normalizeUrl } from '../utils/urlNormalization.js'
import { summarizeError } from '../utils/errors.js'
import { crawlLimiter } from '../lib/crawlLimiter.js'
import { BlockedUrlError, isAllowedUrl, ssrfGuard } from '../utils/urlValidation.js'

const log = createLogger('rssParser')

/** rss-parser copies an item's content:encoded under this key; its own typings leave it out. */
interface ParsedItemExtras {
  'content:encoded'?: string
}

const parser = new Parser<Record<string, unknown>, ParsedItemExtras>()

export interface RSSItem {
  url: string
  title: string
  datePublished: string | null
  description: string | null
  /**
   * The item's own HTML: content:encoded (where publishers such as Substack put the full article),
   * else the description or Atom content. Feeds whose contentSource is 'rss' take the story text
   * from it (rssContent.ts); for the others it is unused.
   */
  contentHtml: string | null
}

/** A non-empty string, else null: xml2js can hand back an object for unusual markup inside an element. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export interface FeedCacheHeaders {
  etag?: string | null
  lastModified?: string | null
}

export interface ParseFeedResult {
  items: RSSItem[]
  notModified: boolean
  cacheHeaders: FeedCacheHeaders
}

/**
 * Fetch and parse an RSS feed. Throws when the feed cannot be fetched (after
 * retries) or parsed, so the caller can record it as a crawl error rather than
 * mistaking an unreachable feed for an empty one.
 */
export async function parseFeed(feedUrl: string, cacheHeaders?: FeedCacheHeaders): Promise<ParseFeedResult> {
  try {
    if (!isAllowedUrl(feedUrl)) throw new BlockedUrlError(`Blocked feed URL: ${feedUrl}`)
    const headers: Record<string, string> = {}
    if (cacheHeaders?.etag) {
      headers['If-None-Match'] = cacheHeaders.etag
    }
    if (cacheHeaders?.lastModified) {
      headers['If-Modified-Since'] = cacheHeaders.lastModified
    }

    const response = await crawlLimiter.run(feedUrl, () =>
      withRetry(() =>
        axios.get(feedUrl, {
          timeout: config.crawl.httpTimeoutMs,
          maxRedirects: 3,
          headers,
          responseType: 'text',
          maxContentLength: 5 * 1024 * 1024, // 5 MB cap to prevent OOM on huge responses
          validateStatus: status => status === 200 || status === 304,
          ...ssrfGuard, // resolved addresses and every redirect checked (utils/urlValidation.ts)
        }),
      ),
    )

    if (response.status === 304) {
      log.debug({ feedUrl }, 'feed not modified (304)')
      return {
        items: [],
        notModified: true,
        cacheHeaders: {
          etag: cacheHeaders?.etag || null,
          lastModified: cacheHeaders?.lastModified || null,
        },
      }
    }

    const feed = await parser.parseString(response.data)
    const items: RSSItem[] = []

    for (const item of feed.items.slice(0, config.crawl.rssItemLimit)) {
      const url = item.link
      if (!url) continue

      items.push({
        url: normalizeUrl(url),
        title: item.title || 'Untitled',
        datePublished: item.isoDate || item.pubDate || null,
        description: item.contentSnippet || item.content || null,
        contentHtml: textOrNull(item['content:encoded']) ?? textOrNull(item.content),
      })
    }

    return {
      items,
      notModified: false,
      cacheHeaders: {
        etag: response.headers['etag'] || null,
        lastModified: response.headers['last-modified'] || null,
      },
    }
  } catch (err) {
    log.error({ feedUrl, reason: summarizeError(err) }, 'failed to fetch or parse feed')
    throw err
  }
}
