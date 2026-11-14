import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import type { Draft } from '../schemas/research.js'
import {
  SWAPPED_FIELDS,
  appliedDraftSchema,
  classifiedTag,
  researchedValues,
  restoredValues,
  sameSnapshot,
  snapshotForApply,
  snapshotOf,
  swappedEdits,
  type SwappedValues,
} from './researchSwap.js'

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
    emotionTag: 'uplifting',
    relevanceCalculation: ['- **Scale:** 6', '- **Early data:** -1'],
    rating: 5,
    oldNews: { isOld: false, firstHappened: 'unknown' },
    contradicted: { isContradicted: false, factIds: [] },
    ...over,
  }
}

/** A draft an older write step stored, before it tagged the story's emotion (2026-11-14). */
function untaggedDraft() {
  const { emotionTag: _none, ...older } = draft()
  return older
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
  emotionTag: 'frustrating',
}

/** A snapshot an apply stored before the emotion tag was swapped (2026-11-14). */
function untaggedSnapshot() {
  const { emotionTag: _none, ...older } = singleSource
  return older
}

describe('researchedValues', () => {
  it("writes the draft's texts and emotion tag into the swapped columns, its bullets one per line, and nulls the relevance summary", () => {
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
      emotionTag: 'uplifting',
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

  it('writes no emotion tag from a draft stored before the write step tagged one, so the story keeps its own', () => {
    const values = researchedValues(appliedDraftSchema.parse(untaggedDraft()))
    expect(values).not.toHaveProperty('emotionTag')
    expect(values.title).toBe('Pakistan adds 22 GW of rooftop solar in two years')
  })
})

describe('appliedDraftSchema', () => {
  it("carries the draft's emotion tag to the apply, and still takes a draft stored without one", () => {
    expect(appliedDraftSchema.parse(draft()).emotionTag).toBe('uplifting')
    expect(appliedDraftSchema.safeParse(untaggedDraft()).success).toBe(true)
  })
})

describe('snapshotOf', () => {
  it("keeps exactly the swapped columns of the story's row, its emotion tag among them", () => {
    const row = { ...singleSource, id: 'story-1', status: 'published', sourceTitle: 'Source' }
    expect(snapshotOf(row)).toEqual(singleSource)
  })
})

describe('snapshotForApply', () => {
  const researchedRow = { ...singleSource, title: 'An earlier run’s headline', emotionTag: 'calm' as const }

  it("takes the story's swapped columns on the first apply", () => {
    expect(snapshotForApply(null, singleSource)).toEqual(singleSource)
  })

  it('keeps the snapshot already there on a later apply, so a revert returns to the single-source analysis', () => {
    expect(snapshotForApply(singleSource, researchedRow)).toEqual(singleSource)
  })

  it("gives a snapshot stored before the tag was swapped the story's tag, which an apply then never changed", () => {
    expect(snapshotForApply(untaggedSnapshot(), { ...researchedRow, emotionTag: 'frustrating' })).toEqual(singleSource)
    expect(snapshotForApply(untaggedSnapshot(), { ...researchedRow, emotionTag: null })).toEqual({ ...untaggedSnapshot(), emotionTag: null })
  })
})

describe('classifiedTag', () => {
  it("writes a single-source story's tag into its column", () => {
    expect(classifiedTag(null, 'scary')).toEqual({ emotionTag: 'scary' })
    expect(classifiedTag(undefined, 'scary')).toEqual({ emotionTag: 'scary' })
  })

  it("writes a researched story's tag into its snapshot, the single-source analysis, and leaves the column to research's tag", () => {
    expect(classifiedTag(singleSource, 'scary')).toEqual({ preResearch: { ...singleSource, emotionTag: 'scary' } })
    expect(classifiedTag(untaggedSnapshot(), 'calm')).toEqual({ preResearch: { ...untaggedSnapshot(), emotionTag: 'calm' } })
  })
})

describe('sameSnapshot', () => {
  it('fences a write on the story having no snapshot, as read, so a first apply meanwhile skips it', () => {
    expect(sameSnapshot(null)).toEqual({ preResearch: { equals: Prisma.AnyNull } })
    expect(sameSnapshot(undefined)).toEqual({ preResearch: { equals: Prisma.AnyNull } })
  })

  it('fences a write on the snapshot read, so a revert or a completed snapshot meanwhile skips it', () => {
    expect(sameSnapshot(singleSource)).toEqual({ preResearch: { equals: singleSource } })
  })
})

describe('restoredValues', () => {
  it('reads a stored snapshot back, its emotion tag included', () => {
    expect(restoredValues(JSON.parse(JSON.stringify(singleSource)))).toEqual(singleSource)
  })

  it('reads back the texts of a snapshot taken while applies still swapped the rating, leaving the rating out', () => {
    expect(restoredValues({ ...singleSource, relevance: 6, relevanceCalculation: '- **Scale:** 6' })).toEqual(singleSource)
  })

  it('reads back a snapshot stored before the emotion tag was swapped without one, so a revert leaves the tag alone', () => {
    const restored = restoredValues(untaggedSnapshot())
    expect(restored).toEqual(untaggedSnapshot())
    expect(restored).not.toHaveProperty('emotionTag')
  })

  it('refuses a stored value that is not a whole snapshot', () => {
    const { relevanceSummary: _dropped, ...partial } = singleSource
    expect(restoredValues(partial)).toBeNull()
    expect(restoredValues({ ...singleSource, title: 6 })).toBeNull()
    expect(restoredValues({ ...singleSource, emotionTag: 'surprising' })).toBeNull()
    expect(restoredValues(null)).toBeNull()
  })
})

describe('swappedEdits', () => {
  const current = { ...singleSource, relevance: 6 }

  it('lists the swapped columns an edit changes, the emotion tag among them; the rating is not one', () => {
    expect(swappedEdits({ title: 'New headline', relevance: 3, emotionTag: 'scary' }, current)).toEqual(['title', 'emotionTag'])
  })

  it('lets an edit through that sends the swapped columns unchanged, as the edit form does', () => {
    expect(swappedEdits({ ...singleSource, relevance: 3 }, current)).toEqual([])
  })

  it('counts clearing a column as a change', () => {
    expect(swappedEdits({ quote: null }, current)).toEqual(['quote'])
    expect(swappedEdits({ emotionTag: null }, current)).toEqual(['emotionTag'])
  })
})
