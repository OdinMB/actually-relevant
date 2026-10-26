import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SiteFooter from './SiteFooter'
import { FOOTER_LEGAL, FOOTER_NAV, ISSUE_LINKS } from './navLinks'

/** WCAG 2.2 AA, 2.5.8 Target Size (Minimum). */
const MIN_TARGET_PX = 24
/** Tailwind's spacing scale: one step is 0.25rem, 4px. */
const PX_PER_STEP = 4
/** Display classes under which `height` and `min-height` apply; an inline `<a>` ignores both. */
const BOX_DISPLAYS = new Set(['block', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid'])

/**
 * The size an element's classes guarantee along one axis, per breakpoint ('' is phones, before any
 * prefix): the larger of `h-N` and `min-h-N` (or `w-N` and `min-w-N`), in px. jsdom has no layout, so
 * the classes are what a test can check.
 */
function sizesByBreakpoint(el: Element, axis: 'h' | 'w'): Map<string, number> {
  const pattern = new RegExp(`^(?:(\\w+):)?(?:min-)?${axis}-(\\d+(?:\\.5)?)$`)
  const sizes = new Map<string, number>()
  for (const cls of el.classList) {
    const match = pattern.exec(cls)
    if (!match) continue
    const breakpoint = match[1] ?? ''
    sizes.set(breakpoint, Math.max(sizes.get(breakpoint) ?? 0, Number(match[2]) * PX_PER_STEP))
  }
  return sizes
}

function axisProblems(el: Element, axis: 'h' | 'w'): string[] {
  const sizes = sizesByBreakpoint(el, axis)
  const what = axis === 'h' ? 'height' : 'width'
  if (!sizes.has('')) return [`no ${what} class at phone width`]
  return [...sizes].filter(([, px]) => px < MIN_TARGET_PX).map(([bp, px]) => `${what} ${px}px at ${bp || 'phone width'}`)
}

/** Why a link's classes don't guarantee a 2.5.8 target; empty when they do. Icon-only links need the width too. */
function targetProblems(link: Element): string[] {
  const classes = [...link.classList]
  const problems: string[] = []
  if (!classes.some(c => BOX_DISPLAYS.has(c))) problems.push('inline, so min-height does nothing')
  if (classes.some(c => /^(?:\w+:)?inline$/.test(c))) problems.push('turns inline at a breakpoint')
  problems.push(...axisProblems(link, 'h'))
  if (!link.textContent?.trim()) problems.push(...axisProblems(link, 'w'))
  return problems
}

function linkName(link: Element): string {
  return link.getAttribute('aria-label') ?? link.textContent?.trim() ?? link.outerHTML
}

describe('SiteFooter tap targets (WCAG 2.5.8)', () => {
  it('gives every footer link a hit area at least 24px tall at every breakpoint, and icon links 24px wide', () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    )
    const links = within(screen.getByRole('contentinfo')).getAllByRole('link')
    // The nav and issue lists, both copies of the legal links (phones and md up), the brand and the four icon links
    expect(links.length).toBeGreaterThanOrEqual(FOOTER_NAV.length + ISSUE_LINKS.length + 2 * FOOTER_LEGAL.length + 5)

    const problems = links.flatMap(link => targetProblems(link).map(problem => `${linkName(link)}: ${problem}`))
    expect(problems).toEqual([])
  })

  it('flags a link that is inline, has no height class, or drops under 24px at a breakpoint', () => {
    const link = (className: string, text = 'About') => {
      const a = document.createElement('a')
      a.className = className
      a.textContent = text
      return a
    }
    expect(targetProblems(link('min-h-8 text-sm'))).toEqual(['inline, so min-height does nothing'])
    expect(targetProblems(link('inline-flex text-sm'))).toEqual(['no height class at phone width'])
    expect(targetProblems(link('inline-flex min-h-8 md:min-h-5'))).toEqual(['height 20px at md'])
    expect(targetProblems(link('inline-flex min-h-8 md:inline'))).toEqual(['turns inline at a breakpoint'])
    expect(targetProblems(link('flex h-8 w-5', ''))).toEqual(['width 20px at phone width'])
    expect(targetProblems(link('inline-flex min-h-8 md:min-h-6'))).toEqual([])
  })
})
