import type { EmotionTag, Story, StoryStatus } from '@shared/types'

/*
 * The story editor's form (`StoryEditForm`): the values its fields hold, what a save sends, and
 * which values cannot be saved.
 */

/** The form's values as the fields hold them: text, so a rating typed back to what it was counts as unchanged. */
export function buildFormState(story: Story) {
  return {
    titleLabel: story.titleLabel ?? '',
    title: story.title ?? '',
    slug: story.slug ?? '',
    issueId: story.issueId ?? '',
    status: story.status,
    relevancePre: story.relevancePre == null ? '' : String(story.relevancePre),
    relevance: story.relevance == null ? '' : String(story.relevance),
    emotionTag: story.emotionTag ?? '',
    summary: story.summary ?? '',
    quote: story.quote ?? '',
    quoteAttribution: story.quoteAttribution ?? '',
    marketingBlurb: story.marketingBlurb ?? '',
    relevanceReasons: story.relevanceReasons ?? '',
    relevanceSummary: story.relevanceSummary ?? '',
    antifactors: story.antifactors ?? '',
    relevanceCalculation: story.relevanceCalculation ?? '',
  }
}

export type StoryForm = ReturnType<typeof buildFormState>
export type StoryField = keyof StoryForm

/** What Save sends: every field, an emptied one as null (the slug as absent, so it is kept). */
export function toStoryPayload(f: StoryForm): Partial<Story> {
  return {
    titleLabel: f.titleLabel || null,
    title: f.title || null,
    slug: f.slug || undefined,
    issueId: f.issueId || null,
    status: f.status as StoryStatus,
    relevancePre: f.relevancePre === '' ? null : Number(f.relevancePre),
    relevance: f.relevance === '' ? null : Number(f.relevance),
    emotionTag: (f.emotionTag || null) as EmotionTag | null,
    summary: f.summary || null,
    quote: f.quote || null,
    quoteAttribution: f.quoteAttribution || null,
    marketingBlurb: f.marketingBlurb || null,
    relevanceReasons: f.relevanceReasons || null,
    relevanceSummary: f.relevanceSummary || null,
    antifactors: f.antifactors || null,
    relevanceCalculation: f.relevanceCalculation || null,
  }
}

/** Why a rating's text cannot be saved, or null: empty (no rating) or a whole number from 1 to 10. */
export function ratingProblem(value: string): string | null {
  if (value === '') return null
  const rating = Number(value)
  return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? null : 'Enter a whole number from 1 to 10'
}

export type StoryFormErrors = Partial<Record<StoryField, string>>

/**
 * The fields whose values cannot be saved, each with what is wrong. The form checks them itself
 * (`noValidate`): a field on a tab that is not shown cannot show the browser's own message.
 */
export function storyFormErrors(form: StoryForm): StoryFormErrors {
  const errors: StoryFormErrors = {}
  for (const field of ['relevancePre', 'relevance'] as const) {
    const problem = ratingProblem(form[field])
    if (problem) errors[field] = problem
  }
  return errors
}
