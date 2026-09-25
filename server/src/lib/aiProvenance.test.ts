import { describe, it, expect, afterEach } from 'vitest'
import { config } from '../config.js'
import {
  AI_GENERATED_STORY_FIELDS,
  IPTC_TRAINED_ALGORITHMIC_MEDIA,
  aiGeneratedMarker,
  withAiGeneratedMarker,
} from './aiProvenance.js'

const assessModel = config.llm.models[config.assess.modelTier]
const originalModelName = assessModel.name

afterEach(() => {
  assessModel.name = originalModelName
})

function storyWithAllAiFields(): Record<string, string | null> {
  return Object.fromEntries(AI_GENERATED_STORY_FIELDS.map((field) => [field, `text of ${field}`]))
}

describe('aiGeneratedMarker', () => {
  it('lists every AI field that carries text', () => {
    const marker = aiGeneratedMarker(storyWithAllAiFields())
    expect(marker.fields).toEqual([...AI_GENERATED_STORY_FIELDS])
  })

  it('omits AI fields that are null or empty', () => {
    const story = { ...storyWithAllAiFields(), quote: null, quoteAttribution: '' }
    const marker = aiGeneratedMarker(story)
    expect(marker.fields).not.toContain('quote')
    expect(marker.fields).not.toContain('quoteAttribution')
    expect(marker.fields).toContain('summary')
  })

  it('reports the model configured for the assessment tier at serve time', () => {
    assessModel.name = 'model-under-test'
    expect(aiGeneratedMarker(storyWithAllAiFields()).model).toBe('model-under-test')
  })

  it('carries the IPTC digital source type for model-generated content', () => {
    expect(aiGeneratedMarker({}).digitalSourceType).toBe(IPTC_TRAINED_ALGORITHMIC_MEDIA)
  })
})

describe('withAiGeneratedMarker', () => {
  it('adds the marker without changing the story fields', () => {
    const story = { id: 'story-1', summary: 'AI summary', title: null }
    const marked = withAiGeneratedMarker(story)
    expect(marked).toMatchObject(story)
    expect(marked.aiGenerated.fields).toEqual(['summary'])
  })
})
