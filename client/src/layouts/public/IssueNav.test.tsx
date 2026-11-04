import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import IssueNav from './IssueNav'
import { ISSUE_LINKS } from './navLinks'
import { contrastRatio } from '../../test/contrast'

function renderNavAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <IssueNav searchOpen={false} onToggleSearch={vi.fn()} />
    </MemoryRouter>,
  )
  return within(screen.getByRole('navigation', { name: 'Issue categories' }))
}

describe('IssueNav', () => {
  it.each(ISSUE_LINKS)('on $href, marks $label as the current page and only it', ({ href, label }) => {
    const nav = renderNavAt(href)
    expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(nav.getAllByRole('link').filter(link => link.hasAttribute('aria-current'))).toHaveLength(1)
  })

  // The tab is 14px bold, not large text: its color on the white bar needs 4.5:1, where the hue itself is 1.7:1 to 3:1
  it.each(ISSUE_LINKS)('colors the $label tab, when active or hovered, at 4.5:1 or more on white', ({ href, label }) => {
    const nav = renderNavAt(href)
    const textColor = nav.getByRole('link', { name: label }).style.getPropertyValue('--issue-text-color')
    expect(contrastRatio(textColor, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
