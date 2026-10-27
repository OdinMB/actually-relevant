import { describe, it, expect, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MobileMenu from './MobileMenu'

// jsdom has no modal dialog support: opening and closing only toggle the `open` attribute here.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const menu = (open: boolean, onClose = vi.fn()) => (
  <MemoryRouter>
    <MobileMenu open={open} onClose={onClose} savedCount={0} />
  </MemoryRouter>
)

/** The menu's <dialog>, open or closed (a closed one is hidden, so it has no accessible name). */
const dialog = () => screen.getByRole('dialog', { hidden: true })

describe('MobileMenu', () => {
  it('opens as a modal while open and closes when open turns false, keeping its links in the page while closed', () => {
    const { rerender } = render(menu(false))
    expect(dialog()).not.toHaveAttribute('open')
    expect(within(dialog()).getByRole('link', { name: 'Newsletter', hidden: true })).toHaveAttribute('href', '/newsletter')

    rerender(menu(true))
    expect(dialog()).toHaveAttribute('open')
    expect(dialog()).toHaveAccessibleName('Mobile navigation')

    rerender(menu(false))
    expect(dialog()).not.toHaveAttribute('open')
    expect(within(dialog()).getByRole('link', { name: 'Newsletter', hidden: true })).toBeInTheDocument()
  })

  it('asks to close on Escape, and keeps the browser from closing it on its own', () => {
    const onClose = vi.fn()
    render(menu(true, onClose))

    // What a browser does on Escape in a modal dialog, which jsdom does not
    expect(fireEvent(dialog(), new Event('cancel', { cancelable: true }))).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog()).toHaveAttribute('open')
  })

  it('closes from its Close menu button and from a link, and not from a click on the dialog itself', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(menu(true, onClose))

    await user.click(within(dialog()).getByRole('button', { name: 'Close menu' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(within(dialog()).getByRole('link', { name: 'Podcast' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(dialog())
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
