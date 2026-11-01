import type { StoryStatus, EmotionTag, FeedRegion, FeedContentSource } from '../types/index.js'

export const STORY_STATUSES: StoryStatus[] = [
  'fetched',
  'pre_analyzed',
  'analyzed',
  'selected',
  'published',
  'rejected',
  'trashed',
]

export const EMOTION_TAGS: EmotionTag[] = [
  'uplifting',
  'frustrating',
  'scary',
  'calm',
]

export const FEED_REGIONS: { value: FeedRegion; label: string }[] = [
  { value: 'north_america', label: 'North America' },
  { value: 'western_europe', label: 'Western Europe' },
  { value: 'eastern_europe', label: 'Eastern Europe' },
  { value: 'middle_east_north_africa', label: 'Middle East & North Africa' },
  { value: 'sub_saharan_africa', label: 'Sub-Saharan Africa' },
  { value: 'south_southeast_asia', label: 'South & Southeast Asia' },
  { value: 'pacific', label: 'Pacific' },
  { value: 'latin_america', label: 'Latin America' },
  { value: 'global', label: 'Global' },
]

export const FEED_CONTENT_SOURCES: { value: FeedContentSource; label: string }[] = [
  { value: 'page', label: 'Fetch the article page' },
  { value: 'rss', label: 'Use the full text in the RSS item' },
]

/** The feed changeset file format; the server's schema (`server/src/schemas/feedChangeset.ts`) is what checks it. */
export const FEED_CHANGESET = {
  format: 'actually-relevant/feed-changeset',
  version: 1,
  maxChanges: 200,
  maxReasonLength: 500,
} as const

export const DEFAULT_PAGE_SIZE = 25
