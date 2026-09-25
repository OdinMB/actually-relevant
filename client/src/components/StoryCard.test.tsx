import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import StoryCard from './StoryCard'
import { makeStory, announcedText } from '../test/stories'

const VARIANTS = ['featured', 'compact', 'horizontal', 'equal'] as const

function renderCard(variant: (typeof VARIANTS)[number], story = makeStory()) {
  return render(
    <MemoryRouter>
      <StoryCard story={story} variant={variant} />
    </MemoryRouter>,
  )
}

describe('StoryCard AI badge', () => {
  it.each(VARIANTS)('%s: shows the "AI" badge next to the title label, announced as "AI-generated"', (variant) => {
    renderCard(variant)
    const row = screen.getByText('AI label').parentElement!
    // Visible: the "AI" abbreviation; announced: its full name, then the label
    expect(row.querySelector('[aria-hidden="true"]')?.textContent).toBe('AI')
    expect(announcedText(row)).toBe('AI-generated AI label')
  })

  it.each(VARIANTS)('%s: puts the badge in the story link, before the headline', (variant) => {
    renderCard(variant)
    expect(screen.getByRole('link', { name: 'AI-generated AI label AI headline' })).toHaveAttribute('href', '/stories/story-1')
  })

  it.each(VARIANTS)('%s: shows the badge even when the story has no title label', (variant) => {
    renderCard(variant, makeStory({ titleLabel: null, title: 'Headline without a label' }))
    expect(screen.getByRole('link', { name: 'AI-generated Headline without a label' })).toBeInTheDocument()
  })
})
