import { describe, it, expect } from 'vitest'
import type { Story } from '@shared/types'
import { buildFormState } from './storyForm'
import { availableTabs, firstError, resolveStoryTab, tabMarks } from './storyTabs'

const saved = buildFormState({ title: 'Headline', status: 'analyzed', relevancePre: 6, relevance: 7 } as unknown as Story)
const none = { research: false, context: false }

describe('availableTabs', () => {
  it('always has the story, its assessment and its source, and the others only when they have something to show', () => {
    expect(availableTabs({ research: false, context: false, social: false })).toEqual(['story', 'assessment', 'source'])
    expect(availableTabs({ research: true, context: true, social: true })).toEqual(['story', 'assessment', 'source', 'research', 'context', 'social'])
    expect(availableTabs({ research: true, context: false, social: true })).toEqual(['story', 'assessment', 'source', 'research', 'social'])
  })
})

describe('resolveStoryTab', () => {
  const tabs = availableTabs({ research: true, context: false, social: false })

  it('opens the tab the address names', () => {
    expect(resolveStoryTab('research', tabs)).toBe('research')
  })

  it('opens the story tab without a tab in the address, with one it does not know, or with one the story does not have', () => {
    expect(resolveStoryTab(null, tabs)).toBe('story')
    expect(resolveStoryTab('nonsense', tabs)).toBe('story')
    expect(resolveStoryTab('context', tabs)).toBe('story')
  })
})

describe('tabMarks', () => {
  it('marks the tab holding an edited field as unsaved, and no other', () => {
    const marks = tabMarks({ form: { ...saved, title: 'Edited' }, saved, errors: {}, failed: none })
    expect(marks.story).toBe('unsaved')
    expect(marks.assessment).toBeNull()
    expect(marks.source).toBeNull()
  })

  it('marks a field that cannot be saved as an error, over its being unsaved', () => {
    const marks = tabMarks({ form: { ...saved, relevance: '12' }, saved, errors: { relevance: 'Enter a whole number from 1 to 10' }, failed: none })
    expect(marks.assessment).toBe('error')
  })

  it('marks a section that could not be loaded as an error', () => {
    const marks = tabMarks({ form: saved, saved, errors: {}, failed: { research: true, context: false } })
    expect(marks.research).toBe('error')
    expect(marks.context).toBeNull()
  })
})

describe('firstError', () => {
  it('names the first field that cannot be saved, with its tab', () => {
    expect(firstError({})).toBeNull()
    expect(firstError({ relevance: 'x', relevancePre: 'y' })).toEqual({ field: 'relevancePre', tab: 'assessment' })
  })
})
