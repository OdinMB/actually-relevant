// Story pipeline statuses
export type StoryStatus =
  | 'fetched'
  | 'pre_analyzed'
  | 'analyzed'
  | 'selected'
  | 'published'
  | 'rejected'
  | 'trashed'

// Why a story is rejected; null on every other status
export type RejectionReason =
  | 'paywall'
  | 'assess_threshold'
  | 'select_threshold'
  | 'selection'
  | 'duplicate'
  | 'editor'

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
  | 'publish_newsletter'
  | 'generate_uplifting_newsletter'
  | 'publish_uplifting_newsletter'
  | 'generate_podcast'
  | 'publish_podcast'
  | 'generate_uplifting_podcast'
  | 'publish_uplifting_podcast'
  | 'poll_plunk_activity'
  | 'send_queued_confirmations'
  | 'cleanup_old_stories'

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
  rejectionReason: RejectionReason | null
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
  /** Classified at extraction: free, metered, locked (rejected at crawl) or unknown; null on stories crawled before it existed. */
  accessTier: string | null
  clusterId: string | null
  createdAt: string
  updatedAt: string
  /**
   * Admin reads only: the single-source values an applied research run replaced, which a revert
   * restores; set while the story carries its researched version (`.context/story-research.md`).
   */
  preResearch?: Record<string, unknown> | null
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

// --- Researched story (public; a hand-written mirror of server/src/services/researchedStory.ts) ---

/** One cited source of a sentence or bullet, with the source's supporting sentence for the card. */
export interface ResearchCitation {
  sourceId: string
  /** The source's own sentence, in its original language; null when only its date is cited. */
  sentence: string | null
}

export interface ResearchedCitedText {
  text: string
  /** One per source, in first-cited order; empty for text that only judges. */
  citations: ResearchCitation[]
}

export interface ResearchedSource {
  /** `S0` is the original article; `E1`… are our earlier stories. */
  id: string
  origin: 'original' | 'source' | 'earlier'
  outlet: string
  /** For the stored favicon (`/api/source-favicons/:host`); null for our earlier stories. */
  host: string | null
  /** The source article; null for our earlier stories, linked by slug. */
  url: string | null
  title: string
  date: string | null
  country: string | null
  kind: 'news-report' | 'analysis' | 'opinion' | 'press-release' | 'official-body' | 'other' | null
  storyId: string | null
  slug: string | null
}

/** The researched version readers see, served on the single story only. */
export interface ResearchedStory {
  paragraphs: { sentences: ResearchedCitedText[] }[]
  whyThisMatters: ResearchedCitedText[]
  caveats: ResearchedCitedText[]
  quoteSourceId: string | null
  /** The original article first, our earlier stories last. */
  sources: ResearchedSource[]
}

/** `GET /api/stories/:slug`: the public story plus its researched version. */
export interface PublicStoryDetail extends PublicStory {
  /** The cited layout keys on this; null for a story not researched, or whose version could not be served. */
  research: ResearchedStory | null
  /** The text fields carry researched text: the label keys on this. */
  researched: boolean
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
  /** Off: the markup rule never marks this feed's articles locked. */
  paywallDetection: boolean
  /** Regex tested on an article's title; a match marks it locked. */
  paywallTitleMarker: string | null
  /** Where the crawler takes the article text: the article page, or the full text in the RSS item. */
  contentSource: FeedContentSource
  createdAt: string
  updatedAt: string
}

export type FeedContentSource = 'page' | 'rss'

/** One change of an uploaded feed changeset, as the server resolved it (`server/src/services/feedChangesetPlan.ts`). */
export interface FeedChangeResult {
  /** Position in the file's `changes`, from 0. */
  index: number
  action: 'create' | 'update' | 'delete' | null
  feedTitle: string | null
  reason: string | null
  status: 'ok' | 'noop' | 'error'
  message: string
  diff?: { field: string; from: string | number | boolean | null; to: string | number | boolean | null }[]
}

/** The answer of the changeset preview and apply endpoints (`.context/feed-management.md`, "Changesets"). */
export interface FeedChangesetReport {
  title: string | null
  results: FeedChangeResult[]
  counts: { ok: number; noop: number; error: number }
  /** Set by apply: true when written, false on its 400 when any change has an error. */
  applied?: boolean
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

/** The newsletter's two editions: `full`, every kind of story, and `uplifting`, Actually Uplifting (uplifting stories only). */
export type NewsletterEdition = 'full' | 'uplifting'

export interface Newsletter {
  id: string
  title: string
  content: string
  html: string
  storyIds: string[]
  selectedStoryIds: string[]
  status: 'draft' | 'published'
  edition: NewsletterEdition
  /** URL segment of the public web edition (/newsletter/<slug>), assigned on HTML build or first publish */
  slug: string | null
  /** First publication; the issue is public on the web while `status` is published */
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** `POST /api/admin/newsletters/:id/select`: the issue, and each pick replaced with newer coverage of it (reasons as in `StoryNewerCoverage`). */
export interface NewsletterSelection extends Newsletter {
  replacedWithNewer: { replacedId: string; replacedTitle: string; newerId: string; newerTitle: string; reason: 'same_event' | 'same_source' }[]
}

/**
 * Later coverage that may have overtaken a chosen story (`GET /api/admin/stories/newer-coverage`,
 * advisory): `same_event` is a story in its dedup cluster reported a day or more later,
 * `same_source` a nearly identical later headline from its own feed.
 */
export interface StoryNewerCoverage {
  storyId: string
  /** Newest first, at most three */
  newer: { id: string; title: string; publisher: string; reportedAt: string; reason: 'same_event' | 'same_source' }[]
}

/** One issue in the public newsletter archive (`GET /api/newsletters`). */
export interface PublicNewsletterIssueSummary {
  slug: string
  title: string
  edition: NewsletterEdition
  publishedAt: string
  storyCount: number
}

/** One published issue's web edition (`GET /api/newsletters/:slug`). */
export interface PublicNewsletterIssue {
  slug: string
  title: string
  edition: NewsletterEdition
  publishedAt: string
  /** The issue's AI label, the same wording as at the top of the email */
  aiLabel: { lead: string; text: string }
  /** The issue's Markdown, without the email template's machine markers */
  content: string
  stories: {
    /**
     * The `## ` heading this story has in `content`: taken from the content's story marker, so a
     * heading edited by hand or a story renamed later stays matched; for an issue generated before
     * the marker existed, the story's title
     */
    headline: string
    title: string | null
    titleLabel: string | null
    sourceTitle: string
    sourceUrl: string
    publisher: string
    /** Null when the story is no longer published */
    slug: string | null
  }[]
  aiGenerated: { fields: string[]; digitalSourceType: string }
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

/** `weekly`: this ISO week's episode, the only kind the jobs touch; `standalone`: built by hand from any published stories, published by hand only. */
export type PodcastKind = 'weekly' | 'standalone'

/** The show: `full` is Actually Relevant; `uplifting` is Actually Uplifting, made from the week's uplifting stories (weekly only). */
export type PodcastEdition = 'full' | 'uplifting'

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
  /** Null for legacy and standalone rows. */
  weekKey: string | null
  kind: PodcastKind
  edition: PodcastEdition
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

/**
 * What the Friday automatic run does with this week's slot: `create` when the week has no episode
 * yet; otherwise the cron's own rule for the claimed episode (`finished`: nothing new this week,
 * `waiting-for-person`: an interactive episode is left to its person, `blocked`: skipped until a
 * person resumes it, `advance`: continued and finished automated).
 */
export type PodcastFridayRun = 'create' | 'finished' | 'waiting-for-person' | 'blocked' | 'advance'

/**
 * This ISO week's weekly-episode slot (UTC), read without creating a row. `fridayWindow`: `ahead`
 * before Friday, `open` while Friday's automatic slots still run, `passed` once the last slot has
 * gone by (Friday 19:00 UTC) through Sunday.
 * `automaticRunEnabled`: whether the show's generate job (generate_podcast, generate_uplifting_podcast) is switched on.
 * `showProblem`: why the show's week episode cannot be opened or run now (Actually Uplifting while it
 * is switched off, naming what it waits for); null when it can.
 */
export interface PodcastWeekSlot {
  edition: PodcastEdition
  weekKey: string
  episode: PodcastListItem | null
  fridayRun: PodcastFridayRun
  fridayWindow: 'ahead' | 'open' | 'passed'
  automaticRunEnabled: boolean
  showProblem: string | null
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
  /** Why the episode cannot be published now (the server's own refusal, or a run in progress); null when it can, and while it is listed. */
  publishBlockedReason: string | null
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

/** A published story as a standalone episode's story finder lists it (search results and suggestions). */
export interface PodcastStoryCandidate {
  id: string
  title: string
  publisher: string
  sourceUrl: string
  slug: string | null
  issue: string
  relevance: number | null
  dateCrawled: string
}

/** One page of the story finder's results, with the episode's story limits. */
export interface PodcastStorySearchResult extends PaginatedResponse<PodcastStoryCandidate> {
  minStories: number
  maxStories: number
}

/** The story finder's filters: when the story was found (ISO datetimes), its issue, a text search. */
export interface PodcastStoryFilters {
  crawledAfter?: string
  crawledBefore?: string
  issueId?: string
  search?: string
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
  /** The show the episode belongs to; its transcript page links that show. */
  edition: PodcastEdition
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

/** One part of a published episode's conversation, as spoken: under the story it is about, if any. */
export interface PublicPodcastTranscriptSegment {
  /** Null for the opener, intro, outro and sign-off. */
  story: { title: string; publisher: string; sourceUrl: string; slug: string | null } | null
  /** Each turn under its generic AI host's name, audio tags left out. */
  turns: { speaker: 'Host A' | 'Host B'; text: string }[]
}

/** `GET /api/podcast/episodes/:id`: one published episode with its readable transcript. */
export interface PublicPodcastEpisodeDetail extends PublicPodcastEpisode {
  transcript: PublicPodcastTranscriptSegment[]
}

/** `GET /api/podcast[?edition=uplifting]`: the show and its published episodes, newest first. */
export interface PublicPodcastResponse {
  show: {
    title: string
    description: string
    feedUrl: string
    artworkUrl: string
    listenLinks: { name: string; url: string }[]
  }
  episodes: PublicPodcastEpisode[]
  /** Whether Actually Uplifting is public; the pages link it only then. */
  upliftingShowOpen: boolean
}

/**
 * `GET /api/stories/:slug/appearances`: the first published newsletter issue and podcast episode
 * that carried the story, each as its own public list serves it; null where none did.
 */
export interface PublicStoryAppearances {
  newsletterIssue: PublicNewsletterIssueSummary | null
  podcastEpisode: PublicPodcastEpisode | null
}

/** A saved script edit: the episode and the style warnings (segues, outro sign-off) the person may keep. */
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
  /** Last finished run, success or failure. */
  lastCompletedAt: string | null
  /** Last run that finished without an error. */
  lastSucceededAt: string | null
  lastError: string | null
  enabled: boolean
  /** A run is under way in any server process (in memory, or a live job lease). */
  running: boolean
  cronExpression: string
  /** IANA zone the cron expression is read in; null for the server's own clock. */
  timeZone: string | null
  /** The job's main setting in a few words (e.g. the cleanup's age cutoff); null when it has none to show. */
  setting?: string | null
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
  accessTier?: 'locked' | 'metered'
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

export interface LifetimeMonthRow {
  /** YYYY-MM, by crawl date */
  month: string
  crawled: number
  screened: number
  assessed: number
  published: number
  /** Of `crawled`, deleted by the monthly cleanup */
  archived: number
}

/** One feed or issue in the lifetime totals */
export interface LifetimeGroupRow {
  id: string
  name: string
  crawled: number
  published: number
  archived: number
  avgRelevancePre: number | null
  /** Stories with a screening rating of 7 or more */
  highPre: number
}

/** GET /api/admin/stories/lifetime-stats: live stories plus those the monthly cleanup deleted. */
export interface LifetimeStoryStats {
  total: number
  archived: number
  byStatus: Record<string, number>
  /** Keys "1".."10", or "none" for never rated */
  byRelevancePre: Record<string, number>
  byRelevance: Record<string, number>
  /** Newest month first */
  byMonth: LifetimeMonthRow[]
  /** Most crawled first */
  byFeed: LifetimeGroupRow[]
  byIssue: LifetimeGroupRow[]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// --- Story research types (admin only; server/src/services/researchRuns.ts) ---

/** This UTC month's research spend against the cap, and whether a run may start now. */
export interface ResearchUsage {
  /** Key present and every step's model priced. */
  enabled: boolean
  /** Why a run would be refused now (switched off, unpriced model, cap reached), or null. */
  refusal: string | null
  /**
   * Why no run can be applied now (research switched off, or the owner's gate
   * `RESEARCH_APPLY_ENABLED` closed), or null. Reverting is never refused for these.
   */
  applyRefusal: string | null
  monthToDateUsd: number
  monthlyCapUsd: number
  /** What each run reserves when it starts. */
  reservationUsd: number
}

export type ResearchStep = 'confirm' | 'queries' | 'extract' | 'earlier' | 'write' | 'fact-check' | 'rewrite'
export type ResearchCallOutcome = 'ok' | 'parse_failure' | 'empty' | 'truncated' | 'error' | 'skipped'

export interface ResearchTokenUsage {
  input: number
  cached: number
  /** Reasoning tokens included. */
  output: number
  reasoning: number
}

export interface ResearchStepCall {
  step: ResearchStep
  outcome: ResearchCallOutcome
  usage: ResearchTokenUsage
  costUsd: number
  model: string
}

export interface ResearchFact {
  /** `S2F3`: source 2, fact 3; `E1F2` for our own earlier stories. */
  id: string
  statement: string
  supportingSentence: string
  measures: string
  /** The supporting sentence occurs in the source text. */
  found: boolean
}

export interface ResearchVoice {
  name: string
  role: string
  stance: string
  quote: string
}

export interface ResearchSource {
  /** `S0` is the original article. */
  id: string
  origin: 'original' | 'cluster' | 'neighbour' | 'search'
  url: string
  title: string
  outlet: string
  date: string | null
  favicon: string | null
  usedRawContent: boolean
  kind: 'news-report' | 'analysis' | 'opinion' | 'press-release' | 'official-body' | 'other'
  country: string
  relation: 'same-development' | 'background' | 'off-topic'
  facts: ResearchFact[]
  voices: ResearchVoice[]
}

export interface ResearchEarlier {
  /** `E1`: our own earlier story. */
  id: string
  storyId: string
  slug: string | null
  title: string
  date: string
  relation: 'earlier-development' | 'background' | 'unrelated'
  facts: ResearchFact[]
}

export interface ResearchCitedText {
  text: string
  factIds: string[]
}

/** The draft the write step returned, as its schema shapes it. */
export interface ResearchDraft {
  titleLabel: string
  title: string
  story: { sentences: ResearchCitedText[] }[]
  summary: string
  whyThisMatters: ResearchCitedText[]
  caveats: ResearchCitedText[]
  quote: string
  quoteAttribution: string
  quoteSourceId: string
  marketingBlurb: string
  relevanceCalculation: string[]
  rating: number
  oldNews: { isOld: boolean; firstHappened: string }
  contradicted: { isContradicted: boolean; factIds: string[] }
}

export type ResearchVerdict =
  | { kind: 'keep' }
  | { kind: 'research-rating'; rating: number }
  | { kind: 'stale'; firstHappened: string }
  | { kind: 'contradicted'; factIds: string[] }
  | { kind: 'fallback'; reason: string }

/** A run's stored result: what the research found, the model of each step and the prices it ran at. */
export interface ResearchResult {
  storyId: string
  calls: ResearchStepCall[]
  credits: number
  searches: { query: string; language: string; results: number; credits: number; cached: boolean }[]
  candidates: number
  drops: Partial<Record<string, number>>
  sources: ResearchSource[]
  earlier: ResearchEarlier[]
  /** The last draft written, also when it failed the check. */
  draft: ResearchDraft | null
  rewritten: boolean
  problems: { label: string; text: string; problem: string }[]
  support: { facts: number; found: number }
  /** Whether publishers' AI opt-outs were checked. */
  optOutChecked: boolean
  verdict: ResearchVerdict
  models: Record<ResearchStep, string>
  prices: {
    models: Record<string, { input: number; cached: number; output: number }>
    cacheWriteFactor: number
    tavilyUsdPerCredit: number
  }
}

export interface ResearchCostLine {
  calls: number
  usage: ResearchTokenUsage
  usd: number
  models: string[]
}

export interface ResearchRunCost {
  /** Steps that made a call, in step order. */
  steps: ({ step: ResearchStep } & ResearchCostLine)[]
  model: ResearchCostLine
  tavily: { credits: number; usd: number }
  totalUsd: number
}

export interface ResearchRun {
  id: string
  storyId: string | null
  status: 'running' | 'completed' | 'failed'
  verdict: ResearchVerdict['kind'] | null
  /** The reservation while running; the measured cost once completed; a failed run keeps its reservation. */
  costUsd: number
  tavilyCredits: number
  error: string | null
  startedAt: string
  finishedAt: string | null
  result: ResearchResult | null
  cost: ResearchRunCost | null
}

// --- Background task types ---

/** `research`: one story's research run; its story counts as processing while it runs. */
export type BulkTaskType = 'preassess' | 'assess' | 'select' | 'reclassify' | 'emotion' | 'research'
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
