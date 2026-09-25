import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import AiBadge from './AiBadge'
import AiLabel from './AiLabel'
import SiteAiNotice from './SiteAiNotice'
import { quoteAttributionLine } from './aiDisclosureCopy'
import { announcedText } from '../../test/stories'

describe('AiBadge', () => {
  it('shows "AI" and announces "AI-generated" instead of the abbreviation', () => {
    const { container } = render(<AiBadge />)
    expect(container.textContent).toContain('AI')
    expect(announcedText(container)).toBe('AI-generated')
  })

  it('announces a custom accessible name, such as "Selected by AI" on quotes', () => {
    const { container } = render(<AiBadge accessibleName="Selected by AI" />)
    expect(announcedText(container)).toBe('Selected by AI')
  })

  it('announces nothing when decorative, because visible text next to it already says it', () => {
    const { container } = render(<AiBadge decorative />)
    expect(container.textContent).toBe('AI')
    expect(announcedText(container)).toBe('')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<p>Headline <AiBadge /></p>)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('AiLabel', () => {
  it('shows the badge and the label text, and announces the text once', () => {
    const { container } = render(<AiLabel text="AI-generated summary and analysis" />)
    expect(container.textContent).toBe('AIAI-generated summary and analysis')
    expect(announcedText(container)).toBe('AI-generated summary and analysis')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<AiLabel text="AI-generated summary and analysis" />)
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

  it('is a note exposed to assistive technology, with the approved text and the explainer link', () => {
    renderNotice()
    const note = screen.getByRole('note')
    expect(note.closest('[aria-hidden="true"]')).toBeNull()
    expect(note.textContent).toBe('AIWritten and curated with care by AI. How it works')
    expect(announcedText(note)).toBe('Written and curated with care by AI. How it works')
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/methodology')
  })

  it('has no accessibility violations', async () => {
    const { container } = renderNotice()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('quoteAttributionLine', () => {
  it('follows the attribution with the AI selection note', () => {
    expect(quoteAttributionLine('Dr. Jane Doe, WHO')).toBe(
      '— Dr. Jane Doe, WHO · selected and potentially translated by AI',
    )
  })

  it('shows the note on its own when a quote has no attribution', () => {
    expect(quoteAttributionLine(null)).toBe('Selected and potentially translated by AI')
  })
})
