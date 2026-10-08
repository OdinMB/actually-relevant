import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubscribeForm from './SubscribeForm'
import { ApiError } from '../lib/api'

const mockSubscribe = vi.fn()
const mockGetToken = vi.fn()

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ApiError: actual.ApiError,
    publicApi: {
      subscribe: (...args: unknown[]) => mockSubscribe(...args),
      getSubscribeToken: (...args: unknown[]) => mockGetToken(...args),
    },
  }
})

vi.mock('../config', () => ({
  BRAND: { claim: 'News that matters to humanity.', claimSupport: 'Curated with care by AI.' },
}))

// A stand-in for Cloudflare's widget: a button that hands the form a token.
const turnstile = vi.hoisted(() => ({ siteKey: '', mounts: 0 }))
vi.mock('./TurnstileWidget', async () => {
  const { createElement, useEffect } = await import('react')
  function StubWidget({ onToken }: { onToken: (token: string | null) => void }) {
    useEffect(() => {
      turnstile.mounts++
    }, [])
    return createElement('button', { type: 'button', onClick: () => onToken('ts-token') }, 'Pass human check')
  }
  return {
    get TURNSTILE_SITE_KEY() {
      return turnstile.siteKey
    },
    default: StubWidget,
  }
})

const pausedError = () => new ApiError(503, 'Newsletter signups are paused.', 'SIGNUPS_PAUSED')

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
    turnstile.siteKey = ''
    turnstile.mounts = 0
  })

  it('has an email field and no first-name field', async () => {
    render(<SubscribeForm idPrefix="test" />)

    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1) // the honeypot is aria-hidden
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

  describe('when the API says signups are paused', () => {
    it('shows the paused notice instead of the form, asking only once', async () => {
      mockGetToken.mockRejectedValue(pausedError())
      render(<SubscribeForm idPrefix="test" />)

      await waitFor(() => expect(screen.getByText(/signups are paused/i)).toBeInTheDocument())
      expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
      expect(mockGetToken).toHaveBeenCalledTimes(1)
    })

    it('renders the close action when onSuccess is provided', async () => {
      mockGetToken.mockRejectedValue(pausedError())
      render(<SubscribeForm idPrefix="test" onSuccess={vi.fn()} />)

      await waitFor(() => expect(screen.getByRole('button', { name: /got it/i })).toBeInTheDocument())
    })

    it('switches to the paused notice when the signup itself is refused as paused', async () => {
      mockSubscribe.mockRejectedValue(pausedError())
      const user = userEvent.setup()

      await renderReady()
      await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /subscribe/i }))

      await waitFor(() => expect(screen.getByText(/signups are paused/i)).toBeInTheDocument())
    })
  })

  it('submits the email and form token, never a first name, and shows success', async () => {
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })
    expect(mockSubscribe).toHaveBeenCalledWith({ email: 'hello@example.com', formToken: 'test-token' })
  })

  describe('with Turnstile configured', () => {
    beforeEach(() => {
      turnstile.siteKey = 'site-key'
    })

    it('loads no widget until the email field is focused', async () => {
      const user = userEvent.setup()
      render(<SubscribeForm idPrefix="test" />)
      await waitFor(() => expect(mockGetToken).toHaveBeenCalled())

      expect(screen.queryByRole('button', { name: /human check/i })).not.toBeInTheDocument()

      await user.click(screen.getByPlaceholderText('you@example.com'))
      expect(screen.getByRole('button', { name: /human check/i })).toBeInTheDocument()
    })

    it('keeps submit disabled until the widget reports a token, then sends it', async () => {
      mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
      const user = userEvent.setup()
      render(<SubscribeForm idPrefix="test" />)
      await waitFor(() => expect(mockGetToken).toHaveBeenCalled())

      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: /human check/i }))
      await waitFor(() => expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalledWith(
          expect.objectContaining({ formToken: 'test-token', turnstileToken: 'ts-token' }),
        )
      })
    })

    it('shows a fresh widget after a failed submit, clearing the used token', async () => {
      mockSubscribe.mockResolvedValue({ success: false, message: "We couldn't verify that you're human." })
      const user = userEvent.setup()
      render(<SubscribeForm idPrefix="test" />)
      await waitFor(() => expect(mockGetToken).toHaveBeenCalled())

      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      await user.click(screen.getByRole('button', { name: /human check/i }))
      await waitFor(() => expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(turnstile.mounts).toBe(2)
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeDisabled()
    })
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
