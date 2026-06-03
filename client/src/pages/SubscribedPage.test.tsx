import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import SubscribedPage from './SubscribedPage'

const mockConfirm = vi.fn()

vi.mock('../lib/api', () => ({
  publicApi: {
    confirmSubscription: (...args: unknown[]) => mockConfirm(...args),
  },
}))

function renderAt(path: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <SubscribedPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('SubscribedPage', () => {
  beforeEach(() => {
    mockConfirm.mockReset()
  })

  it('shows a confirm button and confirms on click', async () => {
    mockConfirm.mockResolvedValue({ success: true })
    const user = userEvent.setup()

    renderAt('/subscribed?token=abc&email=u%40example.com')

    const button = screen.getByRole('button', { name: /confirm my subscription/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /welcome to the newsletter/i })).toBeInTheDocument()
    })
    expect(mockConfirm).toHaveBeenCalledWith({ token: 'abc', email: 'u@example.com' })
  })

  it('shows the expired state when confirmation reports expired', async () => {
    mockConfirm.mockResolvedValue({ success: false, reason: 'expired' })
    const user = userEvent.setup()

    renderAt('/subscribed?token=abc&email=u%40example.com')
    await user.click(screen.getByRole('button', { name: /confirm my subscription/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /link expired/i })).toBeInTheDocument()
    })
  })

  it('shows the invalid state when confirmation reports invalid', async () => {
    mockConfirm.mockResolvedValue({ success: false, reason: 'invalid' })
    const user = userEvent.setup()

    renderAt('/subscribed?token=abc&email=u%40example.com')
    await user.click(screen.getByRole('button', { name: /confirm my subscription/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument()
    })
  })

  it('stays retriable (not "Invalid Link") on a network error', async () => {
    mockConfirm.mockRejectedValue(new Error('network error'))
    const user = userEvent.setup()

    renderAt('/subscribed?token=abc&email=u%40example.com')
    await user.click(screen.getByRole('button', { name: /confirm my subscription/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    })
    // The confirm button remains so the user can retry; no misleading error page.
    expect(screen.getByRole('button', { name: /confirm my subscription/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /invalid link/i })).not.toBeInTheDocument()
  })

  it('renders the expired state from ?error=expired without confirming', () => {
    renderAt('/subscribed?error=expired')

    expect(screen.getByRole('heading', { name: /link expired/i })).toBeInTheDocument()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('renders the invalid state from ?error=invalid without confirming', () => {
    renderAt('/subscribed?error=invalid')

    expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('renders the welcome state by default with no params', () => {
    renderAt('/subscribed')

    expect(screen.getByRole('heading', { name: /welcome to the newsletter/i })).toBeInTheDocument()
  })
})
