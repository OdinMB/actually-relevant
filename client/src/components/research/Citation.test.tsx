import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { MemoryRouter } from 'react-router-dom'
import type { ResearchCitation, ResearchedSource } from '@shared/types'
import { announcedText } from '../../test/stories'
import { Citation, type SourcesById } from './Citation'

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

const SOURCES: SourcesById = new Map(
  [
    source({ id: 'S1', origin: 'source', outlet: 'Coverage Outlet', host: 'coverage.example.org', url: 'https://coverage.example.org/a' }),
    source({ id: 'S2', origin: 'source', outlet: 'Odd Outlet', url: 'javascript:alert(1)' }),
    source({ id: 'E1', origin: 'earlier', outlet: 'Actually Relevant', title: 'Our earlier headline', storyId: 'story-0', slug: 'earlier-story' }),
  ].map(s => [s.id, s]),
)

function renderCitation(citations: ResearchCitation[]) {
  return render(
    <MemoryRouter>
      <p>
        A cited sentence. <Citation citations={citations} sources={SOURCES} />
      </p>
      <button type="button">Next on the page</button>
    </MemoryRouter>,
  )
}

async function openCard(name: string) {
  const button = screen.getByRole('button', { name })
  await userEvent.click(button)
  return { button, card: await screen.findByRole('dialog', { name: /^Sources? for this sentence$/ }) }
}

describe('Citation', () => {
  it('moves focus into its card when it opens, and Esc closes the card and returns focus to the button', async () => {
    renderCitation([
      { sourceId: 'S1', sentence: 'The coverage sentence.' },
      { sourceId: 'E1', sentence: 'The earlier sentence.' },
    ])
    const { button, card } = await openCard('Sources: Coverage Outlet, Actually Relevant')
    expect(card).toHaveAccessibleName('Sources for this sentence')
    expect(card).toContainElement(document.activeElement as HTMLElement)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(button).toHaveFocus()
  })

  it('names a one-source card in the singular', async () => {
    renderCitation([{ sourceId: 'S1', sentence: null }])
    const { card } = await openCard('Source: Coverage Outlet')
    expect(card).toHaveAccessibleName('Source for this sentence')
  })

  it("marks our earlier story's sentence, which is our AI-written text, with the AI badge, and no outside source's", async () => {
    renderCitation([
      { sourceId: 'S1', sentence: 'The coverage sentence.' },
      { sourceId: 'E1', sentence: 'The earlier sentence.' },
    ])
    const { card } = await openCard('Sources: Coverage Outlet, Actually Relevant')
    const [outside, earlier] = within(card).getAllByRole('listitem')
    expect(announcedText(outside!)).not.toContain('AI-generated')
    expect(announcedText(earlier!)).toContain('AI-generated “The earlier sentence.”')
  })

  it('offers no link to read a source whose address is not http(s)', async () => {
    renderCitation([{ sourceId: 'S2', sentence: 'An odd sentence.' }])
    const { card } = await openCard('Source: Odd Outlet')
    expect(within(card).getByText('“An odd sentence.”')).toBeInTheDocument()
    expect(within(card).queryByText(/Read the source/)).toBeNull()
    expect(card.querySelector('[href]')).toBeNull()
  })

  it('passes axe with its card open, the button and the card alike', async () => {
    const { container } = renderCitation([
      { sourceId: 'S1', sentence: 'The coverage sentence.' },
      { sourceId: 'E1', sentence: 'The earlier sentence.' },
    ])
    const { card } = await openCard('Sources: Coverage Outlet, Actually Relevant')
    // The card is portaled to the end of the body, outside the render container
    expect(container).not.toContainElement(card)
    expect(await axe(container)).toHaveNoViolations()
    expect(await axe(card)).toHaveNoViolations()
  })
})
