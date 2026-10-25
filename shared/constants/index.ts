import type { StoryStatus, EmotionTag, FeedRegion } from '../types/index.js'

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

export const DEFAULT_PAGE_SIZE = 25
