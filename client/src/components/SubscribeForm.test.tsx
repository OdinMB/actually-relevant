import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubscribeForm from './SubscribeForm'
import { ApiError } from '../lib/api'
import type { TurnstileRenderOptions } from '../lib/turnstile'

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

// Cloudflare's script is never fetched in tests: a stand-in API is installed when the
// injected <script> tag is made to fire `load`.
function stubTurnstile() {
  const rendered: TurnstileRenderOptions[] = []
  const api = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      rendered.push(options)
      return `widget-${rendered.length}`
    }),
    execute: vi.fn(),
    remove: vi.fn(),
  }
  return { api, rendered }
}
const scriptTags = () => document.head.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]')
function finishScriptLoad(api: ReturnType<typeof stubTurnstile>['api']) {
  window.turnstile = api
  scriptTags()[0].dispatchEvent(new Event('load'))
}

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
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    delete window.turnstile
    scriptTags().forEach((s) => s.remove())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete window.turnstile
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
      vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
    })

    it('requests nothing from Cloudflare on render, focus or typing', async () => {
      const user = userEvent.setup()
      await renderReady()

      await user.click(screen.getByPlaceholderText('you@example.com'))
      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')

      expect(scriptTags()).toHaveLength(0)
    })

    it('loads Turnstile on submit, runs the challenge and posts its token', async () => {
      mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
      const { api, rendered } = stubTurnstile()
      const user = userEvent.setup()
      await renderReady()

      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))

      expect(scriptTags()).toHaveLength(1)
      expect(screen.getByRole('button', { name: /verifying/i })).toBeDisabled()
      expect(mockSubscribe).not.toHaveBeenCalled()

      finishScriptLoad(api)
      await waitFor(() => expect(api.execute).toHaveBeenCalled())
      rendered[0].callback('ts-token')

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalledWith({
          email: 'hello@example.com',
          formToken: 'test-token',
          turnstileToken: 'ts-token',
        })
      })
    })

    it('loads nothing and posts nothing when the address is malformed', async () => {
      const user = userEvent.setup()
      await renderReady()

      // Passes the browser's type="email" check, but has no domain suffix.
      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example')
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(scriptTags()).toHaveLength(0)
      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('shows the human-check error when the script fails to load, and lets the visitor retry', async () => {
      const user = userEvent.setup()
      await renderReady()

      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))
      scriptTags()[0].dispatchEvent(new Event('error'))

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/human check/i))
      expect(mockSubscribe).not.toHaveBeenCalled()

      const button = screen.getByRole('button', { name: /^subscribe$/i })
      expect(button).toBeEnabled()
      await user.click(button)
      expect(scriptTags()).toHaveLength(1)
      // Settle the second load so it does not leak into the next test.
      scriptTags()[0].dispatchEvent(new Event('error'))
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/human check/i))
    })

    it('shows the human-check error when the challenge fails', async () => {
      const { api, rendered } = stubTurnstile()
      window.turnstile = api
      const user = userEvent.setup()
      await renderReady()

      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))
      await waitFor(() => expect(rendered).toHaveLength(1))
      rendered[0]['error-callback']()

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/human check/i))
      expect(mockSubscribe).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled()
    })

    it('removes a pending widget on unmount', async () => {
      const { api, rendered } = stubTurnstile()
      window.turnstile = api
      const user = userEvent.setup()
      const { unmount } = render(<SubscribeForm idPrefix="test" />)
      await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())

      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      await user.click(screen.getByRole('button', { name: /^subscribe$/i }))
      await waitFor(() => expect(rendered).toHaveLength(1))

      unmount()
      expect(api.remove).toHaveBeenCalledWith('widget-1')
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
