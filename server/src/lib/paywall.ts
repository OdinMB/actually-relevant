/**
 * Access classification: turns a publisher's access markup and a feed's paywall setting into an
 * access tier for a crawled story (ADR-0030, ADR-0032; `.context/content-extraction.md`).
 *
 * - `free`: the publisher marks the article free.
 * - `metered`: marked not free, but we got what looks like the full text.
 * - `locked`: marked not free and the text is truncated, or the feed's title marker matched.
 * - `unknown`: no access markup, or no HTML to read it from.
 */
import * as cheerio from 'cheerio'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('paywall')

export type AccessTier = 'free' | 'metered' | 'locked' | 'unknown'

export interface PaywallPolicy {
  /** Whether the markup rule may produce `locked`; off, what would be locked is `metered`. */
  detection: boolean
  /** A regex tested on the article's title; a match forces `locked`. */
  titleMarker: string | null
}

export const DEFAULT_PAYWALL_POLICY: PaywallPolicy = { detection: true, titleMarker: null }

export interface AccessClassification {
  accessTier: AccessTier
  /** og:title, falling back to the document's <title>; null without HTML. */
  pageTitle: string | null
  /** og:description, falling back to the meta description; null without HTML. */
  description: string | null
}

interface AccessMarkup {
  /** The normalized isAccessibleForFree flag: false when any node says false. */
  accessibleForFree: boolean | null
  contentTier: string | null
  wordCount: number | null
  ogTitle: string | null
  pageTitle: string | null
  description: string | null
}

function normalizeFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return null
}

function normalizeCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Visits every JSON-LD node: top-level arrays, `@graph` and `hasPart`. */
function collectNodes(value: unknown, into: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, into)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  into.push(node)
  collectNodes(node['@graph'], into)
  collectNodes(node.hasPart, into)
}

function readMarkup(html: string): AccessMarkup {
  const $ = cheerio.load(html)
  const nodes: Record<string, unknown>[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectNodes(JSON.parse($(el).text()), nodes)
    } catch {
      // A malformed block says nothing; the others may still carry the flag.
    }
  })

  const flags = nodes.map(n => normalizeFlag(n.isAccessibleForFree)).filter((f): f is boolean => f !== null)
  const counts = nodes.map(n => normalizeCount(n.wordCount)).filter((c): c is number => c !== null)
  const meta = (selector: string) => $(selector).attr('content')?.trim() || null
  const ogTitle = meta('meta[property="og:title"]')

  return {
    accessibleForFree: flags.length === 0 ? null : !flags.includes(false),
    contentTier: meta('meta[property="article:content_tier"]')?.toLowerCase() ?? null,
    wordCount: counts.length ? Math.max(...counts) : null,
    ogTitle,
    pageTitle: ogTitle ?? ($('title').first().text().trim() || null),
    description: meta('meta[property="og:description"]') ?? meta('meta[name="description"]'),
  }
}

function isTruncated(markup: AccessMarkup, extractedText: string): boolean {
  if (markup.contentTier === 'locked') return true
  const collapsed = extractedText.replace(/\s+/g, ' ').trim()
  if (collapsed.length < config.paywall.lockedMaxChars) return true
  if (markup.wordCount !== null) {
    const extractedWords = collapsed ? collapsed.split(' ').length : 0
    if (extractedWords < config.paywall.minWordRatio * markup.wordCount) return true
  }
  return false
}

function markupTier(markup: AccessMarkup, extractedText: string): AccessTier {
  if (markup.accessibleForFree === null) return 'unknown'
  if (markup.accessibleForFree) return 'free'
  return isTruncated(markup, extractedText) ? 'locked' : 'metered'
}

function titleMarkerMatches(marker: string | null, title: string | null): boolean {
  if (!marker || !title) return false
  try {
    return new RegExp(marker).test(title)
  } catch (err) {
    log.warn({ marker, reason: err instanceof Error ? err.message : String(err) }, 'feed paywall title marker does not compile; ignored')
    return false
  }
}

/**
 * Classify a crawled article's access tier.
 *
 * @param html the fetched page, or null when there is none to read (fetch failed, page too large,
 *   local extraction skipped)
 * @param extractedText the text the winning extraction tier produced ('' when every tier failed)
 * @param title the winning tier's title, tested by the title marker when the page has no og:title
 */
export function classifyAccess(input: {
  html: string | null
  extractedText: string
  title: string | null
  policy: PaywallPolicy
}): AccessClassification {
  const { html, extractedText, title, policy } = input
  const markup = html ? readMarkup(html) : null

  let accessTier: AccessTier = markup ? markupTier(markup, extractedText) : 'unknown'
  if (accessTier === 'locked' && !policy.detection) accessTier = 'metered'
  if (titleMarkerMatches(policy.titleMarker, markup?.pageTitle ?? title)) accessTier = 'locked'

  return {
    accessTier,
    pageTitle: markup?.pageTitle ?? null,
    description: markup?.description ?? null,
  }
}
