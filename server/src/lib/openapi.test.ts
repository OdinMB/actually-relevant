import { describe, it, expect } from 'vitest'
import { getOpenAPIDocument } from './openapi.js'
import { AI_GENERATED_STORY_FIELDS } from './aiProvenance.js'

describe('getOpenAPIDocument', () => {
  const doc = getOpenAPIDocument()
  const schemas = doc.components.schemas

  it('documents the aiGenerated marker on every public story', () => {
    expect(schemas.PublicStory.required).toContain('aiGenerated')
    expect(schemas.PublicStory.properties.aiGenerated.$ref).toBe('#/components/schemas/AiGenerated')
  })

  it('lists exactly the registry fields as possible AI-generated field names', () => {
    expect(schemas.AiGenerated.properties.fields.items.enum).toEqual([...AI_GENERATED_STORY_FIELDS])
  })

  it('describes every AI-generated field of the story schema', () => {
    for (const field of AI_GENERATED_STORY_FIELDS) {
      expect(schemas.PublicStory.properties[field].description, field).toBeTruthy()
    }
  })
})
