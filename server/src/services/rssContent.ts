/**
 * Story text from the RSS item itself, for feeds whose `contentSource` is 'rss': publishers such as
 * Substack forbid fetching their article pages but put the full article in the feed. No page is
 * fetched and no extraction tier runs (`.context/content-extraction.md`, "Full Text from the RSS
 * Item").
 */
import * as cheerio from 'cheerio'
import { config } from '../config.js'
import { classifyAccess, type AccessTier, type PaywallPolicy } from '../lib/paywall.js'
import type { RSSItem } from './rssParser.js'
import type { CrawlMethod } from './extractor.js'

/** The `crawlMethod` of a story whose text came from its RSS item. */
export const RSS_CRAWL_METHOD = 'rss' satisfies CrawlMethod

const DROPPED = 'script, style, noscript, iframe, object, embed, template, svg, form, button, input, select, textarea'
const BLOCKS =
  'p, div, section, article, header, footer, aside, nav, main, blockquote, pre, h1, h2, h3, h4, h5, h6, ul, ol, li, dl, dt, dd, table, tr, figure, figcaption, hr, address, details, summary'

// Placeholders from Unicode's private-use area: never whitespace, so they survive the collapse.
const LINE_BREAK = ''
const BLOCK_BREAK = ''
const LINE_BREAK_RUN = new RegExp(` ?${LINE_BREAK} ?`, 'g')
const BLOCK_BREAK_RUN = new RegExp(`\\s*${BLOCK_BREAK}[\\s${BLOCK_BREAK}]*`, 'g')

/**
 * Plain text of an item's HTML: whitespace inside a block collapsed, a line break kept as a newline,
 * and one blank line between blocks, so paragraphs stay apart as in a page extraction.
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html)
  $(DROPPED).remove()
  $('br').replaceWith(LINE_BREAK)
  $('td, th').after(' ')
  $(BLOCKS).before(BLOCK_BREAK).after(BLOCK_BREAK)

  return $('body').text().replace(/\s+/g, ' ').replace(LINE_BREAK_RUN, '\n').replace(BLOCK_BREAK_RUN, '\n\n').trim()
}

export interface RssStoryContent {
  title: string
  content: string
  datePublished: string | null
  accessTier: AccessTier
}

/**
 * The story an RSS item becomes, or null when its text is shorter than `minContentLength`, as for a
 * paid post whose item carries only a preview: the caller skips it and never falls back to fetching
 * the page, which the publisher's terms forbid. The access tier is `unknown` (the item has no access
 * markup), or `locked` when the feed's title marker matches the item title.
 */
export function storyFromRssItem(item: RSSItem, policy: PaywallPolicy): RssStoryContent | null {
  const content = item.contentHtml ? htmlToText(item.contentHtml) : ''
  if (content.length < config.crawl.minContentLength) return null
  const { accessTier } = classifyAccess({ html: null, extractedText: content, title: item.title, policy })
  return { title: item.title, content, datePublished: item.datePublished, accessTier }
}
