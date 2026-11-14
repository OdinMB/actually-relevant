import { describe, it, expect } from 'vitest'
import { EMOTION_TAG_DEFINITIONS } from '../prompts/shared.js'
import { preAssessItemSchema } from './llm.js'
import { writeSchema } from './research.js'

describe('writeSchema', () => {
  it("asks the write step for the emotion tag of the story it writes: pre-assessment's tags and definitions, not a copy of them", () => {
    const tag = writeSchema.shape.emotionTag
    expect(tag.options).toEqual(preAssessItemSchema.shape.emotionTag.options)
    expect(tag.description).toContain(EMOTION_TAG_DEFINITIONS)
    expect(preAssessItemSchema.shape.emotionTag.description).toContain(EMOTION_TAG_DEFINITIONS)
    expect(writeSchema.safeParse({}).error?.issues.map(i => i.path[0])).toContain('emotionTag')
  })

  it("defines contradicted as the write prompt's block does: a disagreement at the same time that no later report settles", () => {
    const described = writeSchema.shape.contradicted.shape.isContradicted.description
    expect(described).toContain('<CONTRADICTED>')
    expect(described).toMatch(/no later report settles/)
  })

  it("defines old news as the write prompt's block does: an old event with no new development since the cutoff", () => {
    const described = writeSchema.shape.oldNews.shape.isOld.description
    expect(described).toContain('<OLD_NEWS>')
    expect(described).toMatch(/no fact reports a new development/)
  })
})
