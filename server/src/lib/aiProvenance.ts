import { config } from '../config.js'

/**
 * Machine-readable "AI-generated" markers for story text, ongoing-story overviews and podcast episodes (EU AI Act Art. 50(2) interim
 * measure; see .context/ai-transparency.md). These are unsigned metadata: they are not the
 * watermark layer the Code of Practice expects for long text, and copied text loses them.
 */

/** IPTC Digital Source Type term for content created by a trained model (cv.iptc.org/newscodes/digitalsourcetype). */
export const IPTC_TRAINED_ALGORITHMIC_MEDIA = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

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

/**
 * Every field a public story's marker can name: the text fields above, then `overview`, the ongoing
 * story the story is part of, whose title an AI model wrote (services/overviewPublic.ts `withOverview`).
 * openapi.test.ts checks the marker's documented values are exactly these.
 */
export const AI_GENERATED_STORY_MARKER_FIELDS = [...AI_GENERATED_STORY_FIELDS, 'overview'] as const

export type AiGeneratedStoryMarkerField = (typeof AI_GENERATED_STORY_MARKER_FIELDS)[number]

export type AiStoryText = Partial<Record<AiGeneratedStoryField, string | null>> & { overview?: { title: string } | null }

export interface AiGeneratedMarker {
  /** The AI-generated fields that carry a value in this story object. */
  fields: AiGeneratedStoryMarkerField[]
  /** Model configured for story analysis when the response was served (per-story ids are not recorded). */
  model: string
  digitalSourceType: typeof IPTC_TRAINED_ALGORITHMIC_MEDIA
}

/** The text fields that carry text, then `overview` while the story is part of a public ongoing story. */
export function aiGeneratedMarker(story: AiStoryText): AiGeneratedMarker {
  return {
    fields: [...AI_GENERATED_STORY_FIELDS.filter(field => Boolean(story[field])), ...(story.overview ? (['overview'] as const) : [])],
    model: config.llm.models[config.assess.modelTier].name,
    digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
  }
}

export function withAiGeneratedMarker<T extends AiStoryText>(story: T): T & { aiGenerated: AiGeneratedMarker } {
  return { ...story, aiGenerated: aiGeneratedMarker(story) }
}

/**
 * Fields of the single story (`GET /api/stories/:slug`) with AI-generated content: the list story's
 * (the text fields and `overview`), plus `research`, the researched version with its cited text
 * (services/researchedStory.ts), and `updates`, the Updates research passes recorded with the earlier
 * text (services/publicUpdates.ts), which only the single story serves. openapi.test.ts checks the
 * detail marker lists exactly these.
 */
export const AI_GENERATED_STORY_DETAIL_FIELDS = [...AI_GENERATED_STORY_MARKER_FIELDS, 'research', 'updates'] as const

export type AiGeneratedStoryDetailField = (typeof AI_GENERATED_STORY_DETAIL_FIELDS)[number]

export interface AiGeneratedDetailMarker extends Omit<AiGeneratedMarker, 'fields'> {
  fields: AiGeneratedStoryDetailField[]
}

/** The single story's marker: `research` joins the fields when the story serves a researched version, `updates` when it serves any Update. */
export function withAiGeneratedDetailMarker<T extends AiStoryText & { research: object | null; updates: readonly unknown[] }>(
  story: T,
): T & { aiGenerated: AiGeneratedDetailMarker } {
  const marker = aiGeneratedMarker(story)
  const fields: AiGeneratedStoryDetailField[] = [
    ...marker.fields,
    ...(story.research ? (['research'] as const) : []),
    ...(story.updates.length > 0 ? (['updates'] as const) : []),
  ]
  return { ...story, aiGenerated: { ...marker, fields } }
}

/**
 * Fields of a story context box (`GET /api/stories/:slug/context`, services/storyContextView.ts)
 * that an AI model wrote: the heading, the phone's teaser, the cited sentences and the visual (its
 * tile labels and chart captions; the values are the sources').
 */
export const AI_GENERATED_CONTEXT_FIELDS = ['heading', 'teaser', 'sentences', 'visual'] as const

export interface AiGeneratedContextMarker {
  /** Every box field above while any box is served; none for a story without context. */
  fields: (typeof AI_GENERATED_CONTEXT_FIELDS)[number][]
  /** The model that wrote the boxes, as recorded with them. */
  model: string
  digitalSourceType: typeof IPTC_TRAINED_ALGORITHMIC_MEDIA
}

export function contextAiMarker(hasBoxes: boolean, model: string): AiGeneratedContextMarker {
  return { fields: hasBoxes ? [...AI_GENERATED_CONTEXT_FIELDS] : [], model, digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA }
}

/**
 * Fields of an ongoing-story overview (`GET /api/overviews/:slug`, services/overviewPublic.ts) with
 * AI-generated content: its title (written when it was founded, a review or an editor may change it),
 * `stands` ("Where this stands" and "What's being done", written from its stories' checked facts) and
 * `entries`, its timeline: our stories' AI headlines and labels, the roles an AI model gave them, and
 * their Updates' notes.
 */
export const AI_GENERATED_OVERVIEW_FIELDS = ['title', 'stands', 'entries'] as const

export interface AiGeneratedOverviewMarker {
  /** `stands` only while it is served, `entries` while any is. */
  fields: (typeof AI_GENERATED_OVERVIEW_FIELDS)[number][]
  /** The models recorded with the title and with the stands served, as recorded. */
  models: string[]
  digitalSourceType: typeof IPTC_TRAINED_ALGORITHMIC_MEDIA
}

export function overviewAiMarker(o: { titleModel: string; standsModel: string | null; entries: number }): AiGeneratedOverviewMarker {
  return {
    fields: ['title', ...(o.standsModel !== null ? (['stands'] as const) : []), ...(o.entries > 0 ? (['entries'] as const) : [])],
    models: [...new Set([o.titleModel, ...(o.standsModel !== null ? [o.standsModel] : [])])],
    digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA,
  }
}

/**
 * Fields of a public podcast episode (`GET /api/podcast`) whose content an AI model generated: the
 * written title and summary, and the voiced audio and its transcript. Every episode carries all of
 * them, so the marker lists them all; openapi.test.ts checks each is described as AI-generated.
 */
export const AI_GENERATED_PODCAST_FIELDS = ['title', 'summary', 'audioUrl', 'transcriptUrl'] as const

/** The same for one episode with its readable transcript (`GET /api/podcast/episodes/:id`). */
export const AI_GENERATED_PODCAST_DETAIL_FIELDS = [...AI_GENERATED_PODCAST_FIELDS, 'transcript'] as const

/**
 * Fields of a public newsletter issue (`GET /api/newsletters/:slug`) with AI-generated content: the
 * issue text (AI-selected stories, headlines and summaries; an AI intro in issues generated before
 * 2026-10-26) and its stories' AI headlines
 * and labels. openapi.test.ts checks each is described as AI-generated.
 */
export const AI_GENERATED_NEWSLETTER_FIELDS = ['content', 'stories'] as const
