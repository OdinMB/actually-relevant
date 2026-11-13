import { describe, it, expect } from 'vitest'
import type { Draft } from '../schemas/research.js'
import { SWAPPED_FIELDS, researchedValues, restoredValues, snapshotOf, swappedEdits, type SwappedValues } from './researchSwap.js'

function draft(over: Partial<Draft> = {}): Draft {
  return {
    titleLabel: 'Rooftop solar',
    title: 'Pakistan adds 22 GW of rooftop solar in two years',
    story: [{ text: 'Pakistan added 22 GW.', factIds: ['S0F1'] }],
    summary: 'Pakistan added 22 GW of rooftop solar in two years.',
    whyThisMatters: [
      { text: 'Millions of homes now make their own power.', factIds: ['S1F1'] },
      { text: 'It cuts fuel imports.', factIds: [] },
    ],
    caveats: [{ text: 'Officials and analysts count differently.', factIds: ['S2F1'] }],
    quote: 'We need $138 billion by 2035',
    quoteAttribution: 'Shehbaz Sharif, Prime Minister',
    quoteSourceId: 'S0',
    marketingBlurb: 'Pakistan added 22 GW of rooftop solar in two years.',
    relevanceCalculation: ['- **Scale:** 6', '- **Early data:** -1'],
    rating: 5,
    oldNews: { isOld: false, firstHappened: 'unknown' },
    contradicted: { isContradicted: false, factIds: [] },
    ...over,
  }
}

const singleSource: SwappedValues = {
  title: 'Old headline',
  titleLabel: 'Old label',
  summary: 'Old summary.',
  quote: 'Old quote',
  quoteAttribution: 'Original article',
  marketingBlurb: 'Outlet reports …',
  relevanceReasons: '- **Reason:** old',
  relevanceSummary: 'Old relevance summary.',
  antifactors: '- **Limit:** old',
}

describe('researchedValues', () => {
  it("writes the draft's texts into the swapped columns, its bullets one per line, and nulls the relevance summary", () => {
    expect(researchedValues(draft())).toEqual({
      title: 'Pakistan adds 22 GW of rooftop solar in two years',
      titleLabel: 'Rooftop solar',
      summary: 'Pakistan added 22 GW of rooftop solar in two years.',
      quote: 'We need $138 billion by 2035',
      quoteAttribution: 'Shehbaz Sharif, Prime Minister',
      marketingBlurb: 'Pakistan added 22 GW of rooftop solar in two years.',
      relevanceReasons: '- Millions of homes now make their own power.\n- It cuts fuel imports.',
      relevanceSummary: null,
      antifactors: '- Officials and analysts count differently.',
    })
  })

  it("never swaps the rating or its calculation: the story keeps its own (owner decision 2026-11-12), and the run keeps the draft's", () => {
    expect(SWAPPED_FIELDS).not.toContain('relevance')
    expect(SWAPPED_FIELDS).not.toContain('relevanceCalculation')
  })

  it('writes an empty text as null, as the assessment does', () => {
    const values = researchedValues(draft({ quote: '', quoteAttribution: '', titleLabel: '' }))
    expect(values).toMatchObject({ quote: null, quoteAttribution: null, titleLabel: null })
  })

  it('writes every swapped column and nothing else', () => {
    expect(Object.keys(researchedValues(draft())).sort()).toEqual([...SWAPPED_FIELDS].sort())
  })
})

describe('snapshotOf', () => {
  it("keeps exactly the swapped columns of the story's row", () => {
    const row = { ...singleSource, id: 'story-1', status: 'published', sourceTitle: 'Source' }
    expect(snapshotOf(row)).toEqual(singleSource)
  })
})

describe('restoredValues', () => {
  it('reads a stored snapshot back', () => {
    expect(restoredValues(JSON.parse(JSON.stringify(singleSource)))).toEqual(singleSource)
  })

  it('reads back the texts of a snapshot taken while applies still swapped the rating, leaving the rating out', () => {
    expect(restoredValues({ ...singleSource, relevance: 6, relevanceCalculation: '- **Scale:** 6' })).toEqual(singleSource)
  })

  it('refuses a stored value that is not a whole snapshot', () => {
    const { relevanceSummary: _dropped, ...partial } = singleSource
    expect(restoredValues(partial)).toBeNull()
    expect(restoredValues({ ...singleSource, title: 6 })).toBeNull()
    expect(restoredValues(null)).toBeNull()
  })
})

describe('swappedEdits', () => {
  const current = { ...singleSource, relevance: 6, emotionTag: 'calm' }

  it('lists the swapped columns an edit changes; the rating is not one', () => {
    expect(swappedEdits({ title: 'New headline', relevance: 3, emotionTag: 'scary' }, current)).toEqual(['title'])
  })

  it('lets an edit through that sends the swapped columns unchanged, as the edit form does', () => {
    expect(swappedEdits({ ...singleSource, emotionTag: 'scary' }, current)).toEqual([])
  })

  it('counts clearing a column as a change', () => {
    expect(swappedEdits({ quote: null }, current)).toEqual(['quote'])
  })
})
