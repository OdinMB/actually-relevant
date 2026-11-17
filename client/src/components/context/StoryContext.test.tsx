import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { getCategoryColor } from '../../lib/category-colors'
import { contextBox, contextSourcesById, noteButtonName } from '../../test/context'
import { slotKicker } from './contextText'
import { StoryContext } from './StoryContext'

const colors = getCategoryColor('planet-climate')

const renderSection = (boxes: Parameters<typeof StoryContext>[0]['boxes']) =>
  render(<StoryContext boxes={boxes} sources={contextSourcesById()} colors={colors} wide={false} />)

/** The cards as wider screens show them (phones get one-line buttons instead, by CSS). */
const cardList = () => screen.getByRole('list', { name: 'Context cards' })

describe('StoryContext', () => {
  it('renders nothing without boxes', () => {
    const { container } = renderSection([])
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the cards in order, each with its kicker, heading, cited sentences and the date its facts are from', () => {
    renderSection([
      contextBox('a', { type: 'next', asOf: '2026-11-12' }),
      contextBox('b', {
        type: 'why_now',
        asOf: '2026-10',
        sourceIds: ['C1', 'C2'],
        sentences: [{ text: 'Two sources.', citations: [{ sourceId: 'C2', sentence: null }] }],
      }),
    ])
    const cards = within(cardList()).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).getByRole('heading', { level: 3, name: 'Heading a' })).toBeInTheDocument()
    expect(cards[0]).toHaveTextContent(slotKicker('next'))
    expect(cards[0]).toHaveTextContent('Sentence of a.')
    expect(within(cards[0]!).getByRole('button', { name: 'Source: Budget Office' })).toBeInTheDocument()
    expect(cards[0]).toHaveTextContent('Budget Office · As of Nov 12, 2026')
    expect(within(cards[1]!).getByRole('heading', { level: 3, name: 'Heading b' })).toBeInTheDocument()
    expect(cards[1]).toHaveTextContent('Budget Office · Plains Ledger · As of October 2026')
  })

  it('opens a card from a one-line button on phones, and shows a short one in full with the heading the cards have', () => {
    const long = { sentences: ['One sentence.', 'Another sentence.'].map(text => ({ text, citations: [] })) }
    renderSection([contextBox('a', { type: 'next', ...long }), contextBox('b', { type: 'key_term' })])
    const [noted, shown] = within(screen.getByRole('list', { name: 'Context notes' })).getAllByRole('listitem')
    expect(within(noted!).getByRole('button', { name: noteButtonName(slotKicker('next'), 'Teaser a') })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(within(shown!).queryByRole('button', { name: noteButtonName(slotKicker('key_term'), 'Teaser b') })).toBeNull()
    expect(within(shown!).getByRole('heading', { level: 3, name: 'Heading b' })).toBeInTheDocument()
    expect(shown).toHaveTextContent('Sentence of b.')
    expect(shown).toHaveTextContent('Budget Office · As of Nov 12, 2026')
  })

  it('marks the section as AI-generated context, with no AI badge of its own, and passes axe', async () => {
    const { container } = renderSection([contextBox('a'), contextBox('b', { type: 'response' })])
    const section = screen.getByRole('region', { name: 'More context' })
    expect(section).toHaveAttribute('data-ai-generated', 'context')
    expect(within(section).queryByText('AI')).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })
})
