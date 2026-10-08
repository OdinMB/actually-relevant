import { describe, it, expect } from 'vitest'
import { classifyAccess, type PaywallPolicy } from './paywall.js'

const AUTO: PaywallPolicy = { detection: true, titleMarker: null }

function page(opts: { jsonLd?: unknown[]; rawJsonLd?: string[]; meta?: Record<string, string>; title?: string } = {}): string {
  const scripts = [
    ...(opts.jsonLd ?? []).map(obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`),
    ...(opts.rawJsonLd ?? []).map(raw => `<script type="application/ld+json">${raw}</script>`),
  ].join('\n')
  const metas = Object.entries(opts.meta ?? {})
    .map(([key, value]) => `<meta ${key.startsWith('og:') || key.startsWith('article:') ? 'property' : 'name'}="${key}" content="${value}">`)
    .join('\n')
  return `<html><head><title>${opts.title ?? 'Page title'}</title>${metas}${scripts}</head><body><p>Body</p></body></html>`
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const teaser = 'A short teaser paragraph that runs a few hundred characters. '.repeat(6)
const longBody = 'A long article body sentence that keeps going for a while. '.repeat(100)

describe('classifyAccess', () => {
  it('classifies a SPIEGEL-style boolean false with a short body as locked', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: false }] })
    expect(classifyAccess({ html, extractedText: teaser, title: null, policy: AUTO }).accessTier).toBe('locked')
  })

  it('classifies boolean true as free', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: true }] })
    expect(classifyAccess({ html, extractedText: teaser, title: null, policy: AUTO }).accessTier).toBe('free')
  })

  it('reads a "False" string inside hasPart and compares the wordCount (ZEIT style) as locked', () => {
    const html = page({
      jsonLd: [{
        '@type': 'NewsArticle',
        wordCount: 7008,
        hasPart: [{ '@type': 'WebPageElement', isAccessibleForFree: 'False', cssSelector: '.paywall' }],
      }],
    })
    // 2,000 words is long enough to pass the length clause, but far below 0.3 x 7008
    expect(classifyAccess({ html, extractedText: words(2000), title: null, policy: AUTO }).accessTier).toBe('locked')
  })

  it('classifies content_tier=locked with the flag as locked even with a long body', () => {
    const html = page({
      jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: 'false' }],
      meta: { 'article:content_tier': 'locked' },
    })
    expect(classifyAccess({ html, extractedText: longBody, title: null, policy: AUTO }).accessTier).toBe('locked')
  })

  it('classifies a paid flag with a full-length body (Diplomat style) as metered', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: 'False' }] })
    expect(classifyAccess({ html, extractedText: longBody, title: null, policy: AUTO }).accessTier).toBe('metered')
  })

  it('measures length on whitespace-collapsed text, so layout whitespace does not hide a teaser', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: false }] })
    const padded = `${teaser}${'\n\n\n   '.repeat(400)}`
    expect(classifyAccess({ html, extractedText: padded, title: null, policy: AUTO }).accessTier).toBe('locked')
  })

  it('classifies a page without access markup as unknown, even with a short body', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', headline: 'BBC' }] })
    expect(classifyAccess({ html, extractedText: 'short', title: null, policy: AUTO }).accessTier).toBe('unknown')
  })

  it('classifies a short free brief as free', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: 'True' }] })
    expect(classifyAccess({ html, extractedText: 'A short agency brief.', title: null, policy: AUTO }).accessTier).toBe('free')
  })

  it('finds the flag inside @graph and inside a top-level array', () => {
    const graph = page({ jsonLd: [{ '@graph': [{ '@type': 'WebSite' }, { '@type': 'NewsArticle', isAccessibleForFree: false }] }] })
    const array = page({ jsonLd: [[{ '@type': 'Organization' }, { '@type': 'NewsArticle', isAccessibleForFree: false }]] })
    expect(classifyAccess({ html: graph, extractedText: teaser, title: null, policy: AUTO }).accessTier).toBe('locked')
    expect(classifyAccess({ html: array, extractedText: teaser, title: null, policy: AUTO }).accessTier).toBe('locked')
  })

  it('ignores a malformed JSON-LD block and still reads the valid one', () => {
    const html = page({
      rawJsonLd: ['{ "isAccessibleForFree": true, broken'],
      jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: false }],
    })
    expect(classifyAccess({ html, extractedText: teaser, title: null, policy: AUTO }).accessTier).toBe('locked')
  })

  it('stores what would be locked as metered when the feed switched detection off', () => {
    const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: false }] })
    const policy = { detection: false, titleMarker: null }
    expect(classifyAccess({ html, extractedText: teaser, title: null, policy }).accessTier).toBe('metered')
  })

  it('returns unknown without HTML', () => {
    expect(classifyAccess({ html: null, extractedText: teaser, title: 'A title', policy: AUTO }).accessTier).toBe('unknown')
  })

  describe('title marker', () => {
    const policy = { detection: true, titleMarker: '^\\(S\\+\\)' }

    it('forces locked when og:title matches, on a page marked free', () => {
      const html = page({
        jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: true }],
        meta: { 'og:title': '(S+) A subscriber story' },
      })
      expect(classifyAccess({ html, extractedText: longBody, title: 'A subscriber story', policy }).accessTier).toBe('locked')
    })

    it('forces locked on a page without markup, even with detection off', () => {
      const html = page({ meta: { 'og:title': '(S+) A subscriber story' } })
      expect(classifyAccess({ html, extractedText: longBody, title: null, policy: { ...policy, detection: false } }).accessTier).toBe('locked')
    })

    it('matches the API title when there is no HTML', () => {
      expect(classifyAccess({ html: null, extractedText: longBody, title: '(S+) From the API', policy }).accessTier).toBe('locked')
    })

    it('leaves the markup result when it does not match', () => {
      const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: true }], meta: { 'og:title': 'A free story' } })
      expect(classifyAccess({ html, extractedText: longBody, title: null, policy }).accessTier).toBe('free')
    })

    it('tests only the first 300 characters of a title', () => {
      const marker = { detection: true, titleMarker: 'END$' }
      expect(classifyAccess({ html: null, extractedText: longBody, title: `${'x'.repeat(296)}END`, policy: marker }).accessTier).toBe('locked')
      expect(classifyAccess({ html: null, extractedText: longBody, title: `${'x'.repeat(400)}END`, policy: marker }).accessTier).toBe('unknown')
    })

    it('ignores a marker that does not compile', () => {
      const html = page({ jsonLd: [{ '@type': 'NewsArticle', isAccessibleForFree: true }], meta: { 'og:title': '(S+) story' } })
      const broken = { detection: true, titleMarker: '(S+' }
      expect(classifyAccess({ html, extractedText: longBody, title: null, policy: broken }).accessTier).toBe('free')
    })
  })

  it('returns the page title and description for a teaser result', () => {
    const html = page({ meta: { 'og:title': 'OG title', 'og:description': 'OG description' } })
    const result = classifyAccess({ html, extractedText: '', title: null, policy: AUTO })
    expect(result.pageTitle).toBe('OG title')
    expect(result.description).toBe('OG description')

    const plain = page({ title: 'Document title', meta: { description: 'Meta description' } })
    const fallback = classifyAccess({ html: plain, extractedText: '', title: null, policy: AUTO })
    expect(fallback.pageTitle).toBe('Document title')
    expect(fallback.description).toBe('Meta description')
  })
})
