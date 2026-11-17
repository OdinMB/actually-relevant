/*
 * A page's tab list pinned to the top of the admin's view (the story page's): its classes, and
 * keeping a newly opened panel's top in sight below it. `.context/admin-dashboard.md`, "Sticky bars".
 */

/**
 * `<main>` scrolls and has padding, so a sticky `top-0` would stop at its padding edge and let
 * content scroll through the strip above; the negative offset pins the list to the edge, as the
 * action bar's does at the bottom (`stickyActionBar.ts`). It is opaque on the page's own grey, so
 * nothing shows through, and z-10 keeps it over the panels but under the action bar's menu and
 * the toasts.
 */
export const STICKY_TAB_LIST = 'sticky -top-4 z-10 bg-neutral-50 shadow-sm lg:-top-6'

/**
 * For the panels under a pinned list: whatever takes focus or is scrolled to in them stops clear of
 * the tab list above and the action bar below (WCAG 2.2 "Focus Not Obscured").
 */
export const CLEAR_OF_STICKY_BARS = '[&_*]:scroll-mb-16 [&_*]:scroll-mt-12'

/** The nearest ancestor that scrolls vertically: `<main>` in the admin. */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/**
 * After a switch of tabs: when the page is scrolled past the top of the panels, which then lies
 * under the pinned list, scroll back up until the panels start just below it. A page scrolled less
 * far stays where it is.
 */
export function revealPanels(list: HTMLElement, panels: HTMLElement): void {
  const covered = list.getBoundingClientRect().bottom - panels.getBoundingClientRect().top
  if (covered <= 0) return
  const box = scrollBox(list)
  if (box) box.scrollTop -= covered
}
