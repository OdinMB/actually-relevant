/**
 * Moves focus to an element that is not a control (a page's `<main>`, a list's heading, the section
 * a link's `#hash` names), so a screen reader goes on from there (.context/accessibility.md). The
 * element is focusable only while it holds that focus: a lasting `tabindex` would let every click on
 * its text take focus, and the next Tab would then start over from it instead of after the click.
 * When the element cannot take focus (an open modal dialog makes the page around it inert), the
 * `tabindex` goes again at once. Returns whether the element took focus.
 */
export function focusWithoutTabStop(element: HTMLElement, options?: FocusOptions): boolean {
  if (element.hasAttribute('tabindex')) {
    element.focus(options)
    return document.activeElement === element
  }

  element.setAttribute('tabindex', '-1')
  element.focus(options)
  if (document.activeElement !== element) {
    element.removeAttribute('tabindex')
    return false
  }
  element.addEventListener('blur', () => element.removeAttribute('tabindex'), { once: true })
  return true
}
