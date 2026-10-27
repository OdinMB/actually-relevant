/**
 * Readers for Tailwind classes. jsdom has no layout, so for tap targets and focus styles a
 * component's classes are what a test can check (.context/accessibility.md).
 */

/** Tailwind's spacing scale: one step is 0.25rem, 4px. */
const PX_PER_STEP = 4

/** Display classes under which width, height and their minimums apply; an inline element ignores them. */
const BOX_DISPLAYS = new Set(['block', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid'])

/**
 * The size an element's classes guarantee along one axis, per breakpoint prefix ('' is phones,
 * before any prefix): the larger of `h-N` and `min-h-N` (or `w-N` and `min-w-N`), in px.
 */
export function sizeByBreakpoint(el: Element, axis: 'h' | 'w'): Map<string, number> {
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

/** Whether the element is a box, so its width and height classes apply. */
export function isBox(el: Element): boolean {
  return [...el.classList].some(c => BOX_DISPLAYS.has(c))
}

/**
 * How far below `md` an absolutely placed `::after` reaches past each side of the element, from its
 * `max-md:after:-inset…`, `-top-N`, `-right-N`, `-bottom-N` and `-left-N` classes, in px.
 */
export function phoneAfterReach(el: Element): { top: number; right: number; bottom: number; left: number } {
  const reach = { top: 0, right: 0, bottom: 0, left: 0 }
  const sides: Record<string, (keyof typeof reach)[]> = {
    inset: ['top', 'right', 'bottom', 'left'],
    'inset-x': ['left', 'right'],
    'inset-y': ['top', 'bottom'],
    top: ['top'],
    right: ['right'],
    bottom: ['bottom'],
    left: ['left'],
  }
  for (const cls of el.classList) {
    const match = /^max-md:after:-(inset-x|inset-y|inset|top|right|bottom|left)-(\d+(?:\.5)?)$/.exec(cls)
    if (!match) continue
    for (const side of sides[match[1]!]!) reach[side] = Number(match[2]) * PX_PER_STEP
  }
  return reach
}

/**
 * Why an element does not show exactly the brand focus ring, and only on keyboard focus; empty when
 * it does. A ring without `focus-visible:outline-none` draws beside the browser's own outline.
 */
export function focusRingProblems(el: Element): string[] {
  const classes = [...el.classList]
  const problems = ['focus-visible:ring-2', 'focus-visible:ring-brand-500', 'focus-visible:outline-none']
    .filter(needed => !classes.includes(needed))
    .map(missing => `no ${missing}`)
  problems.push(...classes.filter(c => /^focus:(?:ring|outline)/.test(c)).map(c => `${c} shows on a mouse click too`))
  return problems
}
