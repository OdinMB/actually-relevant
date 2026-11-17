import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { contextSourcesById } from '../../test/context'
import { FigureTiles } from './FigureTiles'

const disagreeing = {
  label: 'people displaced',
  values: [
    { text: '5,000', estimate: false, sourceId: 'C1' },
    { text: '5,400', estimate: false, sourceId: 'C2' },
  ],
}

describe('FigureTiles', () => {
  it('shows each value of a tile with the source that gives it, when sources disagree, even on a card with one source', () => {
    render(<FigureTiles tiles={[disagreeing]} sources={contextSourcesById()} soleSource />)
    const first = screen.getByText('5,000').closest('[data-tile-value]') as HTMLElement
    const second = screen.getByText('5,400').closest('[data-tile-value]') as HTMLElement
    expect(within(first).getByRole('button', { name: 'Source: Budget Office' })).toBeInTheDocument()
    expect(within(second).getByRole('button', { name: 'Source: Plains Ledger' })).toBeInTheDocument()
  })

  it("names a single value's source only when the card cites more than one, since its footer names a sole source", () => {
    const tile = { label: 'pupils covered', values: [{ text: '600,000', estimate: false, sourceId: 'C1' }] }
    const { rerender } = render(<FigureTiles tiles={[tile]} sources={contextSourcesById()} soleSource />)
    expect(screen.queryByRole('button', { name: /^Source/ })).toBeNull()
    rerender(<FigureTiles tiles={[tile]} sources={contextSourcesById()} soleSource={false} />)
    expect(screen.getByRole('button', { name: 'Source: Budget Office' })).toBeInTheDocument()
  })

  it('shows the number alone when its label is empty, and only that sources differ when they do', () => {
    const { rerender } = render(
      <FigureTiles tiles={[{ label: '', values: [{ text: '55', estimate: false, sourceId: 'C1' }] }]} sources={contextSourcesById()} soleSource />,
    )
    expect(screen.getByRole('listitem')).toHaveTextContent(/^55$/)
    rerender(<FigureTiles tiles={[{ ...disagreeing, label: '' }]} sources={contextSourcesById()} soleSource={false} />)
    expect(screen.getByText('depending on whose count')).toBeInTheDocument()
  })

  it('marks a provisional value as an estimate', () => {
    render(
      <FigureTiles
        tiles={[{ label: 'yearly cost', values: [{ text: 'about $52m', estimate: true, sourceId: 'C2' }] }]}
        sources={contextSourcesById()}
        soleSource={false}
      />,
    )
    const value = screen.getByText('about $52m').closest('[data-tile-value]') as HTMLElement
    expect(within(value).getByText('estimate')).toBeInTheDocument()
  })
})
