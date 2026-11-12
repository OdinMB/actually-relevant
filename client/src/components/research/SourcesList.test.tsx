import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ResearchedSource } from '@shared/types'
import { announcedText } from '../../test/stories'
import { SourcesList } from './SourcesList'

const source = (over: Partial<ResearchedSource> & Pick<ResearchedSource, 'id' | 'origin' | 'outlet'>): ResearchedSource => ({
  host: null,
  url: null,
  title: `Headline of ${over.id}`,
  date: '2026-11-10',
  country: null,
  kind: null,
  storyId: null,
  slug: null,
  ...over,
})

describe('SourcesList', () => {
  it("carries the AI badge before our earlier story's AI headline, outside its link, and never before an outlet's own headline", () => {
    render(
      <MemoryRouter>
        <SourcesList
          sources={[
            source({ id: 'S0', origin: 'original', outlet: 'Example Feed', host: 'example.com', url: 'https://example.com/a' }),
            source({ id: 'S1', origin: 'source', outlet: 'Coverage Outlet', host: 'coverage.example.org', url: 'https://coverage.example.org/a' }),
            source({ id: 'E1', origin: 'earlier', outlet: 'Actually Relevant', title: 'Our earlier headline', storyId: 'story-0', slug: 'earlier-story' }),
          ]}
        />
      </MemoryRouter>,
    )
    const headlines = screen.getAllByRole('listitem').map(item => announcedText(item.querySelectorAll('p')[1]!))
    expect(headlines).toEqual(['Headline of S0 (opens in new tab)', 'Headline of S1 (opens in new tab)', 'AI-generated Our earlier headline'])
    expect(within(screen.getAllByRole('listitem')[2]!).getByRole('link', { name: 'Our earlier headline' })).toHaveAttribute('href', '/stories/earlier-story')
  })
})
