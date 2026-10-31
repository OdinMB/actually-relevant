import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import SubscribedPage from './SubscribedPage'
import { inAutomatedBrowser } from '../test/automatedBrowser'

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

/**
 * Waits until Helmet has written this state's head (its title), then returns the robots tag's content.
 * Helmet writes the title and the meta tags in one deferred update and leaves a title behind on
 * unmount, so the head is cleared before each test (beforeEach) and the title marks the update.
 */
async function robotsOnceHeadIs(title: string) {
  await waitFor(() => expect(document.title).toBe(title))
  return document.head.querySelector('meta[name="robots"]')?.getAttribute('content')
}

describe('SubscribedPage', () => {
  beforeEach(() => {
    mockConfirm.mockReset()
    document.title = ''
    document.head.querySelectorAll('meta[name="robots"]').forEach(tag => tag.remove())
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

  it.each([
    ['the plain page, as prerendered and on a direct visit', '/subscribed'],
    ['a link with a token but no address', '/subscribed?token=abc'],
    ['a link with an address but no token', '/subscribed?email=u%40example.com'],
  ])('claims nothing is confirmed without a token and an address: %s', (_case, path) => {
    renderAt(path)

    expect(screen.getByRole('heading', { level: 1, name: /confirm your subscription/i })).toBeInTheDocument()
    expect(screen.getByText('To finish subscribing to the weekly newsletter, open the link in your confirmation email.')).toBeInTheDocument()
    expect(screen.queryByText(/while this page loads/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /welcome to the newsletter/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm my subscription/i })).not.toBeInTheDocument()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('prerenders a loading view with noindex: the HTML the confirmation link shows until the script runs', async () => {
    await inAutomatedBrowser(async () => {
      renderAt('/subscribed')

      expect(screen.getByRole('heading', { level: 1, name: /confirm your subscription/i })).toBeInTheDocument()
      expect(screen.getByText("One moment while this page loads. If it doesn't change, open the link in your confirmation email again.")).toBeInTheDocument()
      expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /welcome to the newsletter/i })).not.toBeInTheDocument()
      expect(await robotsOnceHeadIs('Confirm Your Subscription - Actually Relevant')).toBe('noindex')
    })
  })

  it('shows the confirm button for a link with a token and an address in an automated browser too', async () => {
    await inAutomatedBrowser(async () => {
      renderAt('/subscribed?token=abc&email=u%40example.com')

      expect(screen.getByRole('button', { name: /confirm my subscription/i })).toBeInTheDocument()
      expect(screen.queryByText(/while this page loads/i)).not.toBeInTheDocument()
    })
  })

  it.each([
    ['the confirm step', '/subscribed?token=abc&email=u%40example.com', 'Confirm Your Subscription - Actually Relevant'],
    ['an expired link', '/subscribed?error=expired', 'Link Expired - Actually Relevant'],
    ['an invalid link', '/subscribed?error=invalid', 'Invalid Link - Actually Relevant'],
  ])('is noindex on %s', async (_case, path, title) => {
    renderAt(path)

    expect(await robotsOnceHeadIs(title)).toBe('noindex')
  })

  it('is noindex once confirmed', async () => {
    mockConfirm.mockResolvedValue({ success: true })
    const user = userEvent.setup()

    renderAt('/subscribed?token=abc&email=u%40example.com')
    await user.click(screen.getByRole('button', { name: /confirm my subscription/i }))

    expect(await robotsOnceHeadIs('Welcome to the Newsletter - Actually Relevant')).toBe('noindex')
  })
})
