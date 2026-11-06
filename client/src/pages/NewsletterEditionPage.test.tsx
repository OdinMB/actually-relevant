import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { axe } from 'vitest-axe'
import NewsletterEditionPage from './NewsletterEditionPage'
import { ApiError } from '../lib/api'
import { inPrerenderer } from '../test/prerenderer'

const mockSwitch = vi.fn()

vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: { switchEdition: (...args: unknown[]) => mockSwitch(...args) },
}))

const openSubscribe = vi.hoisted(() => vi.fn())
vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe }),
}))

const TO_UPLIFTING = '/newsletter-edition?c=contact-1&to=uplifting'

function renderAt(path: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <NewsletterEditionPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('NewsletterEditionPage', () => {
  beforeEach(() => {
    mockSwitch.mockReset()
    openSubscribe.mockReset()
    document.title = ''
    document.head.querySelectorAll('meta[name="robots"]').forEach(tag => tag.remove())
  })

  it('switches nobody on load: it posts only when the button is clicked', async () => {
    mockSwitch.mockResolvedValue({ success: true, edition: 'uplifting' })
    const user = userEvent.setup()
    renderAt(TO_UPLIFTING)

    expect(screen.getByRole('heading', { level: 1, name: 'Get Actually Uplifting instead?' })).toBeInTheDocument()
    // Time for a request on load to be made, were one made
    await act(() => new Promise(resolve => setTimeout(resolve, 20)))
    expect(mockSwitch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Switch to Actually Uplifting' }))
    expect(mockSwitch).toHaveBeenCalledWith({ contactId: 'contact-1', edition: 'uplifting' })
    const done = await screen.findByRole('heading', { level: 1, name: "You'll get Actually Uplifting from the next issue." })
    expect(done).toHaveFocus()
  })

  it('switches back with one more click, to the other edition', async () => {
    mockSwitch.mockImplementation(async ({ edition }: { edition: string }) => ({ success: true, edition }))
    const user = userEvent.setup()
    renderAt(TO_UPLIFTING)

    await user.click(screen.getByRole('button', { name: 'Switch to Actually Uplifting' }))
    await user.click(await screen.findByRole('button', { name: 'Switch back' }))

    expect(mockSwitch).toHaveBeenLastCalledWith({ contactId: 'contact-1', edition: 'full' })
    expect(await screen.findByRole('heading', { level: 1, name: "You'll get the full picture from the next issue." })).toHaveFocus()
  })

  it('offers the full picture from an Actually Uplifting issue', async () => {
    mockSwitch.mockResolvedValue({ success: true, edition: 'full' })
    const user = userEvent.setup()
    renderAt('/newsletter-edition?c=contact-1&to=full')

    expect(screen.getByRole('heading', { level: 1, name: 'Get the full picture instead?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Switch to the full picture' }))
    expect(mockSwitch).toHaveBeenCalledWith({ contactId: 'contact-1', edition: 'full' })
  })

  it.each([
    ['closed', 409, "Switching editions isn't available right now. You keep getting the newsletter you have.", false],
    ['broken_link', 400, "This link is broken, and we've been told. The link in your next issue will work.", false],
    ['unknown_contact', 404, "We couldn't find a subscription for this link. Subscribe again to choose your edition.", true],
    ['not_subscribed', 409, "This address isn't subscribed anymore, so there's nothing to switch. Subscribe again to choose your edition.", true],
  ])('says why when the server refuses (%s), without the switch button', async (code, status, message, subscribeAgain) => {
    mockSwitch.mockRejectedValue(new ApiError(status, 'refused', code))
    const user = userEvent.setup()
    renderAt(TO_UPLIFTING)

    await user.click(screen.getByRole('button', { name: 'Switch to Actually Uplifting' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Switch to Actually Uplifting' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Subscribe again' }) !== null).toBe(subscribeAgain)
    if (subscribeAgain) {
      await user.click(screen.getByRole('button', { name: 'Subscribe again' }))
      expect(openSubscribe).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the button to try again after a network failure or a rate limit', async () => {
    mockSwitch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ success: true, edition: 'uplifting' })
    const user = userEvent.setup()
    renderAt(TO_UPLIFTING)

    await user.click(screen.getByRole('button', { name: 'Switch to Actually Uplifting' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    await user.click(screen.getByRole('button', { name: 'Switch to Actually Uplifting' }))
    expect(await screen.findByRole('heading', { level: 1, name: "You'll get Actually Uplifting from the next issue." })).toBeInTheDocument()
  })

  it.each([
    ['no contact id', '/newsletter-edition?to=uplifting'],
    ['no edition', '/newsletter-edition?c=contact-1'],
    ['an edition that does not exist', '/newsletter-edition?c=contact-1&to=cheerful'],
  ])('offers no switch for a link with %s, and points to the issue footer', (_, path) => {
    renderAt(path)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('To switch editions, open the link at the end of any issue of the newsletter.')).toBeInTheDocument()
  })

  it('is never indexed', async () => {
    renderAt(TO_UPLIFTING)
    await waitFor(() => expect(document.title).toBe('Switch Newsletter Edition - Actually Relevant'))
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
  })

  it('prerenders a neutral loading line, never a switch button or an instruction', async () => {
    await inPrerenderer(async () => {
      renderAt('/newsletter-edition')
      expect(screen.getByText("One moment while this page loads. If it doesn't change, open the link in your newsletter again.")).toBeInTheDocument()
      expect(screen.queryByRole('button')).toBeNull()
    })
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = renderAt(TO_UPLIFTING)
    expect(await axe(container)).toHaveNoViolations()
  })
})
