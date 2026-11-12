import { describe, it, expect } from 'vitest'
import { escapeHtml, escapeXml, unescapeXml, unescapeXmlDeep } from './xml.js'

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;')
  })
})

describe('unescapeXml', () => {
  it('undoes escapeXml', () => {
    const text = `<a href="x">Tom & Jerry's</a>`
    expect(unescapeXml(escapeXml(text))).toBe(text)
  })

  it('decodes the numeric apostrophe forms and decodes &amp; last, once', () => {
    expect(unescapeXml('It&#39;s &#x27;x&#x27; and &amp;lt;')).toBe(`It's 'x' and &lt;`)
  })
})

describe('unescapeXmlDeep', () => {
  it('decodes every string in nested objects and arrays, leaving other values alone', () => {
    expect(unescapeXmlDeep({ a: 'It&apos;s', b: [{ c: '&quot;q&quot;' }, 3, null], d: true })).toEqual({ a: `It's`, b: [{ c: '"q"' }, 3, null], d: true })
  })
})

describe('escapeHtml', () => {
  it('escapes the HTML special characters, the apostrophe as a numeric reference', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;')
  })
})
