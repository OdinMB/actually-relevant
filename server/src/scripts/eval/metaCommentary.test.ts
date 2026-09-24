import { describe, it, expect } from 'vitest'
import type { AssessResult } from '../../schemas/llm.js'
import { findAssessMetaCommentary, findMetaCommentary } from './metaCommentary.js'

describe('findMetaCommentary', () => {
  it('flags text that talks about the input rather than the development', () => {
    expect(findMetaCommentary('The article does not quantify how many farmers are affected.')).not.toEqual([])
    expect(findMetaCommentary('Based on the supplied excerpt, the plan covers three provinces.')).not.toEqual([])
    expect(findMetaCommentary('No timeline appears in the provided text.')).not.toEqual([])
    expect(findMetaCommentary('Costs are unclear because the text is truncated.')).not.toEqual([])
    expect(findMetaCommentary('This piece does not say who pays.')).toEqual(['piece does not say'])
    expect(findMetaCommentary('Nothing in this excerpt names a budget.')).toEqual(['this excerpt'])
  })

  it('ignores the subject matter, publishers, legal articles and bills', () => {
    expect(findMetaCommentary('Reuters reports that the WHO cut its budget by $1.1 billion.')).toEqual([])
    expect(findMetaCommentary('Allies pledged to honor the Article 5 guarantee.')).toEqual([])
    expect(findMetaCommentary('The passage of the bill ends a decade of delay.')).toEqual([])
    expect(findMetaCommentary('The report finds emissions fell 12% in 2025.')).toEqual([])
    expect(findMetaCommentary('The ministry provided funding for 40 clinics.')).toEqual([])
  })
})

function assessment(over: Partial<AssessResult> = {}): AssessResult {
  return {
    publicationDate: '2026-05-01 00:00:00',
    quote: 'We will act now.',
    quoteAttribution: 'Jane Doe, Minister',
    summary: 'Fiji banned reef fishing in 2020, and coral cover has since doubled.',
    factors: ['- **Scale:** One.', '- **Policy:** Two.'],
    limitingFactors: ['- **Early stage:** Not yet.'],
    relevanceCalculation: ['- **Scale:** 6', '- **Other:** +0'],
    conservativeRating: 5,
    relevanceSummary: 'Protected reefs recover within a decade.',
    titleLabel: 'Ocean health',
    relevanceTitle: 'Coral reefs recover after fishing ban in Fiji',
    marketingBlurb: 'The Guardian reports reefs are recovering.',
    ...over,
  }
}

describe('findAssessMetaCommentary', () => {
  it('names each published field that talks about the input, first phrase only', () => {
    const a = assessment({
      limitingFactors: ['- **Scale:** Fine.', '- **Evidence:** The article does not quantify the reach of the excerpt.'],
      relevanceSummary: 'The supplied text suggests progress.',
    })
    expect(findAssessMetaCommentary(a)).toEqual(['limitingFactors[1]: "The article"', 'relevanceSummary: "supplied text"'])
  })

  it('leaves the verbatim quote and its attribution alone', () => {
    expect(findAssessMetaCommentary(assessment({ quote: 'The article I wrote last year was wrong.', quoteAttribution: 'Original article' }))).toEqual([])
  })
})
