/** Every `reasoning_effort` value an OpenAI model accepts; each model accepts a subset (see createChatModel). */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

/**
 * Parse a reasoning-effort env value. Unset or empty → fallback; anything
 * outside REASONING_EFFORTS throws at startup, because a typo would otherwise
 * reach the API and fail every call on that tier.
 */
export function parseEffort(value: string | undefined, fallback: ReasoningEffort, varName: string): ReasoningEffort {
  if (value === undefined || value === '') return fallback
  const effort = REASONING_EFFORTS.find(e => e === value)
  if (!effort) {
    throw new Error(`${varName}="${value}" is not a reasoning effort; expected one of ${REASONING_EFFORTS.join(', ')}`)
  }
  return effort
}

export const COOKIE_SAME_SITE_VALUES = ['strict', 'lax', 'none'] as const
export type CookieSameSite = (typeof COOKIE_SAME_SITE_VALUES)[number]

/**
 * Parse a cookie SameSite override. Unset or empty → undefined (the caller's
 * environment default applies); anything else outside the three values throws
 * at startup, since a typo would silently break every admin session.
 */
export function parseSameSite(value: string | undefined, varName: string): CookieSameSite | undefined {
  if (value === undefined || value === '') return undefined
  const sameSite = COOKIE_SAME_SITE_VALUES.find(v => v === value.toLowerCase())
  if (!sameSite) {
    throw new Error(`${varName}="${value}" is not a SameSite value; expected one of ${COOKIE_SAME_SITE_VALUES.join(', ')}`)
  }
  return sameSite
}

export interface JobLeaseTiming {
  leaseSeconds: number
  leaseRenewMs: number
}

function parsePositiveSeconds(value: string | undefined, fallback: number, varName: string): number {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${varName}="${value}" is not a positive whole number of seconds`)
  }
  return Number(value)
}

/**
 * Parse the cross-instance job lease timing (ADR-0020). Defaults: a 2-minute lease renewed every
 * 30 seconds. Throws at startup on a value that is not a positive whole number of seconds, or on a
 * renewal interval longer than half the lease, which would leave a run fewer than two renewal
 * chances before its lease runs out and let another process start the same job mid-run.
 */
export function parseJobLeaseTiming(leaseValue: string | undefined, renewValue: string | undefined): JobLeaseTiming {
  const leaseSeconds = parsePositiveSeconds(leaseValue, 120, 'JOB_LEASE_SECONDS')
  const renewSeconds = parsePositiveSeconds(renewValue, 30, 'JOB_LEASE_RENEW_SECONDS')
  if (renewSeconds * 2 > leaseSeconds) {
    throw new Error(
      `JOB_LEASE_RENEW_SECONDS=${renewSeconds} must be at most half of JOB_LEASE_SECONDS=${leaseSeconds}`
    )
  }
  return { leaseSeconds, leaseRenewMs: renewSeconds * 1000 }
}

export const config = {
  auth: {
    /**
     * A refresh token presented again within this long after it was rotated is
     * treated as a lost response (reload mid-refresh, two tabs, network drop) and
     * gets a fresh token in the same family; later reuse still revokes the family.
     */
    refreshReuseGraceMs: parseInt(process.env.AUTH_REFRESH_REUSE_GRACE_MS || "60000", 10),
    /**
     * SameSite for the refresh cookie. Unset: 'none' in production (API on a
     * different site from the admin), 'strict' in development. Set 'strict' once
     * the API is served from the same site as the admin (see .context/authentication.md).
     */
    cookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAMESITE, 'AUTH_COOKIE_SAMESITE'),
  },
  /** Canonical public URL for the site — used in social media posts, RSS feeds, sitemaps, etc. */
  siteUrl: process.env.SITE_URL || 'https://actuallyrelevant.news',
  /** Public client (frontend) URL — used to build links the visitor clicks, e.g. the subscription confirmation page. */
  clientUrl: process.env.CLIENT_URL || 'https://actuallyrelevant.news',
  database: {
    // Interactive-transaction execution timeout. Prisma's default is 5000ms, which the
    // bulk publish path exceeded on the remote DB when the `selected` backlog was large.
    // 15s is generous headroom for the (now single-statement) slug + status writes while
    // still failing fast rather than pinning a connection from the small pool for too long.
    transactionTimeoutMs: parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS || "15000", 10),
  },
  llm: {
    // GPT-6 defaults from the 2026-09-24 model eval (.context/model-eval.md). The
    // rating, dedup, social, assessment and selection prompts are tuned for these
    // models: overriding a tier back to a gpt-5 model without the matching prompts
    // shifts ratings and dedup (.context/llm-analysis.md).
    models: {
      small: {
        name: process.env.OPENAI_MODEL_SMALL || "gpt-6-luna",
        reasoningEffort: parseEffort(process.env.OPENAI_EFFORT_SMALL, "low", "OPENAI_EFFORT_SMALL"),
      },
      medium: {
        name: process.env.OPENAI_MODEL_MEDIUM || "gpt-6-luna",
        reasoningEffort: parseEffort(process.env.OPENAI_EFFORT_MEDIUM, "medium", "OPENAI_EFFORT_MEDIUM"),
      },
      large: {
        name: process.env.OPENAI_MODEL_LARGE || "gpt-6-sol",
        reasoningEffort: parseEffort(process.env.OPENAI_EFFORT_LARGE, "medium", "OPENAI_EFFORT_LARGE"),
      },
    },
    delayMs: parseInt(process.env.LLM_DELAY_MS || "500", 10),
  },
  preassess: {
    batchSize: 10,
    contentMaxLength: 1200,
    modelTier: "medium" as const,
  },
  assess: {
    contentMaxLength: 4000,
    fullAssessmentThreshold: 5,
    modelTier: "medium" as const,
  },
  selection: {
    maxGroupSize: parseInt(process.env.SELECT_MAX_GROUP_SIZE || "20", 10),
    ratio: parseFloat(process.env.SELECT_RATIO || "0.5"),
    relevanceMin: parseInt(process.env.SELECT_RELEVANCE_MIN || "5", 10),
    modelTier: "large" as const,
  },
  publish: {
    // Bulk publish processes the `selected` backlog in chunks of this size so the
    // per-chunk embedding fetch and slug-locked transaction stay bounded — a large
    // backlog publishes over several bounded passes rather than one unbounded one.
    chunkSize: parseInt(process.env.PUBLISH_CHUNK_SIZE || "100", 10),
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    // Changing dimensions requires a DB migration to alter the vector(1536) column and rebuild the index
    dimensions: 1536,
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '100', 10),
    concurrency: parseInt(process.env.EMBEDDING_CONCURRENCY || '5', 10),
    delayMs: parseInt(process.env.EMBEDDING_DELAY_MS || '100', 10),
  },
  crawl: {
    rssItemLimit: parseInt(process.env.RSS_ITEM_LIMIT || "30", 10),
    httpTimeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS || "10000", 10),
    minContentLength: parseInt(process.env.MIN_CONTENT_LENGTH || "300", 10),
    // Skip local JSDOM/cheerio parsing for pages larger than this (bytes) and defer
    // to the API extraction tier. A multi-MB HTML string expands ~10-20x as a DOM,
    // and that native memory counts against Render's RSS limit — so a single huge
    // page can OOM the crawl regardless of concurrency. The HTTP fetch is separately
    // capped at 5 MB; this bounds what we hand to the parser. Default 2 MB.
    maxParseBytes: parseInt(process.env.MAX_PARSE_BYTES || String(2 * 1024 * 1024), 10),
    staleAfterEmptyCrawls: parseInt(
      process.env.STALE_AFTER_EMPTY_CRAWLS || "5",
      10
    ),
    extractionApi: (process.env.EXTRACTION_API || "diffbot") as
      | "diffbot"
      | "pipfeed",
    diffbotTimeoutMs: parseInt(process.env.DIFFBOT_TIMEOUT_MS || "15000", 10),
    diffbotRateLimit: parseInt(process.env.DIFFBOT_RATE_LIMIT || "5", 10),
    pipfeedTimeoutMs: parseInt(process.env.PIPFEED_TIMEOUT_MS || "15000", 10),
    maxConcurrencyPerDomain: parseInt(
      process.env.MAX_CONCURRENCY_PER_DOMAIN || "2",
      10
    ),
    minDelayPerDomainMs: parseInt(
      process.env.MIN_DELAY_PER_DOMAIN_MS || "200",
      10
    ),
    localFailThreshold: parseInt(process.env.LOCAL_FAIL_THRESHOLD || "3", 10),
    totalFailThreshold: parseInt(process.env.TOTAL_FAIL_THRESHOLD || "3", 10),
  },
  content: {
    storyAssignmentDays: parseInt(process.env.STORY_ASSIGNMENT_DAYS || "7", 10),
  },
  newsletter: {
    storiesPerIssue: parseInt(
      process.env.NEWSLETTER_STORIES_PER_ISSUE || "2",
      10
    ),
    selectModelTier: "large" as const,
    contentModelTier: "large" as const,
    // Weekly job guard: a built automatic issue newer than this blocks the next run.
    // 156 h (6.5 days) covers a Sunday catch-up as early as 00:00 (148 h before the
    // next Saturday 04:00 cron) yet lets a Saturday run started up to 16:00 (>= 156 h
    // before the next one, e.g. a 12:00 retry at 160 h) not block next week's issue.
    minHoursBetweenIssues: 156,
    // An unbuilt automatic draft for this week older than this is a run that was
    // killed mid-pipeline; the next run deletes it and rebuilds.
    abandonedDraftMinutes: 30,
  },
  // Weekly two-speaker podcast (.context/podcast.md). Constants changed in code, no environment
  // overrides; on/off is the generate_podcast / publish_podcast job rows in the admin Jobs page.
  podcast: {
    // Derived, never set: dev always runs a dry run, production never does.
    dryRun: process.env.NODE_ENV !== "production",
    maxStories: 5,
    minStories: 4,
    // "Suggest stories" for a standalone episode: the most relevant published stories matching the
    // finder's filters, at most this many, go to the selection call (the weekly pool is the 7-day window).
    suggestPoolMax: 60,
    selectModelTier: "large" as const,
    scriptModelTier: "large" as const,
    // Spoken characters of the whole episode, code-added opener and sign-off and audio tags included.
    // Also the per-episode TTS ceiling. Top raised to 6200 (about 6.5 minutes; owner, 2026-10-06)
    // to fit how long gpt-6-sol writes. Validation only; the prompt states spokenCharAim.
    spokenCharBand: [4200, 6200] as const,
    // The whole-episode length the prompt states (about 4,700 for the model's own turns), set below
    // the band's middle on purpose: gpt-6-sol writes about 20% over its stated aim, so aiming at the
    // middle (5,000 own) overshot the top in 2 of 3 drafts (.context/prompting.md).
    spokenCharAim: 4900,
    maxTurnChars: 400,
    maxTagsPerTurn: 2,
    maxTitleChars: 80,
    // A segment's opening turn must carry a spoken bridge of at least this many characters.
    minBridgeChars: 40,
    // Automatic (cron) failures in one ISO week before the episode is blocked with an alert.
    maxAttemptsPerWeek: 3,
    // Lease on the stage machine, renewed at every stage (database clock).
    leaseMinutes: 30,
    // Phase 0 outcomes (2026-10-06), used from the audio phase on.
    voiceIdA: "gOupLcAkjEnguROwi4oS", // Darian – Warm Grounded Storyteller (HOST_A)
    voiceIdB: "OZ0L6eISlOejga3XjDFt", // Talia – Warm Soft Guide (HOST_B)
    ttsModelId: "eleven_v4",
    continuityMode: "text" as const,
    segmentPauseMs: 700,
    chunkMaxChars: 1800,
    // About 4.3 episodes at ~5,500 plus one full re-voice (owner, 2026-10-06). Provisional:
    // S2 measured a promotional rate; re-measure one call after 2026-10-12.
    monthlyTtsCharCap: 32000,
    ownerEmail: "contact@actuallyrelevant.news",
    // Audio (phase 2). ElevenLabs returns CBR MP3 at this format; the episode is re-encoded at the bitrate.
    ttsOutputFormat: "mp3_44100_128",
    ttsSeed: 412026,
    // previous_text / future_text context per side between chunks (ElevenLabs' limit).
    continuityChars: 100,
    audioBitrateKbps: 128,
    loudnessLufs: -16,
    // Dry-run stub voice: silence as long as the characters would take to speak (~6,200 chars ≈ 6.5 min).
    stubCharsPerSecond: 16,
    // Public base URL of the Bunny pull zone (custom hostname, S4). Uploads use a fresh file name per
    // render: the CDN caches a deleted file for up to 30 days, so a path is never reused.
    audioBaseUrl: "https://audio.actuallyrelevant.news",
    showTitle: "Actually Relevant",
    // Publishing (phase 3). The feed's public URL is the Render rewrite of /podcast.xml to
    // /api/podcast/feed.xml (.context/seo.md); the API host is not used for it.
    feedPath: "/podcast.xml",
    // podcast:guid, fixed for good: UUIDv5 (Podcasting 2.0 namespace ead4c236-…) of
    // "actuallyrelevant.news/podcast.xml". Never change it, even if the feed moves.
    feedGuid: "097a5224-a76e-5f98-98e0-151f653772ae",
    showAuthor: "Actually Relevant",
    // Apple Podcasts categories (owner decision, 2026-10-07): Apple's exact names, a subcategory
    // nested in its parent; the feed escapes them. "Government" replaced "Society & Culture", which
    // Apple now wants with a subcategory, none of which fits the show.
    categories: [
      { name: "News", subcategory: "Daily News" },
      { name: "Science" },
      { name: "Government" },
    ] as { name: string; subcategory?: string }[],
    // Show artwork (itunes:image, required by Apple): 3000x3000 JPEG on Bunny under show/, built
    // deterministically from the brand logo (not AI-generated). A new image gets a new file name,
    // because the CDN caches the old one for up to 30 days.
    artworkUrl: "https://audio.actuallyrelevant.news/show/artwork-2026-10.jpg",
    // Directory listings, set once the show is listed (owner step after the first publish).
    listenLinks: [] as { name: string; url: string }[],
    // The automatic publish job only takes an episode that has been ready this long: one finished by
    // Friday evening still goes out on Saturday morning, and the owner has the evening to listen.
    autoPublishMinAgeHours: 8,
    // publish_podcast runs on this zone's clock (cron 07:00 Saturday, and its Saturday-only guard),
    // so it follows summer and winter time. Every other job runs on the server's clock (ADR-0013).
    publishTimeZone: "Europe/Berlin",
    // generate_podcast's window (UTC): Friday from 00:00 until this hour. Outside it the job does
    // nothing, so a boot catch-up on another day never starts an episode (ADR-0013).
    generateWindowEndHourUtc: 20,
    // From this UTC hour on Friday (the last generation slot), an interactive episode still
    // waiting for its person gets the one reminder.
    reminderFromHourUtc: 18,
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    baseUrl: "https://api.elevenlabs.io",
    timeoutMs: 120_000,
    maxResponseBytes: 20 * 1024 * 1024,
  },
  bunny: {
    storageZone: process.env.BUNNY_STORAGE_ZONE || "",
    storagePassword: process.env.BUNNY_STORAGE_PASSWORD || "",
    storageHost: "storage.bunnycdn.com",
    timeoutMs: 60_000,
  },
  scheduler: {
    // Boot retry when initScheduler fails (e.g. database down at restart):
    // delay starts at initRetryBaseMs and doubles up to initRetryMaxMs, forever.
    initRetryBaseMs: 5_000,
    initRetryMaxMs: 5 * 60_000,
    // One notifyJobFailure alert after this many failed attempts.
    initAlertAfterAttempts: 3,
    // SCHEDULER_ENABLED=false (or 0/no/off) schedules nothing in this process, e.g. a second
    // process against the production database; the admin Run button still works there.
    enabled: !['false', '0', 'no', 'off'].includes((process.env.SCHEDULER_ENABLED ?? '').trim().toLowerCase()),
    // Cross-instance job lease (ADR-0017, timing ADR-0020): held for leaseSeconds, renewed every
    // leaseRenewMs while the handler runs, so a crashed holder blocks its job for at most
    // leaseSeconds. JOB_LEASE_SECONDS (default 120) and JOB_LEASE_RENEW_SECONDS (default 30).
    ...parseJobLeaseTiming(process.env.JOB_LEASE_SECONDS, process.env.JOB_LEASE_RENEW_SECONDS),
  },
  feed: {
    size: parseInt(process.env.RSS_FEED_SIZE || "50", 10),
    cacheMaxAge: parseInt(process.env.RSS_CACHE_MAX_AGE || "900", 10),
  },
  sitemap: {
    cacheMaxAge: parseInt(process.env.SITEMAP_CACHE_MAX_AGE || "3600", 10),
  },
  rateLimit: {
    publicWindowMs: parseInt(
      process.env.RATE_LIMIT_PUBLIC_WINDOW_MS || String(15 * 60 * 1000),
      10
    ),
    publicMax: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX || "100", 10),
    expensiveWindowMs: parseInt(
      process.env.RATE_LIMIT_EXPENSIVE_WINDOW_MS || String(60 * 60 * 1000),
      10
    ),
    expensiveMax: parseInt(process.env.RATE_LIMIT_EXPENSIVE_MAX || "1000", 10),
    searchWindowMs: parseInt(process.env.RATE_LIMIT_SEARCH_WINDOW_MS || String(15 * 60 * 1000), 10),
    searchMax: parseInt(process.env.RATE_LIMIT_SEARCH_MAX || "20", 10),
  },
  concurrency: {
    preassess: parseInt(process.env.CONCURRENCY_PREASSESS || "10", 10),
    assess: parseInt(process.env.CONCURRENCY_ASSESS || "10", 10),
    select: parseInt(process.env.CONCURRENCY_SELECT || "10", 10),
    reclassify: parseInt(process.env.CONCURRENCY_RECLASSIFY || "10", 10),
    // Heavy: each concurrent crawl runs a JSDOM parse, which both saturates the
    // 0.5 vCPU AND allocates native/CSSOM memory counted against Render's ~512 MiB
    // RSS limit (NOT the V8 heap that --max-old-space-size bounds). Peak concurrent
    // parses = crawlFeeds * crawlArticles; keep it <= 2. Production runs 2 x 1 and
    // the defaults mirror that. The extractor's maxParseBytes guard bounds each
    // parse's peak so a single oversized page can't blow RSS on its own.
    crawlFeeds: parseInt(process.env.CONCURRENCY_CRAWL_FEEDS || "2", 10),
    crawlArticles: parseInt(process.env.CONCURRENCY_CRAWL_ARTICLES || "1", 10),
  },
  plunk: {
    secretKey: process.env.PLUNK_SECRET_KEY || "",
    publicKey: process.env.PLUNK_PUBLIC_KEY || "",
    fromEmail: process.env.PLUNK_FROM_EMAIL || "",
    fromName: process.env.PLUNK_FROM_NAME || "Actually Relevant",
    testSegmentId: process.env.PLUNK_TEST_SEGMENT_ID || "",

    baseUrl: "https://next-api.useplunk.com",
  },
  subscribe: {
    confirmTokenExpiryHours: parseInt(
      process.env.SUBSCRIBE_TOKEN_EXPIRY_HOURS || "24",
      10
    ),
    // Burst limiter: requests per short window per IP.
    rateLimitWindowMs: parseInt(
      process.env.SUBSCRIBE_RATE_LIMIT_WINDOW_MS || String(60 * 1000),
      10
    ),
    rateLimitMax: parseInt(process.env.SUBSCRIBE_RATE_LIMIT_MAX || "3", 10),
    // Sustained limiter: caps signups per IP over a long window (blunts rotating-burst bots).
    rateLimitDailyWindowMs: parseInt(
      process.env.SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS || String(24 * 60 * 60 * 1000),
      10
    ),
    rateLimitDailyMax: parseInt(process.env.SUBSCRIBE_RATE_LIMIT_DAILY_MAX || "20", 10),
    // Form-token anti-bot gate. Min fill time trips instant submitters; max age bounds replay.
    minFormFillMs: parseInt(process.env.SUBSCRIBE_MIN_FORM_FILL_MS || "1500", 10),
    formTokenMaxAgeMs: parseInt(
      process.env.SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS || String(30 * 60 * 1000),
      10
    ),
    // HMAC key for form tokens. Dedicated secret, falling back to JWT_SECRET so it works out of the box.
    formTokenSecret: process.env.FORM_TOKEN_SECRET || process.env.JWT_SECRET || "",
  },
  relatedStories: {
    displayCount: 4,
    candidateMultiplier: 3, // fetch 12 candidates for 4 results
    cacheHours: 72, // 3 days in-memory
    httpCacheSeconds: 259200, // 3 days
    modelTier: 'small' as const,
  },
  feedQuality: {
    cacheMinutes: 10,
  },
  dedup: {
    maxCandidates: parseInt(process.env.DEDUP_MAX_CANDIDATES || '6', 10),
    timeWindowDays: parseInt(process.env.DEDUP_TIME_WINDOW_DAYS || '14', 10),
    enabled: process.env.DEDUP_ENABLED !== 'false',
    modelTier: 'small' as const,
  },
  bluesky: {
    handle: process.env.BLUESKY_HANDLE || '',
    appPassword: process.env.BLUESKY_APP_PASSWORD || '',
    serviceUrl: process.env.BLUESKY_SERVICE_URL || 'https://bsky.social',
    autoPost: {
      enabled: process.env.BLUESKY_AUTO_POST_ENABLED === 'true',
      lookbackHours: parseInt(process.env.BLUESKY_LOOKBACK_HOURS || '25', 10),
    },
    metrics: {
      maxAgeDays: parseInt(process.env.BLUESKY_METRICS_MAX_AGE_DAYS || '30', 10),
    },
    postDelayMs: parseInt(process.env.BLUESKY_POST_DELAY_MS || '2000', 10),
    postModelTier: 'medium' as const,
    pickModelTier: 'medium' as const,
  },
  mastodon: {
    instanceUrl: process.env.MASTODON_URL || '',
    accessToken: process.env.MASTODON_TOKEN || '',
    autoPost: {
      enabled: process.env.MASTODON_AUTO_POST_ENABLED === 'true',
    },
    metrics: {
      maxAgeDays: parseInt(process.env.MASTODON_METRICS_MAX_AGE_DAYS || '30', 10),
    },
    postDelayMs: parseInt(process.env.MASTODON_POST_DELAY_MS || '2000', 10),
    postModelTier: 'medium' as const,
    visibility: (process.env.MASTODON_VISIBILITY || 'unlisted') as 'public' | 'unlisted' | 'private',
    charLimit: parseInt(process.env.MASTODON_CHAR_LIMIT || '500', 10),
  },
  feedback: {
    rateLimitWindowMs: parseInt(process.env.FEEDBACK_RATE_LIMIT_WINDOW_MS || String(60 * 60 * 1000), 10),
    rateLimitMax: parseInt(process.env.FEEDBACK_RATE_LIMIT_MAX || '3', 10),
    messageMaxLength: 2000,
  },
  socialAutoPost: {
    lookbackHours: parseInt(process.env.SOCIAL_LOOKBACK_HOURS || process.env.BLUESKY_LOOKBACK_HOURS || '25', 10),
    pickModelTier: 'medium' as const,
  },
} as const;
