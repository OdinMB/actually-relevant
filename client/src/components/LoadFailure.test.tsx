import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import LoadFailure from './LoadFailure'

function query(overrides: Partial<{ refetch: () => unknown; isFetching: boolean; errorUpdatedAt: number }> = {}) {
  return { refetch: vi.fn(), isFetching: false, errorUpdatedAt: 1, ...overrides }
}

describe('LoadFailure', () => {
  it('says what could not load, and why it may have, in an alert', () => {
    render(<LoadFailure title="This story couldn't load" query={query()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toContainElement(screen.getByRole('heading', { level: 1, name: "This story couldn't load" }))
    expect(alert).toHaveTextContent('The connection may have dropped, or the site is busy right now. Please try again.')
  })

  it('heads one part of a page with an h2', () => {
    render(<LoadFailure title="The stories couldn't load" headingLevel={2} query={query()} />)
    expect(screen.getByRole('heading', { level: 2, name: "The stories couldn't load" })).toBeInTheDocument()
  })

  it('says what to do instead of the usual line when given a hint', () => {
    render(<LoadFailure title="The search results couldn't load" hint="Please try again in a few minutes." query={query()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Please try again in a few minutes.')
    expect(alert).not.toHaveTextContent('The connection may have dropped')
  })

  it('heads a list inside a section that has its own h2 with an h3', () => {
    render(<LoadFailure title="The episodes couldn't load" headingLevel={3} query={query()} />)
    expect(screen.getByRole('heading', { level: 3, name: "The episodes couldn't load" })).toBeInTheDocument()
  })

  it('asks the query again when "Try again" is pressed, without reloading the page', async () => {
    const q = query()
    render(<LoadFailure title="This story couldn't load" query={q} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(q.refetch).toHaveBeenCalledTimes(1)
  })

  it('says it is trying again while the query runs', () => {
    render(<LoadFailure title="This story couldn't load" query={query({ isFetching: true })} />)
    expect(screen.getByRole('button', { name: 'Trying again...' })).toBeInTheDocument()
  })

  it('announces a failed retry again, leaving focus on the button', async () => {
    const { rerender } = render(<LoadFailure title="This story couldn't load" query={query({ errorUpdatedAt: 1 })} />)
    const firstAlert = screen.getByRole('alert')
    const button = screen.getByRole('button', { name: 'Try again' })
    button.focus()

    rerender(<LoadFailure title="This story couldn't load" query={query({ errorUpdatedAt: 2 })} />)

    // A new alert element: screen readers announce an alert when it is inserted
    expect(screen.getByRole('alert')).not.toBe(firstAlert)
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(button)
    expect(button).toHaveFocus()
  })

  it('takes further links after the button', () => {
    render(
      <LoadFailure title="This story couldn't load" query={query()}>
        <a href="/">Back to home</a>
      </LoadFailure>,
    )
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(button.compareDocumentPosition(screen.getByRole('link', { name: 'Back to home' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<LoadFailure title="This story couldn't load" query={query()} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
