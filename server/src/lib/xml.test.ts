import { describe, it, expect } from 'vitest'
import { escapeHtml, escapeXml } from './xml.js'

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;')
  })
})

describe('escapeHtml', () => {
  it('escapes the HTML special characters, the apostrophe as a numeric reference', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;')
  })
})
