import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getCategoryColor } from '../../lib/category-colors'
import { makeStory } from '../../test/stories'
import { contextBox, contextSourcesById, noteButtonName } from '../../test/context'
import { StoryBody } from '../story/StoryBody'
import { slotKicker } from './contextText'
import { ContextNote } from './ContextNote'

const colors = getCategoryColor('planet-climate')
const sources = contextSourcesById()

const research = {
  paragraphs: ['First paragraph.', 'Second paragraph.', 'Third paragraph.'].map(text => ({ sentences: [{ text, citations: [] }] })),
  whyThisMatters: [
    { text: 'First point.', citations: [] },
    { text: 'Second point.', citations: [] },
  ],
  caveats: [{ text: 'A caveat.', citations: [] }],
  quoteSourceId: null,
  sources: [],
}

const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/** Two sentences: more than a phone shows in full, so the card keeps its one-line note (`isShortCard`). */
const long = { sentences: ['Sentence of p.', 'Another sentence.'].map(text => ({ text, citations: [] })) }
const singleFigure = {
  type: 'who_affected' as const,
  sentences: [],
  visual: { kind: 'tiles' as const, tiles: [{ label: '', values: [{ text: '600,000', estimate: false, sourceId: 'C1' }] }] },
}

describe('ContextNote', () => {
  it('sits after the paragraph it belongs to, and in the text column of the point it belongs to, past its number', () => {
    const story = makeStory({ quote: null })
    render(
      <StoryBody
        story={{ ...story, research, researched: true }}
        research={research}
        colors={colors}
        paragraphNotes={[undefined, <ContextNote key="p" box={contextBox('p', { place: 'P2' })} sources={sources} colors={colors} />]}
        pointNotes={[<ContextNote key="w" box={contextBox('w', { place: 'W1', type: 'response' })} sources={sources} colors={colors} />]}
      />,
    )
    const paragraphNote = screen.getByRole('note', { name: `${slotKicker('compared')}: Heading p` })
    expect(follows(screen.getByText('Second paragraph.'), paragraphNote)).toBe(true)
    expect(follows(paragraphNote, screen.getByText('Third paragraph.'))).toBe(true)

    const pointNote = screen.getByRole('note', { name: `${slotKicker('response')}: Heading w` })
    const pointText = screen.getByText('First point.').closest('.prose')!
    expect(pointText).toContainElement(pointNote)
    expect(follows(pointNote, screen.getByText('Second point.'))).toBe(true)
    // Every note carries the machine-readable marker
    expect(pointNote.closest('[data-ai-generated="context"]')).not.toBeNull()
    expect(paragraphNote.closest('[data-ai-generated="context"]')).not.toBeNull()
  })

  it('opens the full card in a sheet from its one-line button; Escape closes it and focus returns to the button', async () => {
    const user = userEvent.setup()
    render(<ContextNote box={contextBox('p', { place: 'P1', ...long })} sources={sources} colors={colors} />)
    const button = screen.getByRole('button', { name: noteButtonName(slotKicker('compared'), 'Teaser p') })

    await user.click(button)
    const sheet = await screen.findByRole('dialog', { name: 'Heading p' })
    expect(within(sheet).getByText('Sentence of p.')).toBeInTheDocument()
    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(button).toHaveFocus()
  })

  it('closes the sheet with its close button', async () => {
    const user = userEvent.setup()
    render(<ContextNote box={contextBox('p', { place: 'P1', ...long })} sources={sources} colors={colors} />)
    await user.click(screen.getByRole('button', { name: noteButtonName(slotKicker('compared'), 'Teaser p') }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows a short card in full on phones too: one note, nothing to open and no heading, beside its text', () => {
    render(<ContextNote box={contextBox('n', { place: 'P2', ...singleFigure })} sources={sources} colors={colors} />)
    const notes = screen.getAllByRole('note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveAccessibleName(`${slotKicker('who_affected')}: Heading n`)
    // Below md a card's note is hidden for the one-line button; a short card's is not
    expect(notes[0]).not.toHaveClass('hidden')
    expect(notes[0]).toHaveTextContent(/Heading n600,000Budget Office · As of Nov 12, 2026$/)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('keeps the full card hidden below md while the one-line button stands for it', () => {
    render(<ContextNote box={contextBox('p', { place: 'P1', ...long })} sources={sources} colors={colors} />)
    expect(screen.getByRole('note')).toHaveClass('hidden')
  })
})
