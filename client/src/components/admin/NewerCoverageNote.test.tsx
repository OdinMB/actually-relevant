import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import type { StoryNewerCoverage } from '@shared/types'
import { focusRingProblems } from '../../test/classes'
import { NewerCoverageNote } from './NewerCoverageNote'
import { backLink } from './storyReturn'

/** The story's page, as far as the link goes: the back link it would show. */
function StoryPageStub() {
  const back = backLink(useLocation().state)
  return (
    <output data-testid="arrived">
      {back.label}: {back.to}
    </output>
  )
}

const newer: StoryNewerCoverage['newer'] = [
  { id: 'later-1', title: 'US orders blockade of Iranian ports', publisher: 'Wire A', reportedAt: '2026-10-29T10:00:00Z', reason: 'same_event' },
  { id: 'later-2', title: 'Death toll rises to 75', publisher: 'Paper B', reportedAt: '2026-10-28T10:00:00Z', reason: 'same_source' },
]

const renderNote = (stories: StoryNewerCoverage['newer']) =>
  render(
    <MemoryRouter>
      <NewerCoverageNote newer={stories} />
    </MemoryRouter>,
  )

describe('NewerCoverageNote', () => {
  it('links each newer story to its admin page, with its publisher, date and why it counts', () => {
    renderNote(newer)

    expect(screen.getByText(/Newer coverage/)).toBeInTheDocument()
    const first = screen.getByRole('link', { name: 'US orders blockade of Iranian ports' })
    expect(first).toHaveAttribute('href', '/admin/stories/later-1')
    expect(focusRingProblems(first)).toEqual([])
    expect(screen.getByRole('link', { name: 'Death toll rises to 75' })).toHaveAttribute('href', '/admin/stories/later-2')
    // The year shows only outside the current one
    expect(screen.getByText(/^\(Wire A, Oct 29(, 2026)?, same event\)$/)).toBeInTheDocument()
    expect(screen.getByText(/^\(Paper B, Oct 28(, 2026)?, same publisher\)$/)).toBeInTheDocument()
  })

  it('opens a newer story’s page with the way back to the newsletter it was opened from', async () => {
    const router = createMemoryRouter(
      [
        { path: '/admin/newsletters/:id', element: <NewerCoverageNote newer={newer} /> },
        { path: '/admin/stories/:id', element: <StoryPageStub /> },
      ],
      { initialEntries: ['/admin/newsletters/n-1'] },
    )
    render(<RouterProvider router={router} />)
    await userEvent.click(screen.getByRole('link', { name: 'Death toll rises to 75' }))
    expect(screen.getByTestId('arrived')).toHaveTextContent('Back to newsletter: /admin/newsletters/n-1')
  })

  it('renders nothing without newer stories', () => {
    const { container } = renderNote([])
    expect(container).toBeEmptyDOMElement()
  })
})
