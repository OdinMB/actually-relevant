import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PullQuote from './PullQuote'
import { makeStory, announcedText } from '../test/stories'

function renderQuote(story = makeStory()) {
  return render(
    <MemoryRouter>
      <PullQuote story={story} />
    </MemoryRouter>,
  )
}

describe('PullQuote AI disclosure', () => {
  it('shows the "AI" badge, announced as "Selected by AI", and the note after the attribution', () => {
    const { container } = renderQuote()
    const footer = container.querySelector('footer')!
    expect(footer.querySelector('[aria-hidden="true"]')?.textContent).toBe('AI')
    expect(announcedText(footer)).toBe(
      'Selected by AI — Dr. Jane Doe, WHO, via AI headline · selected and potentially translated by AI',
    )
  })

  it('adds the note after the "from" attribution too', () => {
    const { container } = renderQuote(makeStory({ quoteAttribution: 'Original article' }))
    expect(announcedText(container.querySelector('footer')!)).toBe(
      'Selected by AI — from AI headline · selected and potentially translated by AI',
    )
  })

  it('shows the disclosure right under the quote, in the same block', () => {
    renderQuote()
    const quote = screen.getByText('A real person said this.')
    const footer = quote.closest('blockquote')!.nextElementSibling
    expect(footer?.tagName).toBe('FOOTER')
  })
})
