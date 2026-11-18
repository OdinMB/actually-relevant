import { describe, it, expect } from 'vitest'
import type { Story } from '@shared/types'
import { buildFormState, ratingProblem, storyFormErrors } from './storyForm'

const story = { title: 'Headline', status: 'analyzed', relevancePre: 6, relevance: 7, slug: null } as unknown as Story

describe('ratingProblem', () => {
  it('accepts an empty field (no rating) and whole numbers from 1 to 10', () => {
    for (const value of ['', '1', '7', '10']) expect(ratingProblem(value)).toBeNull()
  })

  it('refuses a number outside 1 to 10, or one with a fraction', () => {
    for (const value of ['0', '11', '-3', '5.5']) expect(ratingProblem(value)).toMatch(/whole number from 1 to 10/)
  })
})

describe('storyFormErrors', () => {
  it('names each rating that cannot be saved, and nothing for a form that can', () => {
    const form = buildFormState(story)
    expect(storyFormErrors(form)).toEqual({})
    expect(Object.keys(storyFormErrors({ ...form, relevance: '12', relevancePre: '0' })).sort()).toEqual(['relevance', 'relevancePre'])
  })
})
