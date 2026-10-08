import axios from 'axios'
import * as cheerio from 'cheerio'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { isAllowedUrl } from '../utils/urlValidation.js'
import { summarizeError } from '../utils/errors.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { withRetry, isRetryableError } from '../lib/retry.js'
import { crawlLimiter } from '../lib/crawlLimiter.js'
import { classifyAccess, DEFAULT_PAYWALL_POLICY, type AccessTier, type PaywallPolicy } from '../lib/paywall.js'

const log = createLogger('extractor')
const USER_AGENT = 'ActuallyRelevant/1.0 (news curation bot; +https://actuallyrelevant.news)'

function isQuotaError(err: unknown): boolean {
  if (err instanceof Error && 'isAxiosError' in err) {
    const status = (err as { response?: { status?: number } }).response?.status
    return status === 429
  }
  return false
}

class ThrottleAbortError extends Error {
  constructor() { super('Throttle aborted') }
}

export type ExtractionMethod = 'selector' | 'readability' | 'diffbot' | 'pipfeed' | 'teaser'

export interface ExtractionResult {
  title: string | null
  content: string
  datePublished: string | null
  /** `teaser`: every tier failed on a page classified as locked; content is the page description. */
  method: ExtractionMethod
  accessTier: AccessTier
}

/** What a single extraction tier produces, before access classification. */
type TierResult = Omit<ExtractionResult, 'accessTier' | 'method'> & { method: Exclude<ExtractionMethod, 'teaser'> }

/**
 * Shared throttle for API extraction services. On 429, waits a backoff period
 * before the next call and doubles the inter-call delay. Subsequent successful
 * calls gradually restore the original pace.
 */
export class ApiThrottle {
  private delayMs: number
  private backoffUntil = 0
  private busy = false
  private queue: (() => void)[] = []

  constructor(
    private readonly baseDelayMs: number,
    private readonly backoffMs: number = 30_000,
    private readonly maxDelayMs: number = 30_000,
  ) {
    this.delayMs = baseDelayMs
  }

  async run<T>(fn: () => Promise<T>, shouldAbort?: () => boolean): Promise<T> {
    // Serialize: only one API call at a time to enforce inter-call delay
    if (this.busy) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.busy = true

    try {
      // Bail out if the caller signalled abort (e.g. feed skip-all)
      if (shouldAbort?.()) throw new ThrottleAbortError()

      // Wait out any active backoff
      const now = Date.now()
      if (now < this.backoffUntil) {
        const waitMs = this.backoffUntil - now
        log.info({ waitMs, delayMs: this.delayMs }, 'API throttle: waiting after 429')
        await new Promise(resolve => setTimeout(resolve, waitMs))
      }

      // Re-check after potentially long backoff wait
      if (shouldAbort?.()) throw new ThrottleAbortError()

      // Enforce inter-call delay
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }

      const result = await fn()

      // Success: gradually reduce delay back toward base
      if (this.delayMs > this.baseDelayMs) {
        this.delayMs = Math.max(this.baseDelayMs, Math.floor(this.delayMs / 2))
        log.info({ delayMs: this.delayMs }, 'API throttle: reducing delay after success')
      }

      return result
    } finally {
      this.busy = false
      const next = this.queue.shift()
      if (next) next()
    }
  }

  /** Called when a 429 is received. Increases delay and sets a backoff period. */
  onRateLimited(): void {
    this.delayMs = Math.min(this.delayMs * 2 || this.backoffMs, this.maxDelayMs)
    this.backoffUntil = Date.now() + this.backoffMs
    log.warn({ delayMs: this.delayMs, backoffMs: this.backoffMs }, 'API throttle: 429 received, increasing delay')
  }

  reset(): void {
    this.delayMs = this.baseDelayMs
    this.backoffUntil = 0
    this.busy = false
    this.queue = []
  }
}

const apiThrottle = new ApiThrottle(
  config.crawl.minDelayPerDomainMs, // base delay same as crawl limiter
  30_000,  // 30s backoff after 429
  30_000,  // max 30s between calls
)

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await crawlLimiter.run(url, () =>
      withRetry(() => axios.get(url, {
        timeout: config.crawl.httpTimeoutMs,
        headers: { 'User-Agent': USER_AGENT },
        maxRedirects: 5,
        responseType: 'text',
        maxContentLength: 5 * 1024 * 1024, // 5 MB cap to prevent OOM on huge pages
        beforeRedirect: (options: Record<string, any>) => {
          const redirectUrl = typeof options.href === 'string' ? options.href
            : `${options.protocol}//${options.hostname}${options.path}`
          if (!isAllowedUrl(redirectUrl)) {
            throw new Error(`Blocked redirect to disallowed URL: ${redirectUrl}`)
          }
        },
      }))
    )
    return response.data
  } catch (err) {
    log.warn({ url, reason: summarizeError(err) }, 'page fetch failed')
    return null
  }
}

function extractBySelector(html: string, selector: string): TierResult | null {
  try {
    const $ = cheerio.load(html)
    const container = $(selector).first()
    if (!container.length) return null

    const text = container.text().replace(/\s+/g, ' ').trim()
    if (!text || text.length < config.crawl.minContentLength) return null

    return {
      title: $('title').text().trim() || null,
      content: text,
      datePublished: null,
      method: 'selector',
    }
  } catch (err) {
    log.warn({ reason: summarizeError(err) }, 'selector extraction failed')
    return null
  }
}

function extractByReadability(html: string, url: string): TierResult | null {
  let dom: InstanceType<typeof JSDOM> | null = null
  try {
    dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    if (!article || !article.textContent || article.textContent.trim().length < config.crawl.minContentLength) return null

    return {
      title: article.title || null,
      content: article.textContent.trim(),
      datePublished: null,
      method: 'readability',
    }
  } catch (err) {
    log.warn({ reason: summarizeError(err) }, 'readability extraction failed')
    return null
  } finally {
    dom?.window.close()
  }
}

async function extractByDiffbot(url: string): Promise<TierResult | null> {
  const token = process.env.DIFFBOT_TOKEN
  if (!token) return null

  log.info({ url }, 'attempting Diffbot extraction')

  const response = await crawlLimiter.run('https://api.diffbot.com/v3/article', () =>
    withRetry(() => axios.get(
      'https://api.diffbot.com/v3/article',
      {
        timeout: config.crawl.diffbotTimeoutMs,
        maxContentLength: 5 * 1024 * 1024,
        params: {
          token,
          url,
          discussion: false,
          paging: false,
        },
      }
    ), {
      retryOn: (err) => {
        if (isQuotaError(err)) return false
        return isRetryableError(err)
      },
    })
  )

  const article = response.data?.objects?.[0]
  if (!article?.text || article.text.length < config.crawl.minContentLength) {
    log.warn({ url, contentLength: article?.text?.length ?? 0 }, 'Diffbot returned insufficient content')
    return null
  }

  log.info({ url, contentLength: article.text.length }, 'Diffbot extraction succeeded')
  return {
    title: article.title || null,
    content: article.text,
    datePublished: article.date || article.estimatedDate || null,
    method: 'diffbot',
  }
}

async function extractByPipfeed(url: string): Promise<TierResult | null> {
  const apiKey = process.env.PIPFEED_API_KEY
  if (!apiKey) return null

  log.info({ url }, 'attempting PipFeed extraction')

  const response = await withRetry(() => axios.post(
    'https://news-article-data-extract-and-summarization1.p.rapidapi.com/extract/',
    { url },
    {
      timeout: config.crawl.pipfeedTimeoutMs,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'news-article-data-extract-and-summarization1.p.rapidapi.com',
      },
    }
  ), {
    retryOn: (err) => {
      if (isQuotaError(err)) return false
      return isRetryableError(err)
    },
  })

  const data = response.data
  if (!data?.text || data.text.length < config.crawl.minContentLength) {
    log.warn({ url, contentLength: data?.text?.length ?? 0 }, 'PipFeed returned insufficient content')
    return null
  }

  log.info({ url, contentLength: data.text.length }, 'PipFeed extraction succeeded')
  return {
    title: data.title || null,
    content: data.text,
    datePublished: data.date || null,
    method: 'pipfeed',
  }
}

/**
 * Calls the configured extraction API with shared throttle.
 * On 429: registers backoff, waits, then lets subsequent calls proceed at reduced pace.
 */
async function extractByApi(url: string, api: 'diffbot' | 'pipfeed', shouldAbort?: () => boolean): Promise<TierResult | null> {
  if (shouldAbort?.()) {
    log.info({ url, api }, 'extraction skipped (feed bail-out)')
    return null
  }
  const fn = api === 'diffbot' ? extractByDiffbot : extractByPipfeed
  try {
    return await apiThrottle.run(() => fn(url), shouldAbort)
  } catch (err) {
    if (err instanceof ThrottleAbortError) {
      log.info({ url, api }, 'extraction aborted during throttle wait (feed bail-out)')
      return null
    }
    if (isQuotaError(err)) {
      apiThrottle.onRateLimited()
      log.warn({ url, api, reason: summarizeError(err) }, 'API rate limited (429)')
      return null
    }
    log.warn({ url, api, reason: summarizeError(err) }, 'API extraction failed')
    return null
  }
}

/**
 * Fetch the page for the local tiers. Returns null when there is nothing to parse locally: the
 * fetch failed, or the page is above maxParseBytes. Building a JSDOM/cheerio DOM from a
 * multi-megabyte string expands ~10-20x and spikes native memory (counted against Render's RSS
 * limit), which can OOM the crawl; such pages are deferred to the API tier, which extracts
 * server-side without loading the DOM into our heap.
 */
async function fetchParseablePage(url: string): Promise<string | null> {
  const html = await fetchPage(url)
  if (html == null) return null
  const htmlBytes = Buffer.byteLength(html, 'utf8')
  if (htmlBytes > config.crawl.maxParseBytes) {
    log.warn({ url, htmlBytes, maxParseBytes: config.crawl.maxParseBytes }, 'page exceeds maxParseBytes; skipping local parse, deferring to API tier')
    return null
  }
  return html
}

export async function extractContent(
  url: string,
  options?: {
    htmlSelector?: string | null
    skipLocalExtraction?: boolean
    shouldAbort?: () => boolean
    /** The feed's paywall setting (ADR-0032); defaults to detection on, no title marker. */
    paywall?: PaywallPolicy
  }
): Promise<ExtractionResult | null> {
  if (!isAllowedUrl(url)) {
    log.warn({ url }, 'blocked disallowed URL')
    return null
  }

  const policy = options?.paywall ?? DEFAULT_PAYWALL_POLICY
  const html = options?.skipLocalExtraction ? null : await fetchParseablePage(url)
  const classified = (result: TierResult): ExtractionResult => {
    const { accessTier } = classifyAccess({ html, extractedText: result.content, title: result.title, policy })
    log.info({ url, method: result.method, contentLength: result.content.length, accessTier }, 'extraction succeeded')
    return { ...result, accessTier }
  }

  if (html) {
    // Tier 1: CSS selector extraction
    const selectorResult = options?.htmlSelector ? extractBySelector(html, options.htmlSelector) : null
    if (selectorResult) return classified(selectorResult)

    // Tier 2: Readability extraction
    const readabilityResult = extractByReadability(html, url)
    if (readabilityResult) return classified(readabilityResult)
  }

  // Bail out before expensive API call if the feed has already triggered skip-all
  if (options?.shouldAbort?.()) {
    log.info({ url }, 'extraction skipped before API tier (feed bail-out)')
    return null
  }

  // Tier 3: External API extraction
  const apiResult = await extractByApi(url, config.crawl.extractionApi, options?.shouldAbort)
  if (apiResult) return classified(apiResult)
  if (options?.shouldAbort?.()) return null

  // Every tier failed. A locked page is still stored, as a teaser, rather than returned as null:
  // null counts toward the crawler's skip-local/skip-all thresholds and is retried on every crawl.
  const teaser = html ? teaserResult(html, policy) : null
  if (teaser) {
    log.info({ url, contentLength: teaser.content.length }, 'all extraction methods failed on a locked page; storing the teaser')
    return teaser
  }

  log.warn({ url }, 'all extraction methods failed')
  return null
}

function teaserResult(html: string, policy: PaywallPolicy): ExtractionResult | null {
  const { accessTier, pageTitle, description } = classifyAccess({ html, extractedText: '', title: null, policy })
  if (accessTier !== 'locked') return null
  return { title: pageTitle, content: description ?? '', datePublished: null, method: 'teaser', accessTier }
}

// Exported for testing only
export function _resetApiState(): void {
  apiThrottle.reset()
}
