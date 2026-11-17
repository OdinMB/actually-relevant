import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ContextChartPointView, ContextChartView } from '@shared/types'
import { getCategoryColor } from '../../lib/category-colors'
import { contextSourcesById } from '../../test/context'
import { ContextChart } from './ContextChart'

const point = (label: string, value: number, extra: Partial<ContextChartPointView> = {}): ContextChartPointView => ({
  label,
  value,
  text: value.toLocaleString('en-US'),
  provisional: false,
  recent: false,
  asOf: null,
  sourceId: 'C1',
  ...extra,
})

const bars: ContextChartView = {
  kind: 'bars',
  caption: 'pupils getting free lunches',
  unit: 'pupils',
  points: [
    point('Pilot, year 1', 180000, { asOf: '2024' }),
    point('Every school', 600000, { asOf: '2026-11', recent: true, provisional: true, sourceId: 'C2' }),
  ],
  apart: { caption: 'pupils on a waiting list', unit: 'pupils', points: [point('Waiting', 20000, { asOf: '2026-10' })] },
}

const line: ContextChartView = {
  kind: 'line',
  caption: 'average attendance in pilot schools',
  unit: '%',
  points: [point('Before', 88, { asOf: '2023' }), point('Year 1', 91, { asOf: '2024' }), point('Year 2', 93, { asOf: '2025', provisional: true })],
  apart: null,
}

/** The marks drawn with a pattern: the hatched ones. */
const hatchedMarks = (container: HTMLElement) =>
  [...container.querySelectorAll('svg rect, svg circle')].filter(mark => mark.getAttribute('fill')?.startsWith('url(#') && !mark.closest('pattern'))

const renderChart = (chart: ContextChartView, soleSource = false) =>
  render(<ContextChart chart={chart} sources={contextSourcesById()} colors={getCategoryColor('human-development')} soleSource={soleSource} />)

describe('ContextChart', () => {
  it('names the drawing by its caption and gives every value, date and source in a table for screen readers', () => {
    renderChart(bars)
    expect(screen.getByRole('img', { name: 'Pupils getting free lunches' })).toBeInTheDocument()
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    const text = rows.map(r => r.textContent)
    expect(text).toContainEqual(expect.stringContaining('Pilot, year 1'))
    expect(text.find(t => t?.includes('Pilot, year 1'))).toMatch(/180,000.*2024.*Budget Office/)
    expect(text.find(t => t?.includes('Every school'))).toMatch(/600,000.*estimate.*November 2026.*Plains Ledger/)
    // The different measure is in the table too, marked as one
    expect(text.find(t => t?.includes('Waiting'))).toMatch(/20,000.*October 2026.*Budget Office/)
    expect(screen.getByRole('table')).toHaveTextContent('A different measure: shown, not compared')
  })

  it('hatches a provisional mark, and only that one', () => {
    const { container } = renderChart(bars)
    const hatched = hatchedMarks(container)
    expect(hatched).toHaveLength(1)
    const patternId = hatched[0]!.getAttribute('fill')!.slice(5, -1)
    expect(container.querySelector(`pattern[id="${patternId}"]`)).not.toBeNull()
  })

  it('hatches a provisional point on a line too, and names the line by its caption', () => {
    const { container } = renderChart(line)
    expect(screen.getByRole('img', { name: 'Average attendance in pilot schools' })).toBeInTheDocument()
    expect(hatchedMarks(container)).toHaveLength(1)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  })

  it('names the sources under the chart, unless the card cites one source, which its footer names', () => {
    const { unmount } = renderChart(bars)
    expect(screen.getByText('Sources: Budget Office, Plains Ledger')).toBeInTheDocument()
    unmount()
    renderChart(line, true)
    expect(screen.queryByText(/^Sources?:/)).toBeNull()
    // The table still names each value's source
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('Budget Office')
  })
})
