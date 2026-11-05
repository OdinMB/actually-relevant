import { describe, it, expect } from 'vitest'

/**
 * Every public component's source: the client minus the admin and the tests. Read as text, so a
 * class string built in a constant or a template is checked as well as one written in place.
 */
const PUBLIC_SOURCES = Object.entries(import.meta.glob<string>('../**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true })).filter(
  ([path]) => !/\/admin\/|\/AdminLayout\.|\.test\.|^\.\.\/test\//.test(path),
)

/** A focus ring, border or outline in brand-100 to brand-400: 1.1:1 to 2.6:1 on white, under the 3:1 a focus indicator needs. */
const LIGHT_FOCUS_COLOR = /\b(?:focus|focus-visible|focus-within):(?:ring|border|outline)-brand-[1-4]00\b/g

describe('public focus colors', () => {
  it('reads the public sources, not an empty set', () => {
    const paths = PUBLIC_SOURCES.map(([path]) => path)
    expect(paths).toContain('../components/StoryCard.tsx')
    expect(paths).toContain('../index.css')
    expect(paths.filter(path => path.includes('/admin/'))).toEqual([])
  })

  it('never shows focus in a brand shade lighter than brand-500 (WCAG 1.4.11)', () => {
    const found = PUBLIC_SOURCES.flatMap(([path, source]) => (source.match(LIGHT_FOCUS_COLOR) ?? []).map(match => `${path}: ${match}`))
    expect(found).toEqual([])
  })
})
