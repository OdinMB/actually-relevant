import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubscribeForm from './SubscribeForm'

const mockSubscribe = vi.fn()
const mockGetToken = vi.fn()

vi.mock('../lib/api', () => ({
  publicApi: {
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    getSubscribeToken: (...args: unknown[]) => mockGetToken(...args),
  },
}))

/** Render and wait until the form token has loaded (submit is disabled until then). */
async function renderReady() {
  render(<SubscribeForm idPrefix="test" />)
  await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())
}

describe('SubscribeForm', () => {
  beforeEach(() => {
    mockSubscribe.mockReset()
    mockGetToken.mockReset()
    mockGetToken.mockResolvedValue({ token: 'test-token' })
  })

  it('renders the form with first name and email fields', async () => {
    render(<SubscribeForm idPrefix="test" />)

    expect(screen.getByPlaceholderText('First name (optional)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())
  })

  it('disables submit until the form token has loaded', async () => {
    mockGetToken.mockReturnValue(new Promise(() => {})) // never resolves
    render(<SubscribeForm idPrefix="test" />)

    expect(screen.getByRole('button', { name: /subscribe/i })).toBeDisabled()
  })

  it('retries the token fetch once and submits the retried token', async () => {
    mockGetToken.mockReset()
    mockGetToken
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ token: 'retry-token' })
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'retry-token' }))
    })
  })

  it('submits with the form token and shows success message', async () => {
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'hello@example.com', formToken: 'test-token' }),
    )
  })

  it('shows error message on failure', async () => {
    mockSubscribe.mockResolvedValue({ success: false, message: 'Invalid email address' })
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'bad@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email address')
    })
  })

  it('shows generic error on network failure', async () => {
    mockSubscribe.mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    })
  })

  it('renders Done button when onSuccess is provided', async () => {
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const onSuccess = vi.fn()
    const user = userEvent.setup()

    render(<SubscribeForm idPrefix="test" onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /done/i }))
    expect(onSuccess).toHaveBeenCalled()
  })

  it('hides heading when hideHeading is true', async () => {
    render(<SubscribeForm idPrefix="test" hideHeading />)
    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('shows heading by default', async () => {
    render(<SubscribeForm idPrefix="test" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())

    expect(screen.getByRole('heading')).toBeInTheDocument()
  })

  it('includes firstName when provided', async () => {
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('First name (optional)'), 'Alice')
    await user.type(screen.getByPlaceholderText('you@example.com'), 'alice@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.com', firstName: 'Alice', formToken: 'test-token' }),
      )
    })
  })

  it('disables submit button while loading', async () => {
    mockSubscribe.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /subscribing/i })).toBeDisabled()
    })
  })
})
