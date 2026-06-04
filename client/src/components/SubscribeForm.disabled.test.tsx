import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SubscribeForm from './SubscribeForm'

const mockGetToken = vi.fn()

vi.mock('../lib/api', () => ({
  publicApi: {
    subscribe: vi.fn(),
    getSubscribeToken: (...args: unknown[]) => mockGetToken(...args),
  },
}))

// Signups disabled (e.g. while the email provider account is suspended).
vi.mock('../config', () => ({
  BRAND: { claim: 'News that matters to humanity.', claimSupport: 'Curated with care by AI.' },
  SUBSCRIPTIONS_ENABLED: false,
}))

describe('SubscribeForm (signups disabled)', () => {
  it('shows a paused notice instead of the form and does not fetch a token', () => {
    render(<SubscribeForm idPrefix="test" />)

    expect(screen.getByText(/signups are paused/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument()
    expect(mockGetToken).not.toHaveBeenCalled()
  })

  it('renders the close action when onSuccess is provided', () => {
    const onSuccess = vi.fn()
    render(<SubscribeForm idPrefix="test" onSuccess={onSuccess} />)

    expect(screen.getByRole('button', { name: /got it/i })).toBeInTheDocument()
  })
})
