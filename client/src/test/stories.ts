import type { PublicStory } from '@shared/types'

/** A published story with every AI-written field set; override what a test needs. */
export function makeStory(overrides: Partial<PublicStory> = {}): PublicStory {
  return {
    id: 'story-1',
    slug: 'story-1',
    sourceUrl: 'https://example.com/article',
    sourceTitle: 'Source headline',
    sourceDatePublished: null,
    title: 'AI headline',
    titleLabel: 'AI label',
    dateCrawled: '2026-09-20T00:00:00Z',
    datePublished: '2026-09-20T00:00:00Z',
    status: 'published',
    relevancePre: 7,
    relevance: 8,
    emotionTag: 'calm',
    summary: 'AI summary.',
    quote: 'A real person said this.',
    quoteAttribution: 'Dr. Jane Doe, WHO',
    marketingBlurb: 'AI blurb.',
    relevanceReasons: null,
    relevanceSummary: 'AI relevance summary.',
    antifactors: null,
    issue: { id: 'issue-1', name: 'Planet & Climate', slug: 'planet-climate' },
    feed: { id: 'feed-1', title: 'Example Feed', displayTitle: null, issue: { name: 'Planet & Climate', slug: 'planet-climate' } },
    ...overrides,
  } as PublicStory
}

/** Text a screen reader announces: all text except subtrees hidden with aria-hidden, whitespace collapsed. */
export function announcedText(node: Node): string {
  function walk(n: Node): string {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? ''
    if (n instanceof Element && n.getAttribute('aria-hidden') === 'true') return ''
    return Array.from(n.childNodes).map(walk).join('')
  }
  return walk(node).replace(/\s+/g, ' ').trim()
}
