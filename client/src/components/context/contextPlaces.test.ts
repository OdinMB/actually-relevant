import { describe, expect, it } from 'vitest'
import type { ContextBoxView } from '@shared/types'
import { hasNotes, placeContext, placeCounts } from './contextPlaces'

const box = (id: string, place: string, extra: Partial<ContextBoxView> = {}): ContextBoxView => ({
  id,
  type: 'compared',
  heading: id,
  teaser: '',
  gap: false,
  place,
  sentences: [],
  visual: null,
  asOf: null,
  sourceIds: [],
  ...extra,
})

const ids = (boxes: (ContextBoxView | undefined)[]) => boxes.map(b => b?.id)

describe('placeContext', () => {
  it('puts each note after the paragraph or point it names and the rest under More context, in box order', () => {
    const placed = placeContext([box('a', 'section'), box('b', 'P2'), box('c', 'W1'), box('d', 'section')], { paragraphs: 3, points: 2 })
    expect(ids(placed.paragraphNotes)).toEqual([undefined, 'b'])
    expect(ids(placed.pointNotes)).toEqual(['c'])
    expect(ids(placed.section)).toEqual(['a', 'd'])
    expect(hasNotes(placed)).toBe(true)
  })

  it('sends a place the page does not show, or a second box for the same spot, to More context', () => {
    const placed = placeContext([box('past', 'P4'), box('first', 'W1'), box('second', 'W1'), box('odd', 'X1')], { paragraphs: 3, points: 2 })
    expect(ids(placed.section)).toEqual(['past', 'second', 'odd'])
    expect(ids(placed.pointNotes)).toEqual(['first'])
  })

  it('keeps the In numbers card and the honest gap under More context whatever their place says', () => {
    const placed = placeContext([box('figures', 'P1', { type: 'figures' }), box('gap', 'W1', { type: 'response', gap: true })], { paragraphs: 1, points: 1 })
    expect(ids(placed.section)).toEqual(['figures', 'gap'])
    expect(hasNotes(placed)).toBe(false)
  })
})

describe('placeCounts', () => {
  it('counts a researched story by its paragraphs and points, and a single-source story by its summary and its reasons as the page splits them', () => {
    const research = {
      paragraphs: [{ sentences: [] }, { sentences: [] }],
      whyThisMatters: [{ text: 'a', citations: [] }],
      caveats: [],
      quoteSourceId: null,
      sources: [],
    }
    expect(placeCounts({ summary: 'S', relevanceReasons: '- a\n- b\n- c' }, research)).toEqual({ paragraphs: 2, points: 1 })
    expect(placeCounts({ summary: 'S', relevanceReasons: '- a\n- b\n- c' }, null)).toEqual({ paragraphs: 1, points: 3 })
    expect(placeCounts({ summary: null, relevanceReasons: null }, null)).toEqual({ paragraphs: 0, points: 0 })
  })
})
