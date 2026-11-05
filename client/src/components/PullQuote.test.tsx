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
  it('puts the "AI" badge inline in the note after the attribution, as the line\'s only "AI"', () => {
    const { container } = renderQuote()
    const footer = container.querySelector('footer')!
    expect(footer.querySelector('[aria-hidden="true"]')?.textContent).toBe('AI')
    expect(footer.textContent?.startsWith('—')).toBe(true)
    expect(announcedText(footer)).toBe('— Dr. Jane Doe, WHO, quoted in “AI headline” · chosen by AI, may be translated')
  })

  it('adds the note after the "from" attribution too', () => {
    const { container } = renderQuote(makeStory({ quoteAttribution: 'Original article' }))
    expect(announcedText(container.querySelector('footer')!)).toBe('— from AI headline · chosen by AI, may be translated')
  })

  it('shows the disclosure right under the quote, in the same block', () => {
    renderQuote()
    const quote = screen.getByText('A real person said this.')
    const footer = quote.closest('blockquote')!.nextElementSibling
    expect(footer?.tagName).toBe('FOOTER')
  })
})
