import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SubscribeForm from './SubscribeForm'
import { ApiError } from '../lib/api'
import { NEWSLETTER_PROMISE } from '../config'
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

vi.mock('../config', async importOriginal => ({
  ...(await importOriginal<typeof import('../config')>()),
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
  scriptTags()[0]!.dispatchEvent(new Event('load'))
}

const pausedError = () => new ApiError(503, 'Newsletter signups are paused.', 'SIGNUPS_PAUSED')
// The bodies the server's rate limiters answer with (server/src/routes/public/subscribe.ts, middleware/rateLimit.ts).
const signupLimitError = () => new ApiError(429, 'Too many subscription attempts. Please try again later.')
const requestLimitError = () => new ApiError(429, 'Too many requests. Please try again later.')

const UNREACHABLE_NOTE = "The signup form can't load right now. Please reload the page or try again later."
const REQUEST_LIMIT_NOTE = "Too many requests from this network right now, so the signup form can't load. Please try again in a few minutes."
const RATE_LIMIT_ERROR = 'Too many requests from this network right now. Please try again in a few minutes, or tomorrow if this keeps happening.'

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
    scriptTags().forEach(s => s.remove())
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

  it('reads "Loading..." on the disabled button until the form token has loaded, without a message meanwhile', async () => {
    let deliver!: (value: { token: string }) => void
    mockGetToken.mockReturnValue(new Promise(resolve => (deliver = resolve)))
    render(<SubscribeForm idPrefix="test" />)

    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await act(async () => deliver({ token: 'test-token' }))
    expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled()
  })

  it('retries the token fetch once and submits the retried token', async () => {
    mockGetToken.mockReset()
    mockGetToken.mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({ token: 'retry-token' })
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const user = userEvent.setup()

    await renderReady()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'retry-token' }))
    })
  })

  describe('when both token attempts fail', () => {
    /** Render with an API that refuses every token request, and wait until both attempts have settled. */
    async function renderUnreachable(error: () => unknown = () => new Error('API down')) {
      mockGetToken.mockReset()
      mockGetToken.mockImplementation(() => Promise.reject(error()))
      render(<SubscribeForm idPrefix="test" />)
      await waitFor(() => expect(mockGetToken).toHaveBeenCalledTimes(2))
      await act(() => new Promise(resolve => setTimeout(resolve, 0)))
    }

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'webdriver')
    })

    it('says calmly that the form cannot load, announced and describing the email field', async () => {
      await renderUnreachable()

      const status = screen.getByRole('status')
      expect(status).toHaveTextContent(UNREACHABLE_NOTE)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /subscribe/i })).toBeDisabled()
      const email = screen.getByRole('textbox', { name: /email/i })
      expect(email.getAttribute('aria-describedby')?.split(' ')[0]).toBe('test-unavailable')
      expect(email).toHaveAccessibleDescription(/^The signup form can.t load right now/)
    })

    it('says the network has sent too many requests when the token request is rate-limited', async () => {
      await renderUnreachable(requestLimitError)

      expect(screen.getByRole('status')).toHaveTextContent(REQUEST_LIMIT_NOTE)
      expect(screen.getByRole('textbox', { name: /email/i })).toHaveAccessibleDescription(new RegExp(`^${REQUEST_LIMIT_NOTE}`))
      expect(screen.getByRole('button', { name: /subscribe/i })).toBeDisabled()
    })

    it('says nothing while prerendering, so the static HTML never carries the message', async () => {
      Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
      await renderUnreachable()

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(screen.getByRole('textbox', { name: /email/i }).getAttribute('aria-describedby') ?? '').not.toContain('test-unavailable')
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

  it('says on success that the email can take a few hours at busy times and may be in the spam folder', async () => {
    mockSubscribe.mockResolvedValue({ success: true, message: 'Check your email to confirm your subscription.' })
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument())
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('A confirmation link is on its way to hello@example.com. Click the link to start receiving our weekly newsletter.')
    expect(status).toHaveTextContent(
      "It usually arrives within minutes, but at busy times it can take a few hours. If you can't find it, please check your spam folder.",
    )
  })

  // The pressed Subscribe button goes with the form, so focus would otherwise drop to the page unannounced.
  it('moves focus to the "Check your email" heading on success, as on /newsletter, so a screen reader announces it', async () => {
    mockSubscribe.mockResolvedValue({ success: true, message: 'ok' })
    const user = userEvent.setup()
    render(<SubscribeForm idPrefix="test" hideHeading />)
    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())

    await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toHaveFocus()
  })

  // The signup POST sits behind the public API's request limit as well as its own per-minute and daily limits.
  it.each([
    ['a signup limit', signupLimitError],
    ['the public request limit', requestLimitError],
  ])('says the network has sent too many requests, naming no limit, when the signup is refused by %s', async (_limit, error) => {
    mockSubscribe.mockRejectedValue(error())
    const user = userEvent.setup()

    await renderReady()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /subscribe/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(RATE_LIMIT_ERROR))
    expect(screen.getByRole('alert')).not.toHaveTextContent('Something went wrong')
    expect(screen.getByRole('textbox', { name: /email/i })).toHaveAccessibleDescription(new RegExp(`^${RATE_LIMIT_ERROR}`))
    expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled()
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
      rendered[0]!.callback('ts-token')

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
      scriptTags()[0]!.dispatchEvent(new Event('error'))

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/human check/i))
      expect(mockSubscribe).not.toHaveBeenCalled()

      const button = screen.getByRole('button', { name: /^subscribe$/i })
      expect(button).toBeEnabled()
      await user.click(button)
      expect(scriptTags()).toHaveLength(1)
      // Settle the second load so it does not leak into the next test.
      scriptTags()[0]!.dispatchEvent(new Event('error'))
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
      rendered[0]!['error-callback']()

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

  describe('when the form stays open a long time', () => {
    // The server drops a token older than 30 minutes or younger than 1.5 s and still answers
    // success, so no email would come (config.subscribe.formTokenMaxAgeMs, minFormFillMs).
    const MINUTE = 60 * 1000
    const SERVER_MIN_AGE_MS = 1500

    let visibility: DocumentVisibilityState

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      visibility = 'visible'
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    })

    afterEach(() => {
      vi.useRealTimers()
      Reflect.deleteProperty(document, 'visibilityState')
    })

    /** Answers the token requests in turn, noting the (fake) time each token was issued. */
    function issueTokens(...tokens: string[]) {
      const issuedAt: Record<string, number> = {}
      mockGetToken.mockReset()
      for (const token of tokens) {
        mockGetToken.mockImplementationOnce(async () => {
          issuedAt[token] = Date.now()
          return { token }
        })
      }
      return issuedAt
    }

    /** Accepts every signup, noting the (fake) time each was posted. */
    function recordPosts() {
      const postedAt: number[] = []
      mockSubscribe.mockImplementation(async () => {
        postedAt.push(Date.now())
        return { success: true, message: 'ok' }
      })
      return postedAt
    }

    async function wait(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }

    /** Hides the tab for `awayMs`, then shows it again. */
    async function leaveAndReturn(awayMs: number) {
      visibility = 'hidden'
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await wait(awayMs)
      visibility = 'visible'
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    async function submit(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByPlaceholderText('you@example.com'), 'hello@example.com')
      await user.click(screen.getByRole('button', { name: /subscribe/i }))
    }

    it('posts a fresh token, old enough for the server, when the one it holds is 31 minutes old', async () => {
      const issuedAt = issueTokens('first-token', 'fresh-token')
      const postedAt = recordPosts()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderReady()

      await wait(31 * MINUTE)
      await submit(user)

      await waitFor(() => expect(mockGetToken).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('button', { name: /subscribing/i })).toBeDisabled()
      expect(mockSubscribe).not.toHaveBeenCalled()

      await wait(SERVER_MIN_AGE_MS)
      await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument())
      expect(mockSubscribe).toHaveBeenCalledWith({ email: 'hello@example.com', formToken: 'fresh-token' })
      expect(postedAt[0]! - issuedAt['fresh-token']!).toBeGreaterThanOrEqual(SERVER_MIN_AGE_MS)
    })

    it('posts the token it holds, asking for none, while that token is 24 minutes old', async () => {
      recordPosts()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderReady()

      await wait(24 * MINUTE)
      await submit(user)

      await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith({ email: 'hello@example.com', formToken: 'test-token' }))
      expect(mockGetToken).toHaveBeenCalledTimes(1)
    })

    it('fetches a fresh token when the reader comes back to the tab after 30 minutes, and posts it once old enough', async () => {
      const issuedAt = issueTokens('first-token', 'fresh-token')
      const postedAt = recordPosts()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderReady()

      await leaveAndReturn(31 * MINUTE)
      await waitFor(() => expect(mockGetToken).toHaveBeenCalledTimes(2))
      // Submitting at once: the fresh token is still too young for the server.
      await submit(user)
      await wait(SERVER_MIN_AGE_MS)

      await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument())
      expect(mockGetToken).toHaveBeenCalledTimes(2)
      expect(mockSubscribe).toHaveBeenCalledWith({ email: 'hello@example.com', formToken: 'fresh-token' })
      expect(postedAt[0]! - issuedAt['fresh-token']!).toBeGreaterThanOrEqual(SERVER_MIN_AGE_MS)
    })

    it('fetches a fresh token when the window gets focus back after 30 minutes', async () => {
      issueTokens('first-token', 'fresh-token')
      await renderReady()

      await wait(31 * MINUTE)
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      await waitFor(() => expect(mockGetToken).toHaveBeenCalledTimes(2))
    })

    it('asks for no new token when the reader comes back within minutes', async () => {
      await renderReady()

      await leaveAndReturn(5 * MINUTE)
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
      await wait(0)

      expect(mockGetToken).toHaveBeenCalledTimes(1)
    })

    it('says something went wrong, posting nothing, when no fresh token can be fetched', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await renderReady()
      mockGetToken.mockRejectedValue(new Error('API down'))

      await wait(31 * MINUTE)
      await submit(user)

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'))
      expect(mockSubscribe).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /^subscribe$/i })).toBeEnabled()
    })
  })

  describe('what a subscriber gets', () => {
    it('is said under the form and describes the email field', async () => {
      await renderReady()

      expect(screen.getByText(NEWSLETTER_PROMISE)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /email/i })).toHaveAccessibleDescription(NEWSLETTER_PROMISE)
    })

    it('is centered under the form’s own heading, and left-aligned in a parent’s column', async () => {
      const { unmount } = render(<SubscribeForm idPrefix="test" />)
      await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())
      expect(screen.getByText(NEWSLETTER_PROMISE)).toHaveClass('text-center')
      unmount()

      render(<SubscribeForm idPrefix="test" hideHeading />)
      await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())
      expect(screen.getByText(NEWSLETTER_PROMISE)).toHaveClass('text-left')
    })

    it('links past issues only when asked to, and reports the click', async () => {
      const onPastIssuesClick = vi.fn()
      const user = userEvent.setup()
      const { rerender } = render(
        <MemoryRouter>
          <SubscribeForm idPrefix="test" />
        </MemoryRouter>,
      )
      await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeEnabled())
      expect(screen.queryByRole('link', { name: /past issues/i })).not.toBeInTheDocument()

      rerender(
        <MemoryRouter>
          <SubscribeForm idPrefix="test" onPastIssuesClick={onPastIssuesClick} />
        </MemoryRouter>,
      )
      const link = screen.getByRole('link', { name: 'Read past issues' })
      expect(link.getAttribute('href')).toBe('/newsletter')
      await user.click(link)
      expect(onPastIssuesClick).toHaveBeenCalledTimes(1)
    })
  })
})
