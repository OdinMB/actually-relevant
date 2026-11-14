import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { InfoTip } from './InfoTip'

const NOTE = 'Runs every night and skips what is done.'

function renderTip() {
  render(
    <div>
      <button type="button">Before</button>
      <InfoTip label="About Crawl Feeds">{NOTE}</InfoTip>
      <p>Elsewhere</p>
    </div>,
  )
  return screen.getByRole('button', { name: 'About Crawl Feeds' })
}

const note = () => screen.getByRole('tooltip', { hidden: true })

describe('InfoTip', () => {
  it('is a button named for what it explains, described by the note, which stays hidden at rest', async () => {
    const { container } = render(<InfoTip label="About Crawl Feeds">{NOTE}</InfoTip>)
    const button = screen.getByRole('button', { name: 'About Crawl Feeds' })
    expect(button).toHaveAccessibleDescription(NOTE)
    expect(note()).not.toBeVisible()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('shows the note on keyboard focus, hides it on Escape and when focus leaves', async () => {
    const user = userEvent.setup()
    const button = renderTip()
    await user.tab()
    await user.tab()
    expect(button).toHaveFocus()
    expect(note()).toBeVisible()

    await user.keyboard('{Escape}')
    expect(note()).not.toBeVisible()

    await user.keyboard('{Enter}')
    expect(note()).toBeVisible()
    await user.tab({ shift: true })
    expect(note()).not.toBeVisible()
  })

  it('shows the note while hovered', async () => {
    const user = userEvent.setup()
    const button = renderTip()
    await user.hover(button)
    expect(note()).toBeVisible()
    await user.unhover(button)
    expect(note()).not.toBeVisible()
  })

  it('toggles the note on a click or tap, which keeps it open without hover, until a second one, a tap elsewhere or Escape', async () => {
    const user = userEvent.setup()
    const button = renderTip()

    await user.click(button)
    await user.unhover(button)
    expect(note()).toBeVisible()
    await user.click(button)
    expect(note()).not.toBeVisible()

    await user.click(button)
    await user.click(screen.getByText('Elsewhere'))
    expect(note()).not.toBeVisible()

    await user.click(button)
    await user.keyboard('{Escape}')
    expect(note()).not.toBeVisible()
  })

  it('closes on a tap elsewhere when the tap gave the button no focus (Safari on touch)', () => {
    const button = renderTip()
    fireEvent.click(button)
    expect(button).not.toHaveFocus()
    expect(note()).toBeVisible()

    fireEvent.pointerDown(note())
    expect(note()).toBeVisible()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    expect(note()).not.toBeVisible()
  })
})
