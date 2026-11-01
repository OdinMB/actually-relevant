import { describe, it, expect } from 'vitest'
import { config } from '../config.js'
import { htmlToText, storyFromRssItem } from './rssContent.js'
import type { RSSItem } from './rssParser.js'

const NO_PAYWALL = { detection: true, titleMarker: null }

function item(overrides: Partial<RSSItem> = {}): RSSItem {
  return {
    url: 'https://writer.substack.com/p/post',
    title: 'A post',
    datePublished: '2026-10-30T08:00:00.000Z',
    description: 'Teaser',
    contentHtml: `<p>${'Long enough text. '.repeat(30)}</p>`,
    ...overrides,
  }
}

describe('htmlToText', () => {
  it('keeps a blank line between blocks and joins the inline text inside one', () => {
    const html =
      '<h2>Heading</h2><p>One <strong>bold</strong>\n   and <a href="#">linked</a> line.</p><blockquote><p>Quoted</p></blockquote><ul><li>First</li><li>Second</li></ul>'

    expect(htmlToText(html)).toBe('Heading\n\nOne bold and linked line.\n\nQuoted\n\nFirst\n\nSecond')
  })

  it('turns a line break into a newline and decodes entities', () => {
    expect(htmlToText('<p>Line one<br>Line two &amp; more&nbsp;text</p>')).toBe('Line one\nLine two & more text')
  })

  it('drops scripts, styles, embeds and forms', () => {
    const html =
      '<p>Kept</p><script>var x = 1</script><style>p{}</style><iframe src="https://x"></iframe><form><button>Subscribe</button></form><noscript>No JS</noscript>'

    expect(htmlToText(html)).toBe('Kept')
  })

  it('reads text that is not wrapped in any block', () => {
    expect(htmlToText('Plain text, <em>no</em> paragraphs')).toBe('Plain text, no paragraphs')
  })
})

describe('storyFromRssItem', () => {
  it('makes a story from the item text with the item title and date, access unknown', () => {
    const story = storyFromRssItem(item(), NO_PAYWALL)

    expect(story).toEqual({
      title: 'A post',
      content: 'Long enough text. '.repeat(30).trim(),
      datePublished: '2026-10-30T08:00:00.000Z',
      accessTier: 'unknown',
    })
  })

  it('returns null for text shorter than the minimum, such as a paid post preview', () => {
    const justShort = 'x'.repeat(config.crawl.minContentLength - 1)

    expect(storyFromRssItem(item({ contentHtml: `<p>${justShort}</p>` }), NO_PAYWALL)).toBeNull()
    expect(storyFromRssItem(item({ contentHtml: null }), NO_PAYWALL)).toBeNull()
    expect(storyFromRssItem(item({ contentHtml: `<p>${justShort}x</p>` }), NO_PAYWALL)).not.toBeNull()
  })

  it('marks the story locked when the feed title marker matches the item title', () => {
    const policy = { detection: true, titleMarker: '^\\(S\\+\\)' }

    expect(storyFromRssItem(item({ title: '(S+) Subscriber piece' }), policy)?.accessTier).toBe('locked')
    expect(storyFromRssItem(item({ title: 'Free piece' }), policy)?.accessTier).toBe('unknown')
  })
})
