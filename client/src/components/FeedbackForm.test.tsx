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

import FeedbackForm, { FORM_TOKEN_REFRESH_MS } from './FeedbackForm'

const STORY = { id: 'story-1', title: 'Air & Health: Cities cut smog' }

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

  it('keeps submit disabled until the form token has loaded', async () => {
    mockApi.getFeedbackToken.mockReturnValue(new Promise(() => {})) // never resolves
    render(<FeedbackForm />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')

    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
  })

  it('retries the token fetch once and submits the retried token', async () => {
    mockApi.getFeedbackToken.mockReset()
    mockApi.getFeedbackToken.mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({ token: 'retry-token' })
    render(<FeedbackForm />)
    await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2))

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'retry-token' }))
  })

  it('fetches a fresh form token before the old one expires, so a long message is not dropped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi.getFeedbackToken.mockResolvedValueOnce({ token: 'first-token' }).mockResolvedValueOnce({ token: 'second-token' })
    render(<FeedbackForm />)
    await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_TOKEN_REFRESH_MS)
    })
    await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2))

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Long thoughts')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ formToken: 'second-token' }))
  })

  it('shows the server refusal (a failed human check) instead of thanking the visitor', async () => {
    mockApi.submitFeedback.mockResolvedValue({ success: false, message: "We couldn't verify that you're human. Please try again." })
    render(<FeedbackForm />)
    await ready()

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("We couldn't verify that you're human"))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Nice site')
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
