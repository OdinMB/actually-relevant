import { describe, it, expect } from 'vitest'
import type { PublicStoryUpdate, PublicStoryUpdateChange } from '@shared/types'
import { updateMarks } from './updateMarks'

const rewrote = (section: string): PublicStoryUpdateChange => ({ section, before: { text: `Old ${section}.`, citations: [] }, removed: false })
const removed = (section: string): PublicStoryUpdateChange => ({ section, before: { text: `Old ${section}.`, citations: [] }, removed: true })
const update = (date: string, ...changes: PublicStoryUpdateChange[]): PublicStoryUpdate => ({
  date,
  note: { text: 'What changed.', citations: [] },
  changes,
  sources: [],
})

const sorted = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b)

describe('updateMarks', () => {
  it('marks each rewritten paragraph and point by its index, and nothing for the headline or the key quote', () => {
    const marks = updateMarks([update('2026-11-18', rewrote('Title'), rewrote('Story paragraph 2'), rewrote('Key quote'), rewrote('Why This Matters 1'))])
    expect(sorted(marks.paragraphs)).toEqual([1])
    expect(sorted(marks.whyThisMatters)).toEqual([0])
    expect(sorted(marks.caveats)).toEqual([])
  })

  it('marks what every update rewrote, the older first, moved up past the sections a newer one removed', () => {
    // Newest first, as the API serves them
    const marks = updateMarks([
      update('2026-11-20', removed('Caveat 1'), rewrote('Caveat 2')),
      update('2026-11-18', rewrote('Caveat 3'), rewrote('Story paragraph 1')),
    ])
    expect(sorted(marks.caveats)).toEqual([0, 1])
    expect(sorted(marks.paragraphs)).toEqual([0])
  })

  it('drops the mark of a section a newer update removed, and marks no removed section', () => {
    const marks = updateMarks([update('2026-11-20', removed('Why This Matters 2')), update('2026-11-18', rewrote('Why This Matters 2'))])
    expect(sorted(marks.whyThisMatters)).toEqual([])
  })

  it('marks nothing without updates', () => {
    const marks = updateMarks([])
    expect([marks.paragraphs.size, marks.whyThisMatters.size, marks.caveats.size]).toEqual([0, 0, 0])
  })
})
