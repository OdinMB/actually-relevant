import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NavItems } from './AdminLayout'
import { feedbackBadge, noticeBadge } from './navBadges'

function renderNav(counts: { feedback?: number; notices?: { unseen: number; unseenCritical: number } }) {
  render(
    <MemoryRouter>
      <NavItems badgeCounts={{ feedback: feedbackBadge(counts.feedback), notices: noticeBadge(counts.notices) }} />
    </MemoryRouter>,
  )
}

describe('admin nav badges', () => {
  it('shows the unseen count on Notices, with the count in its accessible name', () => {
    renderNav({ notices: { unseen: 3, unseenCritical: 0 } })
    const link = screen.getByRole('link', { name: /Notices, 3 unseen/ })
    expect(link).toHaveTextContent('3')
    expect(link.querySelector('[data-critical]')).toBeNull()
  })

  it('turns the badge critical, and says so in words, while a critical notice is unseen', () => {
    renderNav({ notices: { unseen: 3, unseenCritical: 1 } })
    const link = screen.getByRole('link', { name: /Notices, 3 unseen, 1 critical/ })
    expect(link.querySelector('[data-critical]')).not.toBeNull()
  })

  it('shows no badge on Notices with nothing unseen, and keeps the Feedback badge', () => {
    renderNav({ feedback: 2, notices: { unseen: 0, unseenCritical: 0 } })
    expect(screen.getByRole('link', { name: /^Notices$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Feedback, 2 unread/ })).toHaveTextContent('2')
  })
})
