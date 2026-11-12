import type { Feed } from '@prisma/client'
import { parseFeed, type ParseFeedResult, type RSSItem } from './rssParser.js'
import { extractContent, isPageRefusal, type CrawlMethod, type ExtractionMethod, type ExtractionOutcome } from './extractor.js'
import { checkOptOut, optOutMessage, type Reservation } from './publisherOptOut.js'
import { RSS_CRAWL_METHOD, storyFromRssItem } from './rssContent.js'
import type { AccessTier, PaywallPolicy } from '../lib/paywall.js'
import { getExistingUrls, createStory } from './story.js'
import { getFeedById, getDueFeeds, updateCrawlStatus, updateFeedCacheHeaders } from './feed.js'
import { createLogger } from '../lib/logger.js'
import { Semaphore } from '../lib/semaphore.js'
import { config } from '../config.js'
import { normalizeUrl } from '../utils/urlNormalization.js'
import { BadRequestError, ConflictError, NotFoundError, UnprocessableError, isUniqueViolation, summarizeError } from '../utils/errors.js'

const log = createLogger('crawler')

const LOCAL_METHODS: ReadonlySet<ExtractionMethod> = new Set(['selector', 'readability', 'teaser'])

/** The feed fields a crawl reads. */
type CrawledFeed = Pick<Feed, 'id' | 'title' | 'htmlSelector' | 'paywallDetection' | 'paywallTitleMarker'>

/** The text and metadata a story is created with, from an extraction tier or from the RSS item. */
interface StoryDraft {
  title: string
  content: string
  datePublished: string | null
  method: CrawlMethod
  accessTier: AccessTier
}

function paywallPolicy(feed: { paywallDetection: boolean; paywallTitleMarker: string | null }): PaywallPolicy {
  return { detection: feed.paywallDetection, titleMarker: feed.paywallTitleMarker }
}

/** Whether the feed takes its article text from the RSS item rather than the article page. */
function takesTextFromRss(feed: { contentSource: string }): boolean {
  return feed.contentSource === 'rss'
}

export interface CrawlResult {
  feedId: string
  feedTitle: string
  newStories: number
  skipped: number
  errors: number
  errorMessage?: string
}

/**
 * What a crawl tells the feed besides its counts (content-extraction.md, "Publisher opt-out check"):
 * the items it skipped for a publisher's opt-out, with the first reason, and the first refused fetch.
 */
class CrawlNotes {
  /** Items skipped, never stored, for a reservation; looked at again on every crawl while they stay in the feed. */
  optedOut = 0
  private firstOptOut: Reservation | null = null
  private firstRefusal: string | null = null

  constructor(
    private readonly feedTitle: string,
    private readonly result: CrawlResult,
  ) {}

  skipForOptOut(url: string, reservation: Reservation): void {
    log.info({ feed: this.feedTitle, url, reason: reservation.reason }, 'item skipped for the publisher opt-out')
    this.result.skipped++
    this.optedOut++
    this.firstOptOut ??= reservation
  }

  refused(reason: string): void {
    this.firstRefusal ??= reason
  }

  /** The notes the crawl's error carries after "N of M articles failed extraction", which feedProblems.ts reads as a prefix. */
  messages(): string[] {
    const notes: string[] = []
    if (this.firstRefusal) notes.push(this.firstRefusal)
    if (this.firstOptOut) notes.push(`${optOutMessage(this.firstOptOut)} (${this.optedOut} article${this.optedOut === 1 ? '' : 's'} skipped)`)
    return notes
  }
}

export async function crawlFeed(feedId: string): Promise<CrawlResult> {
  const feed = await getFeedById(feedId)
  if (!feed) throw new NotFoundError('Feed not found')

  const result: CrawlResult = {
    feedId,
    feedTitle: feed.title,
    newStories: 0,
    skipped: 0,
    errors: 0,
  }

  // Parse RSS feed with conditional headers. A fetch or parse failure is a crawl
  // error, recorded on the feed, never an empty crawl that would clear the last error.
  let rssResult: ParseFeedResult
  try {
    rssResult = await parseFeed(feed.rssUrl, {
      etag: feed.lastEtag,
      lastModified: feed.lastModified,
    })
  } catch (err) {
    result.errors = 1
    result.errorMessage = `RSS fetch failed: ${summarizeError(err)}`
    await updateCrawlStatus(feedId, {
      hadSuccess: false,
      fetchFailed: true,
      errorMessage: result.errorMessage,
      newItemCount: 0,
      rssItemCount: 0,
      crawlResult: result.errorMessage,
    })
    return result
  }

  // Persist cache headers if returned
  if (rssResult.cacheHeaders.etag || rssResult.cacheHeaders.lastModified) {
    await updateFeedCacheHeaders(feedId, rssResult.cacheHeaders)
  }

  // 304 Not Modified — nothing to do. hadSuccess=false so existing errors are preserved
  // (no errorMessage + !hadSuccess leaves lastCrawlError untouched in updateCrawlStatus)
  if (rssResult.notModified) {
    await updateCrawlStatus(feedId, { hadSuccess: false, newItemCount: 0, rssItemCount: 0, crawlResult: '304 not modified', notModified: true })
    return result
  }

  const rssItems = rssResult.items
  if (rssItems.length === 0) {
    await updateCrawlStatus(feedId, { hadSuccess: true, newItemCount: 0, rssItemCount: 0, crawlResult: 'No items in feed' })
    return result
  }

  // Normalize URLs and deduplicate within the RSS batch
  for (const item of rssItems) {
    item.url = normalizeUrl(item.url)
  }
  const seenUrls = new Set<string>()
  const uniqueItems = rssItems.filter(item => {
    if (seenUrls.has(item.url)) return false
    seenUrls.add(item.url)
    return true
  })

  // Deduplicate against existing stories
  const rssUrls = uniqueItems.map(item => item.url)
  const existingUrls = await getExistingUrls(rssUrls)
  const newItems = uniqueItems.filter(item => !existingUrls.has(item.url))
  result.skipped = rssItems.length - newItems.length // includes RSS duplicates + DB matches

  // Items too short to attempt, or skipped for a publisher's opt-out, are skips, not failures, so they stay out of this count.
  const notes = new CrawlNotes(feed.title, result)
  const totalArticles = takesTextFromRss(feed) ? await storeRssItems(feed, newItems, result, notes) : await extractAndStorePages(feed, newItems, result, notes)

  // An opt-out is the feed's error even beside new stories, so the feed table shows it
  const messages = [...(result.errors > 0 ? [`${result.errors} of ${totalArticles} articles failed extraction`] : []), ...notes.messages()]
  if (messages.length > 0) result.errorMessage = messages.join('; ')

  const crawlResult = result.newStories > 0 ? `${result.newStories} new article${result.newStories > 1 ? 's' : ''}` : (result.errorMessage ?? 'No new articles')

  await updateCrawlStatus(feedId, {
    hadSuccess: result.newStories > 0,
    errorMessage: result.errorMessage,
    newItemCount: totalArticles,
    rssItemCount: rssItems.length,
    crawlResult,
  })
  return result
}

/**
 * Check each item against the publisher's opt-out, fetch its article page, extract its text through
 * the tier chain and store the story. Returns how many items were attempted: all but those skipped
 * for an opt-out.
 *
 * Runs in parallel with a concurrency limit. The fail counters below are shared across concurrent
 * tasks. This is safe because Node.js is single-threaded: mutations happen synchronously between
 * await points, so concurrent tasks never interleave mid-increment. The first concurrent batch
 * (size = crawlArticles) all read the initial values; thresholds take effect for subsequent batches
 * after the first batch completes.
 */
async function extractAndStorePages(feed: CrawledFeed, items: RSSItem[], result: CrawlResult, notes: CrawlNotes): Promise<number> {
  const articleSemaphore = new Semaphore(config.concurrency.crawlArticles)
  let localFailCount = 0
  let totalFailCount = 0
  let skipLocal = false
  let skipAll = false
  // Once the host refuses a page fetch or reserves a page, no extraction API is asked for the rest of
  // this crawl: the API tier makes up for technical failures only, never for a publisher's no.
  let apiBlocked = false

  /** An attempted article that gave no story: toward skip-local (when its page was tried) and skip-all. */
  const countFailure = () => {
    totalFailCount++
    if (!skipLocal) localFailCount++
    if (localFailCount >= config.crawl.localFailThreshold) skipLocal = true
    if (totalFailCount >= config.crawl.totalFailThreshold) {
      skipAll = true
      log.warn({ feed: feed.title, totalFailCount, totalArticles: items.length }, 'all extraction methods failing, skipping remaining articles')
    }
    result.errors++
  }

  await Promise.allSettled(
    items.map(item =>
      articleSemaphore.run(async () => {
        if (skipAll) {
          result.errors++
          return
        }
        let extracted: ExtractionOutcome
        try {
          const verdict = await checkOptOut(item.url, { fetchesPage: true })
          if (verdict.reserved) {
            notes.skipForOptOut(item.url, verdict)
            return
          }
          extracted = await extractContent(item.url, {
            htmlSelector: feed.htmlSelector,
            skipLocalExtraction: skipLocal,
            shouldAbort: () => skipAll,
            skipApiTier: () => apiBlocked,
            paywall: paywallPolicy(feed),
          })
        } catch (err) {
          log.error({ url: item.url, err }, 'failed to process item')
          result.errors++
          return
        }

        if (isPageRefusal(extracted)) {
          apiBlocked = true
          if (extracted.refusal === 'reserved') {
            notes.skipForOptOut(item.url, { reason: extracted.reason, unverified: extracted.unverified ?? false })
          } else {
            log.warn({ url: item.url, reason: extracted.reason }, 'page fetch refused; no extraction API for the rest of this crawl')
            notes.refused(extracted.reason)
            countFailure()
          }
          return
        }

        if (!extracted) {
          log.warn({ url: item.url }, 'no content extracted')
          countFailure()
          return
        }

        totalFailCount = 0
        // A teaser, or any result the HTML classified as locked, counts as local: the page was
        // fetched and parsed, it is only locked. Counting it as a local failure would set skip-local
        // and switch off paywall detection for the rest of the crawl.
        if (LOCAL_METHODS.has(extracted.method) || extracted.accessTier === 'locked') {
          localFailCount = 0
        } else {
          localFailCount++
        }
        if (localFailCount >= config.crawl.localFailThreshold) skipLocal = true

        await saveStory(
          feed,
          item,
          {
            title: extracted.title || item.title,
            content: extracted.content,
            datePublished: extracted.datePublished || item.datePublished,
            method: extracted.method,
            accessTier: extracted.accessTier,
          },
          result,
        )
      }),
    ),
  )
  return items.length - notes.optedOut
}

/**
 * Store each item's own text as its story (`contentSource` 'rss'), in order, fetching no page. An
 * item the publisher reserved, or whose text is shorter than `minContentLength` (a paid post's
 * preview), is a skip, never an error and never a page fetch, which the publisher's terms forbid.
 * Returns how many items were attempted.
 */
async function storeRssItems(feed: CrawledFeed, items: RSSItem[], result: CrawlResult, notes: CrawlNotes): Promise<number> {
  let attempted = 0
  for (const item of items) {
    // No page is fetched, so robots.txt path rules do not apply; TDMRep and Content-Signal reserve the use itself
    const verdict = await checkOptOut(item.url, { fetchesPage: false })
    if (verdict.reserved) {
      notes.skipForOptOut(item.url, verdict)
      continue
    }
    const story = storyFromRssItem(item, paywallPolicy(feed))
    if (!story) {
      log.info({ feed: feed.title, url: item.url }, 'RSS item text below the minimum length (a preview?); skipped, page not fetched')
      result.skipped++
      continue
    }
    attempted++
    await saveStory(feed, item, { ...story, method: RSS_CRAWL_METHOD }, result)
  }
  return attempted
}

/** Create the story and count it: a concurrent crawl's insert of the same URL is a skip, any other failure an error. */
async function saveStory(feed: CrawledFeed, item: RSSItem, draft: StoryDraft, result: CrawlResult): Promise<void> {
  try {
    await createStory({
      sourceUrl: item.url,
      sourceTitle: draft.title,
      sourceContent: draft.content,
      feedId: feed.id,
      sourceDatePublished: draft.datePublished || undefined,
      crawlMethod: draft.method,
      accessTier: draft.accessTier,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      log.info({ url: item.url }, 'story already exists (concurrent insert), skipping')
      result.skipped++
      return
    }
    log.error({ url: item.url, err }, 'failed to process item')
    result.errors++
    return
  }
  if (draft.accessTier === 'locked') {
    log.info({ feed: feed.title, url: item.url, method: draft.method }, 'paywall-locked story stored as rejected')
  }
  result.newStories++
}

export async function crawlAllDueFeeds(): Promise<CrawlResult[]> {
  const dueFeeds = await getDueFeeds()
  log.info({ feedCount: dueFeeds.length }, 'feeds due for crawling')

  const feedSemaphore = new Semaphore(config.concurrency.crawlFeeds)
  const total = dueFeeds.length
  let completed = 0

  const settled = await Promise.allSettled(
    dueFeeds.map(feed =>
      feedSemaphore.run(async () => {
        try {
          const result = await crawlFeed(feed.id)
          completed++
          log.info(
            { progress: `${completed}/${total}`, feed: result.feedTitle, new: result.newStories, skipped: result.skipped, errors: result.errors },
            'feed crawl complete',
          )
          return result
        } catch (err) {
          completed++
          // Not necessarily the RSS fetch (crawlFeed records that itself): any other throw, such as a
          // missing feed or a database error, is a failed crawl and retried like one.
          const errorMessage = `Crawl failed: ${err instanceof Error ? err.message : String(err)}`
          log.error({ feed: feed.title, err }, 'failed to crawl feed')
          await updateCrawlStatus(feed.id, { hadSuccess: false, errorMessage, newItemCount: 0, rssItemCount: 0, fetchFailed: true }).catch(() => {})
          return {
            feedId: feed.id,
            feedTitle: feed.title,
            newStories: 0,
            skipped: 0,
            errors: 1,
            errorMessage,
          }
        }
      }),
    ),
  )

  return settled.map(s =>
    s.status === 'fulfilled'
      ? s.value
      : {
          feedId: '',
          feedTitle: 'unknown',
          newStories: 0,
          skipped: 0,
          errors: 1,
          errorMessage: 'Feed crawl failed unexpectedly',
        },
  )
}

export async function crawlUrl(url: string, feedId: string): Promise<{ storyId: string } | null> {
  const feed = await getFeedById(feedId)
  if (!feed) throw new NotFoundError('Feed not found')
  // Such a feed's publisher forbids fetching its pages; its text exists only in the RSS item.
  if (takesTextFromRss(feed)) throw new BadRequestError("This feed takes article text from its RSS feed; single URLs can't be crawled")

  url = normalizeUrl(url)

  // Check not already crawled
  const existing = await getExistingUrls([url])
  if (existing.has(url)) {
    throw new ConflictError('URL already crawled')
  }

  const verdict = await checkOptOut(url, { fetchesPage: true })
  if (verdict.reserved) throw new BadRequestError(optOutMessage(verdict))

  const extracted = await extractContent(url, {
    htmlSelector: feed.htmlSelector,
    paywall: paywallPolicy(feed),
  })

  if (isPageRefusal(extracted)) {
    if (extracted.refusal === 'reserved') throw new BadRequestError(optOutMessage({ reason: extracted.reason, unverified: extracted.unverified ?? false }))
    throw new UnprocessableError(`Could not extract content from URL: ${extracted.reason}`)
  }
  if (!extracted) return null

  const story = await createStory({
    sourceUrl: url,
    sourceTitle: extracted.title || 'Untitled',
    sourceContent: extracted.content,
    feedId,
    sourceDatePublished: extracted.datePublished || undefined,
    crawlMethod: extracted.method,
    accessTier: extracted.accessTier,
  })

  return { storyId: story.id }
}
