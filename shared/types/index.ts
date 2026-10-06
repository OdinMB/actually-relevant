// Story pipeline statuses
export type StoryStatus =
  | 'fetched'
  | 'pre_analyzed'
  | 'analyzed'
  | 'selected'
  | 'published'
  | 'rejected'
  | 'trashed'

export type EmotionTag =
  | 'uplifting'
  | 'frustrating'
  | 'scary'
  | 'calm'

export type FeedRegion =
  | 'north_america'
  | 'western_europe'
  | 'eastern_europe'
  | 'middle_east_north_africa'
  | 'sub_saharan_africa'
  | 'south_southeast_asia'
  | 'pacific'
  | 'latin_america'
  | 'global'

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export type JobName =
  | 'crawl_feeds'
  | 'preassess_stories'
  | 'assess_stories'
  | 'select_stories'
  | 'publish_stories'
  | 'social_auto_post'
  | 'bluesky_update_metrics'
  | 'mastodon_update_metrics'
  | 'generate_newsletter'
  | 'generate_podcast'
  | 'publish_podcast'

export type JobStatus = 'idle' | 'running' | 'failed'

// --- API response types ---

export interface Story {
  id: string
  sourceUrl: string
  sourceTitle: string
  sourceContent: string
  sourceDatePublished: string | null
  feedId: string
  issueId: string | null
  status: StoryStatus
  dateCrawled: string
  datePublished: string | null
  relevancePre: number | null
  relevance: number | null
  emotionTag: EmotionTag | null
  slug: string | null
  title: string | null
  titleLabel: string | null
  summary: string | null
  quote: string | null
  quoteAttribution: string | null
  marketingBlurb: string | null
  relevanceReasons: string | null
  relevanceSummary: string | null
  antifactors: string | null
  relevanceCalculation: string | null
  crawlMethod: string | null
  clusterId: string | null
  createdAt: string
  updatedAt: string
  issue?: { id: string; name: string; slug: string; parentId?: string | null; parent?: { id: string; name: string; slug: string } | null } | null
  feed?: {
    title: string
    displayTitle?: string | null
    issue?: {
      id?: string
      name: string
      slug: string
      parentId?: string | null
      parent?: { id: string; name: string; slug: string } | null
    }
  }
  cluster?: {
    id: string
    primaryStoryId: string | null
    _count: { stories: number }
    stories: { id: string; title: string | null; sourceTitle: string; status: StoryStatus }[]
  } | null
  _count?: { blueskyPosts: number; mastodonPosts: number }
  blueskyPosts?: { postUri: string | null }[]
  mastodonPosts?: { statusUrl: string | null }[]
}

export interface PublicStory extends Story {
  feed: {
    id: string
    title: string
    displayTitle: string | null
    issue: {
      name: string
      slug: string
    }
  }
}

export interface Feed {
  id: string
  title: string
  rssUrl: string
  url: string | null
  displayTitle: string | null
  language: string
  region: FeedRegion | null
  issueId: string
  active: boolean
  crawlIntervalHours: number
  lastCrawledAt: string | null
  lastCrawlError: string | null
  lastCrawlErrorAt: string | null
  consecutiveFailedCrawls: number
  consecutiveEmptyCrawls: number
  /** Server-computed: consecutiveEmptyCrawls has reached the configured stale threshold. */
  isStale: boolean
  lastSuccessfulCrawlAt: string | null
  lastEtag: string | null
  lastModified: string | null
  lastCrawlResult: string | null
  htmlSelector: string | null
  createdAt: string
  updatedAt: string
}

export interface CrawlResult {
  feedId: string
  feedTitle: string
  newStories: number
  skipped: number
  errors: number
  errorMessage?: string
}

export interface Issue {
  id: string
  name: string
  slug: string
  description: string
  promptFactors: string
  promptAntifactors: string
  promptRatings: string
  parentId: string | null
  parent?: { id: string; name: string; slug: string } | null
  children?: Issue[]
  intro: string
  evaluationIntro: string
  evaluationCriteria: string[]
  sourceNames: string[]
  makeADifference: { label: string; url: string }[]
  minPreRating: number | null
  publishedStoryCount?: number
  createdAt: string
  updatedAt: string
}

export interface Newsletter {
  id: string
  title: string
  content: string
  html: string
  storyIds: string[]
  selectedStoryIds: string[]
  status: 'draft' | 'published'
  createdAt: string
  updatedAt: string
}

export type NewsletterSendStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'

export interface NewsletterSend {
  id: string
  newsletterId: string
  plunkCampaignId: string | null
  isTest: boolean
  status: NewsletterSendStatus
  htmlContent: string
  stats: Record<string, unknown>
  errorMessage: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PendingSubscription {
  id: string
  email: string
  token: string
  plunkContactId: string | null
  confirmedAt: string | null
  expiresAt: string
  createdAt: string
}


/** Production progress of an episode (forward-only); publication is the separate `status`. */
export type PodcastStage = 'legacy' | 'created' | 'selected' | 'scripted' | 'voiced' | 'ready'

/** How far a run goes: `interactive` stops after `selected` and `scripted` for a person's review. Null until chosen. */
export type PodcastMode = 'automated' | 'interactive'

/** A story as the episode froze it when the script was written. */
export interface PodcastEpisodeStory {
  ref: number
  id: string
  title: string
  publisher: string
  sourceUrl: string
  slug: string | null
  issue: string
}

/** The admin list's columns (no dialogue, script or show notes). */
export interface PodcastListItem {
  id: string
  title: string
  status: 'draft' | 'published'
  stage: PodcastStage
  mode: PodcastMode | null
  weekKey: string | null
  storyIds: string[]
  attempts: number
  blockedAt: string | null
  lastError: string | null
  dryRun: boolean
  /** A process is working on the episode right now (live lease). */
  inProgress: boolean
  /** An interactive episode resting at `selected` or `scripted`, waiting for a person (no error, not blocked). */
  awaitingReview: boolean
  /** First publication; once set the episode is never regenerated, re-edited or deleted, even after an unpublish. */
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PodcastSpeaker = 'HOST_A' | 'HOST_B'

/** The model's dialogue as stored (the opener and sign-off are added in code, outside it). */
export interface PodcastDialogue {
  episodeTitle: string
  episodeSummary: string
  segments: {
    kind: 'intro' | 'story' | 'outro'
    storyRef: number | null
    turns: { speaker: PodcastSpeaker; text: string }[]
  }[]
}

/** A person's script edit: the stored structure echoed back with new turn text and summary. */
export type PodcastScriptEdit = Omit<PodcastDialogue, 'episodeTitle'>

export interface Podcast extends PodcastListItem {
  /** Legacy rows: the hand-voiced script. Two-speaker rows: the rendered dialogue ("HOST A: ..."). */
  script: string
  dialogue: PodcastDialogue | null
  episodeSummary: string
  showNotes: string
  episodeStories: PodcastEpisodeStory[] | null
  /** A person changed the stories or the script; selects the episode's AI line. */
  humanEdited: boolean
  /** The step running now ("Voicing", ...); null at rest. */
  activity: string | null
  /** Characters a full voicing of the current script sends to TTS; null before there is a script. */
  ttsCharsEstimate: number | null
  blockedReason: string | null
  failedAt: string | null
  /** TTS model that voiced the episode ("stub-silence" for a dry run) */
  ttsModelId: string | null
  /** Public CDN URLs of the MP3 and the VTT transcript, set at `ready` */
  audioUrl: string | null
  transcriptUrl: string | null
  audioBytes: number | null
  durationSec: number | null
  readyAt: string | null
  /** Last takedown; the automatic publish job never republishes such an episode. */
  unpublishedAt: string | null
  /** TTS characters spent on this episode, every re-voice included */
  ttsChars: number
}

/**
 * TTS characters reserved this UTC month against the monthly cap, and the size of a typical episode
 * (the length the script prompt aims at) and of the largest valid one, for the cost confirmation
 * before a run that writes and voices an episode not scripted yet.
 */
export interface PodcastUsage {
  monthToDateChars: number
  monthlyCap: number
  typicalEpisodeChars: number
  maxEpisodeChars: number
}

/** A story of the week's pool, as the story picker lists it. */
export interface PodcastPoolStory {
  id: string
  title: string
  publisher: string
  sourceUrl: string
  slug: string | null
  issue: string
  relevance: number | null
  /** One of the episode's current stories. */
  selected: boolean
}

export interface PodcastStoryPool {
  stories: PodcastPoolStory[]
  minStories: number
  maxStories: number
}

/** An episode a process is working on right now (`GET /api/admin/podcasts/active`). */
export interface ActivePodcastRun {
  id: string
  title: string
  stage: PodcastStage
  mode: PodcastMode | null
  activity: string | null
  /** While voicing: chunks stored so far, and the episode's total. */
  chunksDone: number | null
  chunksTotal: number | null
}

/** A published episode on the public podcast page (`GET /api/podcast`). */
export interface PublicPodcastEpisode {
  id: string
  title: string
  /** Disclosure line: written and voiced by AI, and whether a person edited it. */
  aiLine: string
  summary: string
  publishedAt: string
  durationSec: number | null
  audioUrl: string
  audioBytes: number
  transcriptUrl: string | null
  stories: { title: string; publisher: string; sourceUrl: string; slug: string | null }[]
  aiGenerated: { fields: string[]; digitalSourceType: string }
}

/** `GET /api/podcast`: the show and its published episodes, newest first. */
export interface PublicPodcastResponse {
  show: {
    title: string
    description: string
    feedUrl: string
    artworkUrl: string
    listenLinks: { name: string; url: string }[]
  }
  episodes: PublicPodcastEpisode[]
}

/** A saved script edit: the episode and the segue warnings the person may keep. */
export interface PodcastScriptSaveResult {
  podcast: Podcast
  warnings: string[]
}

export type BlueskyPostStatus = 'draft' | 'published' | 'failed'

export interface BlueskyPost {
  id: string
  storyId: string
  postText: string
  postUri: string | null
  postCid: string | null
  status: BlueskyPostStatus
  error: string | null
  publishedAt: string | null
  likeCount: number
  repostCount: number
  replyCount: number
  quoteCount: number
  metricsUpdatedAt: string | null
  createdAt: string
  updatedAt: string
  story?: Story
  pickReasoning?: string
}

/** A single item in the merged Bluesky feed (API + DB cross-reference). */
export interface BlueskyFeedItem {
  uri: string
  cid: string
  text: string
  createdAt: string
  indexedAt: string
  likeCount: number
  repostCount: number
  replyCount: number
  quoteCount: number
  isRepost: boolean
  embed?: {
    uri?: string
    title?: string
    description?: string
    thumbUrl?: string
  }
  trackedPostId: string | null
  storyTitle: string | null
  storySlug: string | null
  issueName: string | null
  dbStatus: BlueskyPostStatus | null
}

/** A draft/failed DB-only post not yet on Bluesky. */
export interface BlueskyDbOnlyPost {
  id: string
  postText: string
  status: string
  error: string | null
  createdAt: string
  storyTitle: string | null
  storySlug: string | null
  issueName: string | null
}

export interface BlueskyFeedResponse {
  feed: BlueskyFeedItem[]
  cursor?: string
  dbOnlyPosts: BlueskyDbOnlyPost[]
}

// --- Mastodon Types ---

export type MastodonPostStatus = 'draft' | 'published' | 'failed'

export interface MastodonPost {
  id: string
  storyId: string
  postText: string
  statusId: string | null
  statusUrl: string | null
  status: MastodonPostStatus
  error: string | null
  publishedAt: string | null
  favouriteCount: number
  boostCount: number
  replyCount: number
  metricsUpdatedAt: string | null
  createdAt: string
  updatedAt: string
  story?: Story
  pickReasoning?: string
}

/** A single item in the merged Mastodon feed (API + DB cross-reference). */
export interface MastodonFeedItem {
  id: string
  url: string
  text: string
  createdAt: string
  favouriteCount: number
  boostCount: number
  replyCount: number
  isReblog: boolean
  trackedPostId: string | null
  storyTitle: string | null
  storySlug: string | null
  issueName: string | null
  dbStatus: MastodonPostStatus | null
}

/** A draft/failed DB-only post not yet on Mastodon. */
export interface MastodonDbOnlyPost {
  id: string
  postText: string
  status: string
  error: string | null
  createdAt: string
  storyTitle: string | null
  storySlug: string | null
  issueName: string | null
}

export interface MastodonFeedResponse {
  feed: MastodonFeedItem[]
  nextMaxId?: string
  dbOnlyPosts: MastodonDbOnlyPost[]
}

export interface StoryCluster {
  id: string
  primaryStoryId: string | null
  primaryStory?: { id: string; title: string | null; sourceTitle: string } | null
  stories: { id: string; title: string | null; sourceTitle: string; status: StoryStatus; relevance: number | null }[]
  _count: { stories: number }
  createdAt: string
  updatedAt: string
}

export interface ClusterStorySearchResult {
  id: string
  title: string | null
  sourceTitle: string
  status: StoryStatus
  relevance: number | null
  clusterId: string | null
}

export interface JobRun {
  id: string
  jobName: JobName
  lastStartedAt: string | null
  lastCompletedAt: string | null
  lastError: string | null
  enabled: boolean
  running: boolean
  cronExpression: string
  createdAt: string
  updatedAt: string
}

// --- Query/filter types ---

export interface StoryFilters {
  status?: StoryStatus | 'all'
  issueId?: string
  feedId?: string
  crawledAfter?: string
  crawledBefore?: string
  ratingMin?: number
  ratingMax?: number
  rating?: string
  emotionTag?: EmotionTag
  sort?: StorySort
  page?: number
  pageSize?: number
}

export type StorySort =
  | 'rating_asc'
  | 'rating_desc'
  | 'date_asc'
  | 'date_desc'
  | 'title_asc'
  | 'title_desc'

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// --- Background task types ---

export type BulkTaskType = 'preassess' | 'assess' | 'select' | 'reclassify' | 'emotion'
export type BulkTaskStatus = 'running' | 'completed' | 'failed'

export interface TaskState {
  id: string
  type: BulkTaskType
  status: BulkTaskStatus
  total: number
  completed: number
  failed: number
  errors: string[]
  storyIds: string[]
  createdAt: string
  completedAt?: string
}
