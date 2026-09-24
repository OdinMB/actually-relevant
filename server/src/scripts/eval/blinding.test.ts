import { describe, it, expect } from 'vitest'
import { findModelNames, mentionsModelName, tallyTerms, withoutModelNames } from './blinding.js'

describe('findModelNames', () => {
  it('is case-insensitive and finds eval model IDs and family words', () => {
    expect(findModelNames('the GPT-5.2 model')).toContain('gpt-5.2')
    expect(findModelNames('Luna wrote this')).toEqual(['Luna'])
    expect(findModelNames('a SOL run')).toEqual(['Sol'])
  })

  it('catches GPT/OpenAI names written without a separator or with a possessive', () => {
    expect(findModelNames('GPT4o beat GPT-4')).toEqual(['gpt'])
    expect(findModelNames("ChatGPT's growth")).toContain('ChatGPT')
    expect(findModelNames("OpenAI's new model")).toEqual(['OpenAI'])
  })

  it('ignores words that merely contain a term', () => {
    expect(findModelNames('nanotechnology, solar power, lunar dust and Egypt')).toEqual([])
  })
})

describe('mentionsModelName', () => {
  it('scans every field of a structured story', () => {
    expect(mentionsModelName({ title: 'Grid storage', summary: 'Built with OpenAI tools' })).toBe(true)
    expect(mentionsModelName({ title: 'Grid storage', summary: 'Batteries' })).toBe(false)
  })
})

describe('tallyTerms', () => {
  it('counts matched terms across values, most frequent first', () => {
    expect(tallyTerms([{ s: 'OpenAI and GPT-5' }, 'OpenAI', 'nothing here'])).toBe('OpenAI ×2, gpt ×1')
  })
})

describe('withoutModelNames', () => {
  it('splits stories into kept and removed, preserving order', () => {
    const stories = [{ t: 'a' }, { t: 'GPT-6 launch' }, { t: 'b' }]
    expect(withoutModelNames(stories)).toEqual({ kept: [{ t: 'a' }, { t: 'b' }], removed: [{ t: 'GPT-6 launch' }] })
  })
})
