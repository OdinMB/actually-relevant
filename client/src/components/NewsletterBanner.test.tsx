import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import NewsletterBanner from './NewsletterBanner'
import { NEWSLETTER_PROMISE } from '../config'
import { PositivityProvider } from '../contexts/PositivityContext'

const openSubscribe = vi.fn()
vi.mock('./SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe }),
}))

describe('NewsletterBanner', () => {
  it('says what a subscriber gets next to the button, which opens the signup', async () => {
    const user = userEvent.setup()
    render(<NewsletterBanner />)

    expect(screen.getByText('Don’t miss what’s actually relevant.')).toBeInTheDocument()
    expect(screen.getByText(NEWSLETTER_PROMISE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /get the newsletter/i }))
    expect(openSubscribe).toHaveBeenCalledTimes(1)
  })

  it('names the Actually Uplifting newsletter inside that edition', () => {
    render(
      <MemoryRouter initialEntries={['/uplifting']}>
        <PositivityProvider>
          <NewsletterBanner />
        </PositivityProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText('Actually Uplifting, once a week.')).toBeInTheDocument()
    expect(screen.queryByText('Don’t miss what’s actually relevant.')).not.toBeInTheDocument()
  })

  afterEach(() => localStorage.clear())
})
