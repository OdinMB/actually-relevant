import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import HomePage from './HomePage'
import { makeStory, announcedText } from '../test/stories'

const hero = makeStory({
  id: 'hero',
  slug: 'hero',
  title: 'Hero headline',
  titleLabel: 'Hero label',
  quote: 'Words from the hero story.',
  quoteAttribution: 'Dr. Hero',
  datePublished: '2026-09-22T00:00:00Z',
  issue: { id: 'i1', name: 'Human Development', slug: 'human-development' },
})
const card = makeStory({
  id: 'card',
  slug: 'card',
  title: 'Card headline',
  titleLabel: 'Card label',
  datePublished: '2026-09-21T00:00:00Z',
  issue: { id: 'i1', name: 'Human Development', slug: 'human-development' },
})
const other = makeStory({ id: 'other', slug: 'other', title: 'Other headline', titleLabel: 'Other label' })

vi.mock('../hooks/useHomepageData', () => ({
  useHomepageData: () => ({
    isLoading: false,
    data: {
      issues: [
        { id: 'i1', name: 'Human Development', slug: 'human-development' },
        { id: 'i2', name: 'Planet & Climate', slug: 'planet-climate' },
      ],
      storiesByIssue: {
        'human-development': { uplifting: [], calm: [hero, card], negative: [] },
        'planet-climate': { uplifting: [], calm: [other], negative: [] },
      },
    },
  }),
}))

vi.mock('../components/SubscribeProvider', () => ({
  useSubscribe: () => ({ openSubscribe: vi.fn() }),
}))

function renderHome() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('HomePage AI disclosure', () => {
  it('shows the "AI" badge next to the hero title label, above the headline', () => {
    const { container } = renderHome()
    const heroSection = container.querySelector<HTMLElement>('.hero-section')!
    const row = within(heroSection).getByText('Hero label').parentElement!
    expect(announcedText(row)).toBe('AI-generated Hero label')
    const headline = within(heroSection).getByRole('heading', { level: 1, name: 'Hero headline' })
    expect(row.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('follows the hero quote attribution with the AI selection note', () => {
    const { container } = renderHome()
    const heroSection = container.querySelector<HTMLElement>('.hero-section')!
    expect(within(heroSection).getByText('— Dr. Hero · selected and potentially translated by AI')).toBeInTheDocument()
  })

  it('badges every story card link', () => {
    renderHome()
    expect(screen.getByRole('link', { name: 'AI-generated Card label Card headline' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI-generated Other label Other headline' })).toBeInTheDocument()
  })

  it('shows the pull quote with the "Selected by AI" badge and the note', () => {
    const { container } = renderHome()
    const footer = container.querySelector('footer')!
    expect(announcedText(footer)).toMatch(/^Selected by AI — .+ · selected and potentially translated by AI$/)
  })
})
