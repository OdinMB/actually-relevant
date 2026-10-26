import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewsletterBanner from './NewsletterBanner'
import { NEWSLETTER_PROMISE } from '../config'

const openSubscribe = vi.fn()
vi.mock('./SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe }),
}))

describe('NewsletterBanner', () => {
  it('says what a subscriber gets next to the button, which opens the signup', async () => {
    const user = userEvent.setup()
    render(<NewsletterBanner />)

    expect(screen.getByText(NEWSLETTER_PROMISE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /get the newsletter/i }))
    expect(openSubscribe).toHaveBeenCalledTimes(1)
  })
})
