import { describe, it, expect, vi, beforeAll } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalDialog from './ModalDialog'

// jsdom has no modal dialog support: opening and closing only toggle the `open` attribute here.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

/**
 * What a browser does when Escape is pressed in a modal dialog, which jsdom does not: fire a
 * cancelable `cancel` on it. Returns false when the dialog kept the browser from closing it.
 */
function pressEscape(dialog: HTMLElement) {
  return fireEvent(dialog, new Event('cancel', { cancelable: true }))
}

/** A form whose heading goes away once it is sent, as the signup and feedback forms' do. */
function ExampleForm() {
  const [sent, setSent] = useState(false)
  if (sent)
    return (
      <div role="status">
        <h2>Thanks, that worked</h2>
      </div>
    )
  return (
    <>
      <h2>Stay informed</h2>
      <form
        onSubmit={e => {
          e.preventDefault()
          setSent(true)
        }}
      >
        <label htmlFor="example-email">Email address</label>
        <input id="example-email" type="email" />
        <button type="submit">Send</button>
      </form>
    </>
  )
}

/** A page whose button opens the dialog, as the signup and feedback providers' callers do. */
function Page() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Stay informed">
        <ExampleForm />
      </ModalDialog>
    </>
  )
}

async function openDialog() {
  const user = userEvent.setup()
  render(<Page />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  return { user, dialog: screen.getByRole('dialog') }
}

describe('ModalDialog', () => {
  it('opens as a modal, and mounts its content only while open', async () => {
    render(<Page />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Email address', hidden: true })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('open')
    expect(within(dialog).getByRole('textbox', { name: 'Email address' })).toBeInTheDocument()
  })

  it('closes on Escape, and keeps the browser from closing it on its own', async () => {
    const { dialog } = await openDialog()

    expect(pressEscape(dialog)).toBe(false)
    expect(dialog).not.toHaveAttribute('open')
    expect(screen.queryByRole('textbox', { name: 'Email address', hidden: true })).toBeNull()
  })

  it('closes on a click on the backdrop, and not on a click inside', async () => {
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole('heading', { name: 'Stay informed' }))
    expect(dialog).toHaveAttribute('open')

    // A click on the backdrop lands on the <dialog> itself: its content fills the box.
    await user.click(dialog)
    expect(dialog).not.toHaveAttribute('open')
  })

  it('closes with its Close button', async () => {
    const { user, dialog } = await openDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(dialog).not.toHaveAttribute('open')
  })

  it('gives focus back to the button that opened it', async () => {
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('textbox', { name: 'Email address' }))
    expect(within(dialog).getByRole('textbox', { name: 'Email address' })).toHaveFocus()

    pressEscape(dialog)
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })

  it('leaves focus alone when a link in it left the page that held the opener', async () => {
    const user = userEvent.setup()
    function PageThatALinkLeaves() {
      const [open, setOpen] = useState(false)
      const [left, setLeft] = useState(false)
      return (
        <>
          {!left && (
            <button type="button" onClick={() => setOpen(true)}>
              Open
            </button>
          )}
          <ModalDialog open={open} onClose={() => setOpen(false)} title="Stay informed">
            {/* As "Read past issues" does: the route changes and the dialog closes in one click */}
            <button
              type="button"
              onClick={() => {
                setLeft(true)
                setOpen(false)
              }}
            >
              Read past issues
            </button>
          </ModalDialog>
        </>
      )
    }
    render(<PageThatALinkLeaves />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    const focusedOpener = vi.fn()
    opener.addEventListener('focus', focusedOpener)

    await user.click(screen.getByRole('button', { name: 'Read past issues' }))
    expect(opener).not.toBeInTheDocument()
    expect(focusedOpener).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(opener)
  })

  it('is named by its title in every state: the form, and the thank-you that replaces it', async () => {
    const { user, dialog } = await openDialog()
    expect(dialog).toHaveAccessibleName('Stay informed')

    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(within(dialog).getByRole('status')).toHaveTextContent('Thanks, that worked')
    expect(within(dialog).queryByRole('heading', { name: 'Stay informed' })).toBeNull()
    expect(dialog).toHaveAccessibleName('Stay informed')
  })
})
