import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
