import { config } from '../config.js'

/**
 * Machine-readable "AI-generated" markers for story text (EU AI Act Art. 50(2) interim
 * measure; see .context/ai-transparency.md). These are unsigned metadata: they are not the
 * watermark layer the Code of Practice expects for long text, and copied text loses them.
 */

/** IPTC Digital Source Type term for content created by a trained model (cv.iptc.org/newscodes/digitalsourcetype). */
export const IPTC_TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

/**
 * Story fields whose text the assessment model writes (analysis.ts assessStory).
 * analysis.test.ts checks this list against what assessStory writes and what
 * PUBLIC_STORY_SELECT serves, so a new model-written public field cannot ship unmarked.
 */
export const AI_GENERATED_STORY_FIELDS = [
  'title',
  'titleLabel',
  'summary',
  'quote',
  'quoteAttribution',
  'marketingBlurb',
  'relevanceReasons',
  'relevanceSummary',
  'antifactors',
] as const

export type AiGeneratedStoryField = (typeof AI_GENERATED_STORY_FIELDS)[number]

export type AiStoryText = Partial<Record<AiGeneratedStoryField, string | null>>

export interface AiGeneratedMarker {
  /** The AI-generated fields that carry text in this story object. */
  fields: AiGeneratedStoryField[]
  /** Model configured for story analysis when the response was served (per-story ids are not recorded). */
  model: string
  digitalSourceType: typeof IPTC_TRAINED_ALGORITHMIC_MEDIA
}

export function aiGeneratedMarker(story: AiStoryText): AiGeneratedMarker {
  return {
    fields: AI_GENERATED_STORY_FIELDS.filter((field) => Boolean(story[field])),
    model: config.llm.models[config.assess.modelTier].name,
    digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
  }
}

export function withAiGeneratedMarker<T extends AiStoryText>(story: T): T & { aiGenerated: AiGeneratedMarker } {
  return { ...story, aiGenerated: aiGeneratedMarker(story) }
}
