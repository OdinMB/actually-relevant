import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import AiBadge from './AiBadge'
import AiLabel from './AiLabel'
import SiteAiNotice from './SiteAiNotice'
import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

/** Text a screen reader announces: all text except subtrees hidden with aria-hidden. */
function announcedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return ''
  return Array.from(node.childNodes).map(announcedText).join('')
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

describe('AiBadge', () => {
  it('announces its full accessible name instead of the visible abbreviation', () => {
    const { container } = render(<AiBadge />)
    expect(normalized(announcedText(container))).toBe(AI_DISCLOSURE_COPY.badgeAccessibleName)
  })

  it('announces nothing when decorative, because visible text next to it already says it', () => {
    const { container } = render(<AiBadge decorative />)
    expect(normalized(announcedText(container))).toBe('')
  })

  it('shows the abbreviation visually in both modes', () => {
    const { container: standalone } = render(<AiBadge />)
    const { container: decorative } = render(<AiBadge decorative />)
    expect(standalone.textContent).toContain(AI_DISCLOSURE_COPY.badgeText)
    expect(decorative.textContent).toContain(AI_DISCLOSURE_COPY.badgeText)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<p>Headline <AiBadge /></p>)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('AiLabel', () => {
  it('announces the label once, not the badge and the label', () => {
    const { container } = render(<AiLabel />)
    expect(normalized(announcedText(container))).toBe(AI_DISCLOSURE_COPY.labelText)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<AiLabel />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('SiteAiNotice', () => {
  function renderNotice() {
    return render(
      <MemoryRouter>
        <SiteAiNotice />
      </MemoryRouter>,
    )
  }

  it('is exposed to assistive technology as a note', () => {
    renderNotice()
    const note = screen.getByRole('note')
    expect(note.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('announces the notice and the explainer link, without the decorative badge', () => {
    renderNotice()
    expect(normalized(announcedText(screen.getByRole('note')))).toBe(
      `${AI_DISCLOSURE_COPY.siteNotice} ${AI_DISCLOSURE_COPY.siteNoticeLinkText}`,
    )
  })

  it('links to the explainer page', () => {
    renderNotice()
    expect(screen.getByRole('link', { name: AI_DISCLOSURE_COPY.siteNoticeLinkText })).toHaveAttribute(
      'href',
      AI_DISCLOSURE_COPY.siteNoticeLinkHref,
    )
  })

  it('has no accessibility violations', async () => {
    const { container } = renderNotice()
    expect(await axe(container)).toHaveNoViolations()
  })
})
