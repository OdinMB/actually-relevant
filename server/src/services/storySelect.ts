// Public endpoints serve limited fields, and only published stories.

/** Fields the public API serves. The public routes add the aiGenerated marker (lib/aiProvenance.ts). */
export const PUBLIC_STORY_SELECT = {
  id: true,
  slug: true,
  sourceUrl: true,
  sourceTitle: true,
  title: true,
  titleLabel: true,
  dateCrawled: true,
  datePublished: true,
  status: true,
  relevancePre: true,
  relevance: true,
  emotionTag: true,
  summary: true,
  quote: true,
  quoteAttribution: true,
  marketingBlurb: true,
  relevanceReasons: true,
  relevanceSummary: true,
  antifactors: true,
  issue: {
    select: { name: true, slug: true },
  },
  feed: {
    select: {
      id: true,
      title: true,
      displayTitle: true,
      issue: {
        select: { name: true, slug: true },
      },
    },
  },
} as const
