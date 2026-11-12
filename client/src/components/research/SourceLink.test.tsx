import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ResearchedSource } from '@shared/types'
import { SourceLink } from './SourceLink'

const source = (over: Partial<ResearchedSource>): ResearchedSource => ({
  id: 'S1',
  origin: 'source',
  outlet: 'Coverage Outlet',
  host: 'coverage.example.org',
  url: 'https://coverage.example.org/a',
  title: 'Their headline',
  date: '2026-11-10',
  country: null,
  kind: null,
  storyId: null,
  slug: null,
  ...over,
})

function renderLink(s: ResearchedSource) {
  return render(
    <MemoryRouter>
      <SourceLink source={s} className="link">
        Their headline
      </SourceLink>
    </MemoryRouter>,
  )
}

describe('SourceLink', () => {
  it.each(['https://coverage.example.org/a', 'http://coverage.example.org/a'])('links an outside article at %s in a new tab', url => {
    renderLink(source({ url }))
    const link = screen.getByRole('link', { name: 'Their headline (opens in new tab)' })
    expect(link).toHaveAttribute('href', url)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', '//coverage.example.org/a', 'not a url'])(
    'never puts an address that is not http(s) in a link: %s',
    url => {
      const { container } = renderLink(source({ url }))
      expect(screen.queryByRole('link')).toBeNull()
      expect(container.querySelector('[href]')).toBeNull()
      expect(screen.getByText('Their headline')).toBeInTheDocument()
    },
  )

  it('links our earlier story by its slug, in the app', () => {
    renderLink(source({ id: 'E1', origin: 'earlier', host: null, url: null, storyId: 'story-0', slug: 'earlier story' }))
    expect(screen.getByRole('link', { name: 'Their headline' })).toHaveAttribute('href', '/stories/earlier%20story')
  })
})
