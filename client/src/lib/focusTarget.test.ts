import { describe, it, expect, afterEach, vi } from 'vitest'
import { focusWithoutTabStop } from './focusTarget'

function addToPage(html: string): HTMLElement {
  document.body.innerHTML = `${html}<button type="button">Elsewhere</button>`
  return document.body.firstElementChild as HTMLElement
}
const elsewhere = () => document.body.querySelector('button')!

describe('focusWithoutTabStop', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('focuses an element that is not a control, and keeps it focusable only until focus moves on', () => {
    const heading = addToPage('<h1>Results</h1>')

    expect(focusWithoutTabStop(heading)).toBe(true)
    expect(heading).toHaveFocus()
    expect(heading).toHaveAttribute('tabindex', '-1')

    elsewhere().focus()
    expect(heading).not.toHaveAttribute('tabindex')
  })

  it('takes the tabindex away again at once when the element cannot take focus', () => {
    const main = addToPage('<main>Content</main>')
    // What an inert element (behind an open modal dialog) does: the call is ignored
    vi.spyOn(main, 'focus').mockImplementation(() => {})

    expect(focusWithoutTabStop(main)).toBe(false)
    expect(main).not.toHaveAttribute('tabindex')

    // No listener is left behind to act on a later focus and blur
    main.setAttribute('tabindex', '0')
    vi.mocked(main.focus).mockRestore()
    main.focus()
    elsewhere().focus()
    expect(main).toHaveAttribute('tabindex', '0')
  })

  it('leaves a tabindex the element already had', () => {
    const heading = addToPage('<h2 tabindex="-1">Past issues</h2>')

    expect(focusWithoutTabStop(heading)).toBe(true)
    elsewhere().focus()
    expect(heading).toHaveAttribute('tabindex', '-1')
  })

  it('passes the scroll option on', () => {
    const heading = addToPage('<h1>Results</h1>')
    const focus = vi.spyOn(heading, 'focus')

    focusWithoutTabStop(heading, { preventScroll: true })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
