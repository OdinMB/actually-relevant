import { describe, expect, it } from 'vitest'
import type { ContextChartView, ContextTilesView } from '@shared/types'
import { contextBox } from '../../test/context'
import { isShortCard, SHORT_SENTENCE_CHARS } from './shortCard'

const sentence = (text: string) => ({ text, citations: [{ sourceId: 'C1', sentence: null }] })
const value = (text: string, sourceId = 'C1') => ({ text, estimate: false, sourceId })
const tiles = (...list: ContextTilesView['tiles']): ContextTilesView => ({ kind: 'tiles', tiles: list })
const chart = (kind: ContextChartView['kind']): ContextChartView => ({
  kind,
  caption: 'pupils getting free lunches',
  unit: 'pupils',
  points: [
    { label: 'Pilot', value: 180_000, text: '180,000', provisional: false, recent: false, asOf: '2024', sourceId: 'C1' },
    { label: 'Now', value: 600_000, text: '600,000', provisional: false, recent: true, asOf: '2026', sourceId: 'C1' },
  ],
  apart: null,
})

describe('isShortCard', () => {
  it('takes a single number, with or without its label, as short', () => {
    expect(isShortCard(contextBox('a', { sentences: [], visual: tiles({ label: '', values: [value('600,000')] }) }))).toBe(true)
    expect(isShortCard(contextBox('a', { sentences: [], visual: tiles({ label: 'pupils covered', values: [value('600,000')] }) }))).toBe(true)
  })

  it('takes one sentence that fits a few lines as short, up to the limit and no further', () => {
    expect(isShortCard(contextBox('a', { sentences: [sentence('x'.repeat(SHORT_SENTENCE_CHARS))], visual: null }))).toBe(true)
    expect(isShortCard(contextBox('a', { sentences: [sentence('x'.repeat(SHORT_SENTENCE_CHARS + 1))], visual: null }))).toBe(false)
  })

  it('keeps the note for a chart, even one standing alone', () => {
    expect(isShortCard(contextBox('a', { sentences: [], visual: chart('bars') }))).toBe(false)
    expect(isShortCard(contextBox('a', { sentences: [], visual: chart('line') }))).toBe(false)
  })

  it('keeps the note for several things: sentences, tiles, values that disagree, or a number with a sentence', () => {
    expect(isShortCard(contextBox('a', { sentences: [sentence('One.'), sentence('Two.')], visual: null }))).toBe(false)
    expect(isShortCard(contextBox('a', { sentences: [], visual: tiles({ label: 'a', values: [value('1')] }, { label: 'b', values: [value('2')] }) }))).toBe(
      false,
    )
    expect(isShortCard(contextBox('a', { sentences: [], visual: tiles({ label: 'cost', values: [value('$48m'), value('$52m', 'C2')] }) }))).toBe(false)
    expect(isShortCard(contextBox('a', { sentences: [sentence('Every school.')], visual: tiles({ label: '', values: [value('600,000')] }) }))).toBe(false)
  })

  it('keeps the note for a card with nothing in it', () => {
    expect(isShortCard(contextBox('a', { sentences: [], visual: null }))).toBe(false)
    expect(isShortCard(contextBox('a', { sentences: [], visual: tiles() }))).toBe(false)
  })
})
