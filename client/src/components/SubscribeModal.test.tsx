import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SubscribeModal from './SubscribeModal'
import { NEWSLETTER_PROMISE } from '../config'

const mockApi = vi.hoisted(() => ({ getSubscribeToken: vi.fn(), subscribe: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

// jsdom has no modal dialog support: opening and closing only toggle the `open` attribute here.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.getSubscribeToken.mockResolvedValue({ token: 'form-token' })
})

function renderModal(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <SubscribeModal open onClose={onClose} />
    </MemoryRouter>,
  )
  return onClose
}

describe('SubscribeModal', () => {
  it('requests no form token while closed, and a fresh one on each open, ready to send once it arrives', async () => {
    const user = userEvent.setup()
    mockApi.subscribe.mockResolvedValue({ success: true })
    const onClose = vi.fn()
    const modal = (open: boolean) => (
      <MemoryRouter>
        <SubscribeModal open={open} onClose={onClose} />
      </MemoryRouter>
    )
    const { rerender } = render(modal(false))
    await act(async () => {})
    expect(mockApi.getSubscribeToken).not.toHaveBeenCalled()

    rerender(modal(true))
    const dialog = screen.getByRole('dialog', { name: 'Stay informed' })
    const email = within(dialog).getByRole('textbox', { name: 'Email address' })
    await waitFor(() => expect(email).toHaveFocus())
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^subscribe$/i })).toBeEnabled())
    expect(mockApi.getSubscribeToken).toHaveBeenCalledTimes(1)

    await user.type(email, 'reader@example.com')
    await user.click(within(dialog).getByRole('button', { name: /^subscribe$/i }))
    expect(mockApi.subscribe).toHaveBeenCalledWith({ email: 'reader@example.com', formToken: 'form-token' })
    expect(await within(dialog).findByText('Check your email')).toBeInTheDocument()

    rerender(modal(false))
    await act(async () => {})
    expect(mockApi.getSubscribeToken).toHaveBeenCalledTimes(1)

    rerender(modal(true))
    await waitFor(() => expect(mockApi.getSubscribeToken).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveValue('')
  })

  it('is named by the form heading, and keeps that name once "Check your email" replaces the form', async () => {
    const user = userEvent.setup()
    mockApi.subscribe.mockResolvedValue({ success: true })
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Stay informed' })
    expect(within(dialog).getByRole('heading', { name: 'Stay informed' })).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^subscribe$/i })).toBeEnabled())

    await user.type(within(dialog).getByRole('textbox', { name: 'Email address' }), 'reader@example.com')
    await user.click(within(dialog).getByRole('button', { name: /^subscribe$/i }))
    expect(await within(dialog).findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName('Stay informed')
  })

  it('moves focus to "Check your email" inside the dialog once the signup succeeds', async () => {
    const user = userEvent.setup()
    mockApi.subscribe.mockResolvedValue({ success: true })
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Stay informed' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^subscribe$/i })).toBeEnabled())

    await user.type(within(dialog).getByRole('textbox', { name: 'Email address' }), 'reader@example.com')
    await user.click(within(dialog).getByRole('button', { name: /^subscribe$/i }))

    expect(await within(dialog).findByRole('heading', { name: 'Check your email' })).toHaveFocus()
  })

  it('says what a subscriber gets, centered under the form', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled())

    expect(screen.getByText(NEWSLETTER_PROMISE)).toHaveClass('text-center')
  })

  it('links past issues and closes when the link is followed', async () => {
    const user = userEvent.setup()
    const onClose = renderModal()
    await waitFor(() => expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled())

    const link = screen.getByRole('link', { name: 'Read past issues' })
    expect(link.getAttribute('href')).toBe('/newsletter')
    await user.click(link)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
