import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import type { TurnstileRenderOptions } from '../lib/turnstile'

const mockApi = vi.hoisted(() => ({ submitFeedback: vi.fn(), getFeedbackToken: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import FeedbackForm from './FeedbackForm'
import { fieldBorderProblems, fieldFocusProblems } from '../test/classes'

const STORY = { id: 'story-1', title: 'Air & Health: Cities cut smog' }

const FEEDBACK_UNAVAILABLE = "Feedback can't be sent right now. Please reload the page or try again later."
const REPORT_UNAVAILABLE = "Reports can't be sent right now. Please reload the page or try again later."

/** Matches text that begins with `prefix`. */
const startsWith = (prefix: string) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

// Cloudflare's script is never fetched in tests: a stand-in API is installed when the
// injected <script> tag is made to fire `load` (as in SubscribeForm.test.tsx).
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

/** Wait until the form token has been fetched and stored (submit is disabled until then). */
async function ready() {
  await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalled())
  await act(async () => {})
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.submitFeedback.mockResolvedValue({ success: true })
  mockApi.getFeedbackToken.mockResolvedValue({ token: 'form-token' })
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  delete window.turnstile
  scriptTags().forEach(s => s.remove())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  delete window.turnstile
})

describe('FeedbackForm', () => {
  it('offers the general categories, not the story correction, when no story is given', async () => {
    render(<FeedbackForm />)
    expect(screen.getByRole('heading', { name: 'Send feedback' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['general', 'bug', 'suggestion', 'other'])
    await ready()

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith({ category: 'general', message: 'Nice site', formToken: 'form-token' })
  })

  it('reports an error in a story: names the story, asks no category, and sends a correction with its id', async () => {
    render(<FeedbackForm story={STORY} idPrefix="feedback-modal" />)
    expect(screen.getByRole('heading', { name: 'Report an error' })).toBeInTheDocument()
    expect(screen.getByText(STORY.title)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toEqual([])
    await ready()

    await userEvent.type(screen.getByRole('textbox', { name: 'What is wrong?' }), 'The date is wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith({ category: 'correction', message: 'The date is wrong', storyId: 'story-1', formToken: 'form-token' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thanks for your report!'))
  })

  it('keeps submit disabled until the form token has loaded, without a message meanwhile', async () => {
    mockApi.getFeedbackToken.mockReturnValue(new Promise(() => {})) // never resolves
    render(<FeedbackForm />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')

    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('retries the token fetch once and submits the retried token', async () => {
    mockApi.getFeedbackToken.mockReset()
    mockApi.getFeedbackToken.mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({ token: 'retry-token' })
    render(<FeedbackForm />)
    await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'retry-token' }))
  })

  describe('when both token attempts fail', () => {
    /** Render with an API that refuses every token request, and wait until both attempts have settled. */
    async function renderUnreachable(props: { story?: typeof STORY } = {}) {
      mockApi.getFeedbackToken.mockReset()
      mockApi.getFeedbackToken.mockImplementation(() => Promise.reject(new Error('API down')))
      const rendered = render(<FeedbackForm idPrefix="test" {...props} />)
      await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2))
      await act(() => new Promise(resolve => setTimeout(resolve, 0)))
      return rendered
    }

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'webdriver')
    })

    it('says plainly that feedback cannot be sent, announced and describing the message field, with submit disabled', async () => {
      await renderUnreachable()

      expect(screen.getByRole('status')).toHaveTextContent(FEEDBACK_UNAVAILABLE)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
      const message = screen.getByRole('textbox', { name: 'Message' })
      expect(message.getAttribute('aria-describedby')?.split(' ')[0]).toBe('test-unavailable')
      expect(message).toHaveAccessibleDescription(startsWith(FEEDBACK_UNAVAILABLE))
    })

    it('says the same of a report on a story', async () => {
      await renderUnreachable({ story: STORY })

      expect(screen.getByRole('status')).toHaveTextContent(REPORT_UNAVAILABLE)
      expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled()
      expect(screen.getByRole('textbox', { name: 'What is wrong?' })).toHaveAccessibleDescription(startsWith(REPORT_UNAVAILABLE))
    })

    it('says nothing while prerendering, so the static /feedback page never carries the message', async () => {
      Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
      await renderUnreachable()

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('aria-describedby')).not.toContain('test-unavailable')
    })

    it('has no detectable accessibility violations', async () => {
      const { container } = await renderUnreachable()
      expect(await axe(container)).toHaveNoViolations()
    })
  })

  it('shows the server refusal (a failed human check) instead of thanking the visitor', async () => {
    mockApi.submitFeedback.mockResolvedValue({ success: false, message: "We couldn't verify that you're human. Please try again." })
    render(<FeedbackForm />)
    await ready()

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("We couldn't verify that you're human"))
    expect(screen.queryByRole('heading', { name: /^Thanks for your/ })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Nice site')
  })

  describe('when the form stays open a long time', () => {
    // The server drops a token older than 30 minutes or younger than 1.5 s and still answers
    // success, storing nothing (config.subscribe.formTokenMaxAgeMs, minFormFillMs).
    const MINUTE = 60 * 1000
    const SERVER_MIN_AGE_MS = 1500

    let visibility: DocumentVisibilityState

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      visibility = 'visible'
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    })

    afterEach(() => {
      Reflect.deleteProperty(document, 'visibilityState')
    })

    /** Answers the token requests in turn, noting the (fake) time each token was issued. */
    function issueTokens(...tokens: string[]) {
      const issuedAt: Record<string, number> = {}
      mockApi.getFeedbackToken.mockReset()
      for (const token of tokens) {
        mockApi.getFeedbackToken.mockImplementationOnce(async () => {
          issuedAt[token] = Date.now()
          return { token }
        })
      }
      return issuedAt
    }

    /** Accepts every report, noting the (fake) time each was posted. */
    function recordPosts() {
      const postedAt: number[] = []
      mockApi.submitFeedback.mockImplementation(async () => {
        postedAt.push(Date.now())
        return { success: true }
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

    async function renderStoryReport() {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<FeedbackForm story={STORY} />)
      await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(1))
      await wait(0)
      return user
    }

    async function sendReport(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByRole('textbox', { name: 'What is wrong?' }), 'The date is wrong')
      await user.click(screen.getByRole('button', { name: 'Send report' }))
    }

    // A phone keeps a background tab's timers stopped, so the token can be this old on return.
    it('sends a fresh token, old enough for the server, when the one it holds is 31 minutes old', async () => {
      const issuedAt = issueTokens('first-token', 'fresh-token')
      const postedAt = recordPosts()
      const user = await renderStoryReport()

      await wait(31 * MINUTE)
      await sendReport(user)

      await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
      expect(mockApi.submitFeedback).not.toHaveBeenCalled()

      await wait(SERVER_MIN_AGE_MS)
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Thanks for your report!' })).toBeInTheDocument())
      expect(mockApi.submitFeedback).toHaveBeenCalledWith({
        category: 'correction',
        message: 'The date is wrong',
        storyId: 'story-1',
        formToken: 'fresh-token',
      })
      expect(postedAt[0]! - issuedAt['fresh-token']!).toBeGreaterThanOrEqual(SERVER_MIN_AGE_MS)
    })

    it('sends the token it holds, asking for none, while that token is 24 minutes old', async () => {
      recordPosts()
      const user = await renderStoryReport()

      await wait(24 * MINUTE)
      await sendReport(user)

      await waitFor(() => expect(mockApi.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'form-token' })))
      expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(1)
    })

    it('fetches a fresh token when the reader comes back to the tab after 21 minutes, and sends it once old enough', async () => {
      const issuedAt = issueTokens('first-token', 'fresh-token')
      const postedAt = recordPosts()
      const user = await renderStoryReport()

      await leaveAndReturn(21 * MINUTE)
      await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2))
      // Sending at once: the fresh token is still too young for the server.
      await sendReport(user)
      await wait(SERVER_MIN_AGE_MS)

      await waitFor(() => expect(screen.getByRole('heading', { name: 'Thanks for your report!' })).toBeInTheDocument())
      expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2)
      expect(mockApi.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'fresh-token' }))
      expect(postedAt[0]! - issuedAt['fresh-token']!).toBeGreaterThanOrEqual(SERVER_MIN_AGE_MS)
    })

    it('says something went wrong, sending nothing and keeping the report, when no fresh token can be fetched', async () => {
      const user = await renderStoryReport()
      mockApi.getFeedbackToken.mockRejectedValue(new Error('API down'))

      await wait(31 * MINUTE)
      await sendReport(user)

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.'))
      expect(mockApi.submitFeedback).not.toHaveBeenCalled()
      expect(screen.queryByRole('heading', { name: 'Thanks for your report!' })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'What is wrong?' })).toHaveValue('The date is wrong')
      expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled()
    })
  })

  it('has no detectable accessibility violations in either form', async () => {
    const { container, unmount } = render(<FeedbackForm />)
    await ready()
    expect(await axe(container)).toHaveNoViolations()
    unmount()
    const bound = render(<FeedbackForm story={STORY} />)
    await ready()
    expect(await axe(bound.container)).toHaveNoViolations()
  })

  it('rings the message and email fields on focus in a brand shade that reaches 3:1 against white', async () => {
    render(<FeedbackForm />)
    await ready()
    for (const name of ['Message', 'Email (optional)']) {
      expect(fieldFocusProblems(screen.getByRole('textbox', { name })), name).toEqual([])
    }
  })

  it('outlines the message and email fields at rest in a grey that reaches 3:1 against the page and their fill', async () => {
    render(<FeedbackForm />)
    await ready()
    for (const name of ['Message', 'Email (optional)']) {
      expect(fieldBorderProblems(screen.getByRole('textbox', { name })), name).toEqual([])
    }
  })

  describe('with Turnstile configured', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
    })

    it('requests nothing from Cloudflare on render or typing', async () => {
      render(<FeedbackForm />)
      await ready()
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')

      expect(scriptTags()).toHaveLength(0)
    })

    it('runs the challenge on submit and posts its token', async () => {
      const { api, rendered } = stubTurnstile()
      window.turnstile = api
      render(<FeedbackForm story={STORY} />)
      await ready()

      await userEvent.type(screen.getByRole('textbox', { name: 'What is wrong?' }), 'Wrong date')
      await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

      expect(screen.getByRole('button', { name: 'Verifying...' })).toBeDisabled()
      await waitFor(() => expect(api.execute).toHaveBeenCalled())
      expect(mockApi.submitFeedback).not.toHaveBeenCalled()
      act(() => rendered[0]!.callback('ts-token'))

      await waitFor(() =>
        expect(mockApi.submitFeedback).toHaveBeenCalledWith({
          category: 'correction',
          message: 'Wrong date',
          storyId: 'story-1',
          formToken: 'form-token',
          turnstileToken: 'ts-token',
        }),
      )
    })

    it('shows the human-check error, tied to the button, when the challenge fails, and keeps the form usable', async () => {
      const { api, rendered } = stubTurnstile()
      window.turnstile = api
      const { container } = render(<FeedbackForm />)
      await ready()

      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
      await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
      await waitFor(() => expect(rendered).toHaveLength(1))
      act(() => rendered[0]!['error-callback']())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("The human check couldn't load. Please press Send feedback to try again.")
      const button = screen.getByRole('button', { name: 'Send feedback' })
      expect(button).toBeEnabled()
      expect(button.getAttribute('aria-describedby')).toContain(alert.id)
      expect(mockApi.submitFeedback).not.toHaveBeenCalled()
      expect(await axe(container)).toHaveNoViolations()
    })
  })
})
