import { describe, it, expect, vi } from 'vitest'

// The real rss-parser on real feed XML (rssParser.test.ts mocks the parser): whether an item's
// full text arrives depends on where rss-parser puts content:encoded, which a mock cannot show.
const mockAxiosGet = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { get: mockAxiosGet } }))
vi.mock('../lib/retry.js', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
  isRetryableError: () => true,
}))

const { parseFeed } = await import('./rssParser.js')

function feedResponse(xml: string) {
  return { status: 200, data: xml, headers: {} }
}

describe('parseFeed item HTML', () => {
  it('takes content:encoded as the item HTML, over the description', async () => {
    mockAxiosGet.mockResolvedValue(
      feedResponse(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>A Newsletter</title>
    <item>
      <title>Full post</title>
      <link>https://writer.substack.com/p/full-post</link>
      <description>A one-line teaser</description>
      <content:encoded><![CDATA[<p>First paragraph.</p><p>Second paragraph.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`),
    )

    const { items } = await parseFeed('https://writer.substack.com/feed')

    expect(items[0]?.contentHtml).toBe('<p>First paragraph.</p><p>Second paragraph.</p>')
    expect(items[0]?.description).toBe('A one-line teaser')
  })

  it('falls back to the description, and to an Atom entry content, without content:encoded', async () => {
    mockAxiosGet.mockResolvedValueOnce(
      feedResponse(`<?xml version="1.0"?>
<rss version="2.0"><channel><title>T</title>
  <item><title>Only a description</title><link>https://example.com/a</link><description>&lt;p&gt;Body&lt;/p&gt;</description></item>
  <item><title>Nothing</title><link>https://example.com/b</link></item>
</channel></rss>`),
    )
    mockAxiosGet.mockResolvedValueOnce(
      feedResponse(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
  <entry><title>Atom entry</title><link href="https://example.com/c"/><content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content></entry>
</feed>`),
    )

    const rss = await parseFeed('https://example.com/rss')
    const atom = await parseFeed('https://example.com/atom')

    expect(rss.items.map(i => i.contentHtml)).toEqual(['<p>Body</p>', null])
    expect(atom.items[0]?.contentHtml).toBe('<p>Atom body</p>')
  })
})
