import { describe, it, expect, afterEach } from 'vitest'
import { config } from '../config.js'
import {
  AI_GENERATED_STORY_DETAIL_FIELDS,
  AI_GENERATED_STORY_FIELDS,
  IPTC_TRAINED_ALGORITHMIC_MEDIA,
  aiGeneratedMarker,
  withAiGeneratedDetailMarker,
  withAiGeneratedMarker,
} from './aiProvenance.js'

const assessModel = config.llm.models[config.assess.modelTier]
const originalModelName = assessModel.name

afterEach(() => {
  assessModel.name = originalModelName
})

function storyWithAllAiFields(): Record<string, string | null> {
  return Object.fromEntries(AI_GENERATED_STORY_FIELDS.map(field => [field, `text of ${field}`]))
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

describe('withAiGeneratedDetailMarker', () => {
  const research = { paragraphs: [], whyThisMatters: [], caveats: [], quoteSourceId: null, sources: [] }

  it('names the researched version after the text fields when the story serves one', () => {
    const marked = withAiGeneratedDetailMarker({ ...storyWithAllAiFields(), research, researched: true })
    expect(marked.aiGenerated.fields).toEqual([...AI_GENERATED_STORY_FIELDS, 'research'])
    expect(AI_GENERATED_STORY_DETAIL_FIELDS).toEqual([...AI_GENERATED_STORY_FIELDS, 'research'])
  })

  it('leaves it out when there is none, also for a researched story whose version could not be served', () => {
    for (const researched of [false, true]) {
      const marked = withAiGeneratedDetailMarker({ summary: 'AI summary', research: null, researched })
      expect(marked.aiGenerated.fields).toEqual(['summary'])
    }
  })
})
