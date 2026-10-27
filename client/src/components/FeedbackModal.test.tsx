import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackModal from './FeedbackModal'
import { FORM_TOKEN_REFRESH_MS } from './FeedbackForm'

const mockApi = vi.hoisted(() => ({ getFeedbackToken: vi.fn(), submitFeedback: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

const STORY = { id: 'story-1', title: 'Air & Health: Cities cut smog' }

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
  mockApi.getFeedbackToken.mockResolvedValue({ token: 'form-token' })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

const onClose = vi.fn()
const modal = (open: boolean) => <FeedbackModal open={open} onClose={onClose} story={STORY} />

/** Let the refresh interval come round twice. */
async function waitTwoRefreshes() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FORM_TOKEN_REFRESH_MS * 2)
  })
}

describe('FeedbackModal', () => {
  it('requests no form token while closed, not even when the refresh interval comes round', async () => {
    render(modal(false))
    await waitTwoRefreshes()

    expect(mockApi.getFeedbackToken).not.toHaveBeenCalled()
  })

  it('fetches a token on open, keeps it fresh only while open, and fetches a new one on each reopen', async () => {
    const { rerender } = render(modal(true))
    expect(screen.getByRole('dialog', { name: 'Report an error' })).toBeInTheDocument()
    await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FORM_TOKEN_REFRESH_MS)
    })
    expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2)

    rerender(modal(false))
    await waitTwoRefreshes()
    expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(2)

    rerender(modal(true))
    await waitFor(() => expect(mockApi.getFeedbackToken).toHaveBeenCalledTimes(3))
  })

  it('is named by the form heading, and keeps that name once the thank-you replaces the form', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockApi.submitFeedback.mockResolvedValue({ success: true })
    render(modal(true))
    const dialog = screen.getByRole('dialog', { name: 'Report an error' })
    expect(within(dialog).getByRole('heading', { name: 'Report an error' })).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: 'What is wrong?' }), 'Wrong date')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Send report' })).toBeEnabled())
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }))
    expect(await within(dialog).findByRole('heading', { name: 'Thanks for your report!' })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName('Report an error')
  })

  it('is named "Send feedback" when no story is given', () => {
    render(<FeedbackModal open onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Send feedback' })
    expect(within(dialog).getByRole('heading', { name: 'Send feedback' })).toBeInTheDocument()
  })
})
