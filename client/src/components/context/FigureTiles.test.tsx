import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { contextSourcesById } from '../../test/context'
import { FigureTiles } from './FigureTiles'

describe('FigureTiles', () => {
  it('shows each value of a tile with the source that gives it, when sources disagree', () => {
    render(
      <FigureTiles
        tiles={[
          {
            label: 'people displaced',
            values: [
              { text: '5,000', estimate: false, sourceId: 'C1' },
              { text: '5,400', estimate: false, sourceId: 'C2' },
            ],
          },
        ]}
        sources={contextSourcesById()}
      />,
    )
    const first = screen.getByText('5,000').closest('[data-tile-value]') as HTMLElement
    const second = screen.getByText('5,400').closest('[data-tile-value]') as HTMLElement
    expect(within(first).getByRole('button', { name: 'Source: Budget Office' })).toBeInTheDocument()
    expect(within(second).getByRole('button', { name: 'Source: Plains Ledger' })).toBeInTheDocument()
  })

  it('marks a provisional value as an estimate', () => {
    render(<FigureTiles tiles={[{ label: 'yearly cost', values: [{ text: 'about $52m', estimate: true, sourceId: 'C2' }] }]} sources={contextSourcesById()} />)
    const value = screen.getByText('about $52m').closest('[data-tile-value]') as HTMLElement
    expect(within(value).getByText('estimate')).toBeInTheDocument()
  })
})
