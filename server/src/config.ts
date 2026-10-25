import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

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

/**
 * Parse a whole-number env override (a count, a size, a duration in ms or hours). Unset or empty →
 * fallback; anything but plain digits, or a value below `min`, throws at startup. A bare parseInt
 * would turn a typo such as `60s` into NaN (or quietly read `60`), and the setting would misbehave
 * at run time instead of refusing the deploy. `min` is 1 unless 0 is a meaningful value (a delay,
 * a cache max-age, a disabled grace window).
 */
export function parseWholeNumber(value: string | undefined, fallback: number, varName: string, min = 1): number {
  if (value === undefined || value === '') return fallback
  if (!/^\d+$/.test(value) || Number(value) < min) {
    throw new Error(`${varName}="${value}" is not a whole number of at least ${min}`)
  }
  return Number(value)
}

/** Parse a fraction override between 0 and 1 inclusive (a ratio). Unset or empty → fallback; else throws at startup. */
export function parseFraction(value: string | undefined, fallback: number, varName: string): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!/^\d*\.?\d+$/.test(value) || n > 1) {
    throw new Error(`${varName}="${value}" is not a number between 0 and 1`)
  }
  return n
}

/** Parse an override that must be one of a fixed set of values. Unset or empty → fallback; else throws at startup. */
export function parseOneOf<T extends string>(value: string | undefined, fallback: T, allowed: readonly T[], varName: string): T {
  if (value === undefined || value === '') return fallback
  const match = allowed.find(v => v === value)
  if (!match) {
    throw new Error(`${varName}="${value}" is not one of ${allowed.join(', ')}`)
  }
  return match
}

export interface JobLeaseTiming {
  leaseSeconds: number
  leaseRenewMs: number
}

/**
 * Parse TRUST_PROXY, the number of proxy hops Express trusts when deriving
 * req.ip from X-Forwarded-For. Unset or empty → 1; anything but a plain
 * non-negative integer throws at startup, so a typo cannot silently become a
 * different trust level. `true` and address lists are rejected on purpose:
 * `true` trusts every entry a visitor sends.
 */
export function parseTrustProxyHops(value: string | undefined): number {
  if (value === undefined || value === '') return 1
  if (!/^\d+$/.test(value)) {
    throw new Error(`TRUST_PROXY="${value}" is not a hop count; expected a non-negative integer`)
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
  const leaseSeconds = parseWholeNumber(leaseValue, 120, 'JOB_LEASE_SECONDS')
  const renewSeconds = parseWholeNumber(renewValue, 30, 'JOB_LEASE_RENEW_SECONDS')
  if (renewSeconds * 2 > leaseSeconds) {
    throw new Error(`JOB_LEASE_RENEW_SECONDS=${renewSeconds} must be at most half of JOB_LEASE_SECONDS=${leaseSeconds}`)
  }
  return { leaseSeconds, leaseRenewMs: renewSeconds * 1000 }
}

/** Canonical public URL for the site; one default for every setting built on it. */
const siteUrl = process.env.SITE_URL || 'https://actuallyrelevant.news'

const configDir = dirname(fileURLToPath(import.meta.url))

// The `get` settings below read the environment when used, not when config.ts loads, as their
// callers did before they moved here: tests set these variables after import.
export const config = {
  /** NODE_ENV is `production` (Render). */
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  },
  /** Port the server listens on; Render sets PORT. */
  port: parseWholeNumber(process.env.PORT, 3001, 'PORT'),
  /** The admin and public site's origin, allowed by CORS beside the local dev origins ('' = none). */
  get frontendUrl(): string {
    return process.env.FRONTEND_URL || ''
  },
  log: {
    dir: process.env.LOG_DIR || 'logs',
    retentionDays: parseWholeNumber(process.env.LOG_RETENTION_DAYS, 14, 'LOG_RETENTION_DAYS'),
    /** Unset: `info` in production, `debug` elsewhere. */
    level: process.env.LOG_LEVEL || '',
  },
  /**
   * Proxy hops between the visitor and the server (Cloudflare, then Render's proxies).
   * Too low: req.ip is a proxy address and visitors share every rate-limit bucket.
   * Too high: a visitor picks their own bucket via X-Forwarded-For, bypassing limits.
   * Set it to the count `GET /health/client-ip` confirms; see .context/deployment.md.
   */
  trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY),
  auth: {
    /**
     * A refresh token presented again within this long after it was rotated is
     * treated as a lost response (reload mid-refresh, two tabs, network drop) and
     * gets a fresh token in the same family; later reuse still revokes the family.
     */
    refreshReuseGraceMs: parseWholeNumber(process.env.AUTH_REFRESH_REUSE_GRACE_MS, 60_000, 'AUTH_REFRESH_REUSE_GRACE_MS', 0),
    /**
     * SameSite for the refresh cookie. Unset: 'none' in production (API on a
     * different site from the admin), 'strict' in development. Set 'strict' once
     * the API is served from the same site as the admin (see .context/authentication.md).
     */
    cookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAMESITE, 'AUTH_COOKIE_SAMESITE'),
    /** Signs access tokens; signing and verifying throw while it is unset. */
    get jwtSecret(): string {
      return process.env.JWT_SECRET || ''
    },
    /** Static API key accepted by requireApiKey ('' = no key accepted). */
    get publicApiKey(): string {
      return process.env.PUBLIC_API_KEY || ''
    },
    // The settings below are security choices with no env override on purpose: changing one is a
    // reviewed code change (.context/authentication.md), not a dashboard edit.
    /** Lifetime of an access token (jsonwebtoken `expiresIn`). */
    accessTokenExpiry: '15m',
    /** Lifetime of a refresh token, and the refresh cookie's maxAge. */
    refreshTokenLifetimeMs: 24 * 60 * 60 * 1000,
    /** bcrypt cost for stored password hashes. */
    bcryptRounds: 12,
  },
  /** Canonical public URL for the site — used in social media posts, RSS feeds, sitemaps, etc. */
  siteUrl,
  /** Public API origin: the OpenAPI spec's server and absolute og:image URLs (crawlers need them absolute). */
  apiUrl: process.env.API_URL || 'https://api.actuallyrelevant.news',
  /** Public client (frontend) URL — used to build links the visitor clicks, e.g. the subscription confirmation page. */
  clientUrl: process.env.CLIENT_URL || 'https://actuallyrelevant.news',
  database: {
    // Interactive-transaction execution timeout. Prisma's default is 5000ms, which the
    // bulk publish path exceeded on the remote DB when the `selected` backlog was large.
    // 15s is generous headroom for the (now single-statement) slug + status writes while
    // still failing fast rather than pinning a connection from the small pool for too long.
    transactionTimeoutMs: parseWholeNumber(process.env.DB_TRANSACTION_TIMEOUT_MS, 15_000, 'DB_TRANSACTION_TIMEOUT_MS'),
  },
  llm: {
    // GPT-6 defaults from the 2026-09-24 model eval (.context/model-eval.md). The
    // rating, dedup, social, assessment and selection prompts are tuned for these
    // models: overriding a tier back to a gpt-5 model without the matching prompts
    // shifts ratings and dedup (.context/llm-analysis.md).
    models: {
      small: {
        name: process.env.OPENAI_MODEL_SMALL || 'gpt-6-luna',
        reasoningEffort: parseEffort(process.env.OPENAI_EFFORT_SMALL, 'low', 'OPENAI_EFFORT_SMALL'),
      },
      medium: {
        name: process.env.OPENAI_MODEL_MEDIUM || 'gpt-6-luna',
        reasoningEffort: parseEffort(process.env.OPENAI_EFFORT_MEDIUM, 'medium', 'OPENAI_EFFORT_MEDIUM'),
      },
      large: {
        name: process.env.OPENAI_MODEL_LARGE || 'gpt-6-sol',
        reasoningEffort: parseEffort(process.env.OPENAI_EFFORT_LARGE, 'medium', 'OPENAI_EFFORT_LARGE'),
      },
    },
    delayMs: parseWholeNumber(process.env.LLM_DELAY_MS, 500, 'LLM_DELAY_MS', 0),
  },
  preassess: {
    batchSize: 10,
    contentMaxLength: 1200,
    modelTier: 'medium' as const,
  },
  assess: {
    contentMaxLength: 4000,
    fullAssessmentThreshold: 5,
    modelTier: 'medium' as const,
  },
  selection: {
    maxGroupSize: parseWholeNumber(process.env.SELECT_MAX_GROUP_SIZE, 20, 'SELECT_MAX_GROUP_SIZE'),
    ratio: parseFraction(process.env.SELECT_RATIO, 0.5, 'SELECT_RATIO'),
    relevanceMin: parseWholeNumber(process.env.SELECT_RELEVANCE_MIN, 5, 'SELECT_RELEVANCE_MIN', 0),
    modelTier: 'large' as const,
  },
  publish: {
    // Bulk publish processes the `selected` backlog in chunks of this size so the
    // per-chunk embedding fetch and slug-locked transaction stay bounded — a large
    // backlog publishes over several bounded passes rather than one unbounded one.
    chunkSize: parseWholeNumber(process.env.PUBLISH_CHUNK_SIZE, 100, 'PUBLISH_CHUNK_SIZE'),
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    // Changing dimensions requires a DB migration to alter the vector(1536) column and rebuild the index
    dimensions: 1536,
    batchSize: parseWholeNumber(process.env.EMBEDDING_BATCH_SIZE, 100, 'EMBEDDING_BATCH_SIZE'),
    concurrency: parseWholeNumber(process.env.EMBEDDING_CONCURRENCY, 5, 'EMBEDDING_CONCURRENCY'),
    delayMs: parseWholeNumber(process.env.EMBEDDING_DELAY_MS, 100, 'EMBEDDING_DELAY_MS', 0),
  },
  crawl: {
    rssItemLimit: parseWholeNumber(process.env.RSS_ITEM_LIMIT, 30, 'RSS_ITEM_LIMIT'),
    httpTimeoutMs: parseWholeNumber(process.env.HTTP_TIMEOUT_MS, 10_000, 'HTTP_TIMEOUT_MS'),
    minContentLength: parseWholeNumber(process.env.MIN_CONTENT_LENGTH, 300, 'MIN_CONTENT_LENGTH', 0),
    // Skip local JSDOM/cheerio parsing for pages larger than this (bytes) and defer
    // to the API extraction tier. A multi-MB HTML string expands ~10-20x as a DOM,
    // and that native memory counts against Render's RSS limit — so a single huge
    // page can OOM the crawl regardless of concurrency. The HTTP fetch is separately
    // capped at 5 MB; this bounds what we hand to the parser. Default 2 MB.
    maxParseBytes: parseWholeNumber(process.env.MAX_PARSE_BYTES, 2 * 1024 * 1024, 'MAX_PARSE_BYTES'),
    staleAfterEmptyCrawls: parseWholeNumber(process.env.STALE_AFTER_EMPTY_CRAWLS, 5, 'STALE_AFTER_EMPTY_CRAWLS'),
    extractionApi: parseOneOf(process.env.EXTRACTION_API, 'diffbot', ['diffbot', 'pipfeed'] as const, 'EXTRACTION_API'),
    diffbotTimeoutMs: parseWholeNumber(process.env.DIFFBOT_TIMEOUT_MS, 15_000, 'DIFFBOT_TIMEOUT_MS'),
    diffbotRateLimit: parseWholeNumber(process.env.DIFFBOT_RATE_LIMIT, 5, 'DIFFBOT_RATE_LIMIT'),
    pipfeedTimeoutMs: parseWholeNumber(process.env.PIPFEED_TIMEOUT_MS, 15_000, 'PIPFEED_TIMEOUT_MS'),
    maxConcurrencyPerDomain: parseWholeNumber(process.env.MAX_CONCURRENCY_PER_DOMAIN, 2, 'MAX_CONCURRENCY_PER_DOMAIN'),
    minDelayPerDomainMs: parseWholeNumber(process.env.MIN_DELAY_PER_DOMAIN_MS, 200, 'MIN_DELAY_PER_DOMAIN_MS', 0),
    localFailThreshold: parseWholeNumber(process.env.LOCAL_FAIL_THRESHOLD, 3, 'LOCAL_FAIL_THRESHOLD'),
    totalFailThreshold: parseWholeNumber(process.env.TOTAL_FAIL_THRESHOLD, 3, 'TOTAL_FAIL_THRESHOLD'),
    /** Extraction API credentials ('' = that tier is skipped). */
    get diffbotToken(): string {
      return process.env.DIFFBOT_TOKEN || ''
    },
    get pipfeedApiKey(): string {
      return process.env.PIPFEED_API_KEY || ''
    },
    /** Where feed favicons are written; the client serves them from public/images/feeds. */
    get faviconDir(): string {
      return process.env.FAVICON_DIR || join(configDir, '..', '..', 'client', 'public', 'images', 'feeds')
    },
  },
  // Access classification at extraction (.context/content-extraction.md, "Access classification").
  // A page the publisher marks as not free is `locked` only with evidence of truncation: the
  // extracted words fall below minWordRatio x the page's JSON-LD wordCount, or the extracted text
  // (whitespace collapsed) is shorter than lockedMaxChars. Otherwise it is `metered`.
  paywall: {
    lockedMaxChars: parseWholeNumber(process.env.PAYWALL_LOCKED_MAX_CHARS, 1500, 'PAYWALL_LOCKED_MAX_CHARS', 0),
    minWordRatio: parseFraction(process.env.PAYWALL_MIN_WORD_RATIO, 0.3, 'PAYWALL_MIN_WORD_RATIO'),
  },
  content: {
    storyAssignmentDays: parseWholeNumber(process.env.STORY_ASSIGNMENT_DAYS, 7, 'STORY_ASSIGNMENT_DAYS'),
  },
  newsletter: {
    storiesPerIssue: parseWholeNumber(process.env.NEWSLETTER_STORIES_PER_ISSUE, 2, 'NEWSLETTER_STORIES_PER_ISSUE'),
    selectModelTier: 'large' as const,
    contentModelTier: 'large' as const,
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
    dryRun: process.env.NODE_ENV !== 'production',
    maxStories: 5,
    minStories: 4,
    // "Suggest stories" for a standalone episode: the most relevant published stories matching the
    // finder's filters, at most this many, go to the selection call (the weekly pool is the 7-day window).
    suggestPoolMax: 60,
    selectModelTier: 'large' as const,
    scriptModelTier: 'large' as const,
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
    voiceIdA: 'gOupLcAkjEnguROwi4oS', // Darian – Warm Grounded Storyteller (HOST_A)
    voiceIdB: 'OZ0L6eISlOejga3XjDFt', // Talia – Warm Soft Guide (HOST_B)
    ttsModelId: 'eleven_v4',
    continuityMode: 'text' as const,
    segmentPauseMs: 700,
    chunkMaxChars: 1800,
    // About 4.3 episodes at ~5,500 plus one full re-voice (owner, 2026-10-06). Provisional:
    // S2 measured a promotional rate; re-measure one call after 2026-10-12.
    monthlyTtsCharCap: 32000,
    ownerEmail: 'contact@actuallyrelevant.news',
    // Audio (phase 2). ElevenLabs returns CBR MP3 at this format; the episode is re-encoded at the bitrate.
    ttsOutputFormat: 'mp3_44100_128',
    ttsSeed: 412026,
    // previous_text / future_text context per side between chunks (ElevenLabs' limit).
    continuityChars: 100,
    audioBitrateKbps: 128,
    loudnessLufs: -16,
    // Dry-run stub voice: silence as long as the characters would take to speak (~6,200 chars ≈ 6.5 min).
    stubCharsPerSecond: 16,
    // Public base URL of the Bunny pull zone (custom hostname, S4). Uploads use a fresh file name per
    // render: the CDN caches a deleted file for up to 30 days, so a path is never reused.
    audioBaseUrl: 'https://audio.actuallyrelevant.news',
    showTitle: 'Actually Relevant',
    // Publishing (phase 3). The feed's public URL is the Render rewrite of /podcast.xml to
    // /api/podcast/feed.xml (.context/seo.md); the API host is not used for it.
    feedPath: '/podcast.xml',
    // podcast:guid, fixed for good: UUIDv5 (Podcasting 2.0 namespace ead4c236-…) of
    // "actuallyrelevant.news/podcast.xml". Never change it, even if the feed moves.
    feedGuid: '097a5224-a76e-5f98-98e0-151f653772ae',
    showAuthor: 'Actually Relevant',
    // Apple Podcasts categories (owner decision, 2026-10-07): Apple's exact names, a subcategory
    // nested in its parent; the feed escapes them. "Government" replaced "Society & Culture" and
    // "Technology" replaced "Science" (owner, 2026-10-07): Apple wants a subcategory for both, none
    // of which fits the show; Government and Technology have none.
    categories: [{ name: 'News', subcategory: 'Daily News' }, { name: 'Technology' }, { name: 'Government' }] as { name: string; subcategory?: string }[],
    // Show artwork (itunes:image, required by Apple): 3000x3000 JPEG on Bunny under show/, built
    // deterministically from the brand logo (not AI-generated). A new image gets a new file name,
    // because the CDN caches the old one for up to 30 days.
    artworkUrl: 'https://audio.actuallyrelevant.news/show/artwork-2026-10.jpg',
    // Directory listings, in the owner's priority order: Apple, Spotify, YouTube Music, Amazon Music,
    // Pocket Casts, then the rest. Add each as it is listed. Spotify is being verified (2026-10-22).
    listenLinks: [
      { name: 'Apple Podcasts', url: 'https://podcasts.apple.com/us/podcast/actually-relevant/id1751127139' },
      { name: 'Pocket Casts', url: 'https://pca.st/mni05hsb' },
    ] as { name: string; url: string }[],
    // The automatic publish job only takes an episode that has been ready this long: one finished by
    // Friday evening still goes out on Saturday morning, and the owner has the evening to listen.
    autoPublishMinAgeHours: 8,
    // publish_podcast runs on this zone's clock (cron 07:00 Saturday, and its Saturday-only guard),
    // so it follows summer and winter time. Every other job runs on the server's clock (ADR-0013).
    publishTimeZone: 'Europe/Berlin',
    // generate_podcast's window (UTC): Friday from 00:00 until this hour. Outside it the job does
    // nothing, so a boot catch-up on another day never starts an episode (ADR-0013).
    generateWindowEndHourUtc: 20,
    // From this UTC hour on Friday (the last generation slot), an interactive episode still
    // waiting for its person gets the one reminder.
    reminderFromHourUtc: 18,
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    baseUrl: 'https://api.elevenlabs.io',
    timeoutMs: 120_000,
    maxResponseBytes: 20 * 1024 * 1024,
  },
  bunny: {
    storageZone: process.env.BUNNY_STORAGE_ZONE || '',
    storagePassword: process.env.BUNNY_STORAGE_PASSWORD || '',
    storageHost: 'storage.bunnycdn.com',
    timeoutMs: 60_000,
  },
  scheduler: {
    // Boot retry when initScheduler fails (e.g. database down at restart):
    // delay starts at initRetryBaseMs and doubles up to initRetryMaxMs, forever.
    initRetryBaseMs: 5_000,
    initRetryMaxMs: 5 * 60_000,
    // One critical notice (notify) after this many failed attempts.
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
    size: parseWholeNumber(process.env.RSS_FEED_SIZE, 50, 'RSS_FEED_SIZE'),
    cacheMaxAge: parseWholeNumber(process.env.RSS_CACHE_MAX_AGE, 900, 'RSS_CACHE_MAX_AGE', 0),
  },
  sitemap: {
    cacheMaxAge: parseWholeNumber(process.env.SITEMAP_CACHE_MAX_AGE, 3600, 'SITEMAP_CACHE_MAX_AGE', 0),
  },
  rateLimit: {
    publicWindowMs: parseWholeNumber(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS, 15 * 60 * 1000, 'RATE_LIMIT_PUBLIC_WINDOW_MS'),
    publicMax: parseWholeNumber(process.env.RATE_LIMIT_PUBLIC_MAX, 100, 'RATE_LIMIT_PUBLIC_MAX'),
    expensiveWindowMs: parseWholeNumber(process.env.RATE_LIMIT_EXPENSIVE_WINDOW_MS, 60 * 60 * 1000, 'RATE_LIMIT_EXPENSIVE_WINDOW_MS'),
    expensiveMax: parseWholeNumber(process.env.RATE_LIMIT_EXPENSIVE_MAX, 1000, 'RATE_LIMIT_EXPENSIVE_MAX'),
    searchWindowMs: parseWholeNumber(process.env.RATE_LIMIT_SEARCH_WINDOW_MS, 15 * 60 * 1000, 'RATE_LIMIT_SEARCH_WINDOW_MS'),
    searchMax: parseWholeNumber(process.env.RATE_LIMIT_SEARCH_MAX, 20, 'RATE_LIMIT_SEARCH_MAX'),
    // Login and token refresh, per IP. Brute-force protection, so no env override (see config.auth).
    loginWindowMs: 15 * 60 * 1000,
    loginMax: 5,
    // More lenient: the admin client refreshes automatically
    refreshWindowMs: 15 * 60 * 1000,
    refreshMax: 30,
  },
  concurrency: {
    preassess: parseWholeNumber(process.env.CONCURRENCY_PREASSESS, 10, 'CONCURRENCY_PREASSESS'),
    assess: parseWholeNumber(process.env.CONCURRENCY_ASSESS, 10, 'CONCURRENCY_ASSESS'),
    select: parseWholeNumber(process.env.CONCURRENCY_SELECT, 10, 'CONCURRENCY_SELECT'),
    reclassify: parseWholeNumber(process.env.CONCURRENCY_RECLASSIFY, 10, 'CONCURRENCY_RECLASSIFY'),
    // Heavy: each concurrent crawl runs a JSDOM parse, which both saturates the
    // 0.5 vCPU AND allocates native/CSSOM memory counted against Render's ~512 MiB
    // RSS limit (NOT the V8 heap that --max-old-space-size bounds). Peak concurrent
    // parses = crawlFeeds * crawlArticles; keep it <= 2. Production runs 2 x 1 and
    // the defaults mirror that. The extractor's maxParseBytes guard bounds each
    // parse's peak so a single oversized page can't blow RSS on its own.
    crawlFeeds: parseWholeNumber(process.env.CONCURRENCY_CRAWL_FEEDS, 2, 'CONCURRENCY_CRAWL_FEEDS'),
    crawlArticles: parseWholeNumber(process.env.CONCURRENCY_CRAWL_ARTICLES, 1, 'CONCURRENCY_CRAWL_ARTICLES'),
  },
  plunk: {
    secretKey: process.env.PLUNK_SECRET_KEY || '',
    publicKey: process.env.PLUNK_PUBLIC_KEY || '',
    fromEmail: process.env.PLUNK_FROM_EMAIL || '',
    fromName: process.env.PLUNK_FROM_NAME || 'Actually Relevant',
    testSegmentId: process.env.PLUNK_TEST_SEGMENT_ID || '',

    baseUrl: 'https://next-api.useplunk.com',
    // The poll_plunk_activity job (ADR-0029): every run reads this trailing window of complaints
    // and bounces, whatever earlier runs saw; each event is recorded once by its activity id.
    activityLookbackDays: 30,
    activityPageLimit: 20,
    activityMaxPages: 20,
    // Activity items carry the email's body in metadata, so a page is far larger than the client's 1 MB cap.
    activityMaxResponseBytes: 5 * 1024 * 1024,
  },
  storyRetention: {
    // The cleanup_old_stories job (.context/story-retention.md): stories crawled longer ago than this
    // are deleted (unkept statuses only) or lose their embedding (every other unpublished story).
    // Shown on the admin Jobs page (jobs/jobSettings.ts). Owner-set (ADR-0042), so deliberately no env
    // override: what the site deletes is a reviewed decision, not a deploy setting.
    maxAgeMonths: 6,
    // Rows per statement; each delete batch and its roll-up commit together.
    batchSize: 500,
  },
  notices: {
    // Seen admin notices older than this (by last occurrence) are deleted; unseen ones are kept.
    retentionDays: 90,
    /** Optional forward of every notice to a chat webhook ('' = none). */
    get webhookUrl(): string {
      return process.env.WEBHOOK_URL || ''
    },
  },
  subscribe: {
    confirmTokenExpiryHours: parseWholeNumber(process.env.SUBSCRIBE_TOKEN_EXPIRY_HOURS, 24, 'SUBSCRIBE_TOKEN_EXPIRY_HOURS'),
    // Burst limiter: requests per short window per IP.
    rateLimitWindowMs: parseWholeNumber(process.env.SUBSCRIBE_RATE_LIMIT_WINDOW_MS, 60 * 1000, 'SUBSCRIBE_RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: parseWholeNumber(process.env.SUBSCRIBE_RATE_LIMIT_MAX, 3, 'SUBSCRIBE_RATE_LIMIT_MAX'),
    // Sustained limiter: caps signups per IP over a long window (blunts rotating-burst bots).
    rateLimitDailyWindowMs: parseWholeNumber(process.env.SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS, 24 * 60 * 60 * 1000, 'SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS'),
    rateLimitDailyMax: parseWholeNumber(process.env.SUBSCRIBE_RATE_LIMIT_DAILY_MAX, 20, 'SUBSCRIBE_RATE_LIMIT_DAILY_MAX'),
    // Form-token anti-bot gate. Min fill time trips instant submitters; max age bounds replay.
    minFormFillMs: parseWholeNumber(process.env.SUBSCRIBE_MIN_FORM_FILL_MS, 1500, 'SUBSCRIBE_MIN_FORM_FILL_MS', 0),
    formTokenMaxAgeMs: parseWholeNumber(process.env.SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS, 30 * 60 * 1000, 'SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS'),
    // HMAC key for form tokens. Dedicated secret, falling back to JWT_SECRET so it works out of the box.
    formTokenSecret: process.env.FORM_TOKEN_SECRET || process.env.JWT_SECRET || '',
    // The one signup switch. Closed unless explicitly 'true': a missing value means paused.
    enabled: process.env.SUBSCRIPTIONS_ENABLED === 'true',
    // Cloudflare Turnstile secret. Missing in production refuses every signup (fail closed).
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '',
    // At most one confirmation email per normalized address within this window.
    perAddressWindowHours: parseWholeNumber(process.env.SUBSCRIBE_PER_ADDRESS_WINDOW_HOURS, 24, 'SUBSCRIBE_PER_ADDRESS_WINDOW_HOURS'),
    // At most this many confirmation emails per rolling hour across all addresses.
    globalHourlyMax: parseWholeNumber(process.env.SUBSCRIBE_GLOBAL_HOURLY_MAX, 30, 'SUBSCRIBE_GLOBAL_HOURLY_MAX'),
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
    maxCandidates: parseWholeNumber(process.env.DEDUP_MAX_CANDIDATES, 6, 'DEDUP_MAX_CANDIDATES'),
    timeWindowDays: parseWholeNumber(process.env.DEDUP_TIME_WINDOW_DAYS, 14, 'DEDUP_TIME_WINDOW_DAYS'),
    enabled: process.env.DEDUP_ENABLED !== 'false',
    modelTier: 'small' as const,
  },
  bluesky: {
    handle: process.env.BLUESKY_HANDLE || '',
    appPassword: process.env.BLUESKY_APP_PASSWORD || '',
    serviceUrl: process.env.BLUESKY_SERVICE_URL || 'https://bsky.social',
    autoPost: {
      enabled: process.env.BLUESKY_AUTO_POST_ENABLED === 'true',
      lookbackHours: parseWholeNumber(process.env.BLUESKY_LOOKBACK_HOURS, 25, 'BLUESKY_LOOKBACK_HOURS'),
    },
    metrics: {
      maxAgeDays: parseWholeNumber(process.env.BLUESKY_METRICS_MAX_AGE_DAYS, 30, 'BLUESKY_METRICS_MAX_AGE_DAYS'),
    },
    postDelayMs: parseWholeNumber(process.env.BLUESKY_POST_DELAY_MS, 2000, 'BLUESKY_POST_DELAY_MS', 0),
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
      maxAgeDays: parseWholeNumber(process.env.MASTODON_METRICS_MAX_AGE_DAYS, 30, 'MASTODON_METRICS_MAX_AGE_DAYS'),
    },
    postDelayMs: parseWholeNumber(process.env.MASTODON_POST_DELAY_MS, 2000, 'MASTODON_POST_DELAY_MS', 0),
    postModelTier: 'medium' as const,
    visibility: parseOneOf(process.env.MASTODON_VISIBILITY, 'unlisted', ['public', 'unlisted', 'private'] as const, 'MASTODON_VISIBILITY'),
    charLimit: parseWholeNumber(process.env.MASTODON_CHAR_LIMIT, 500, 'MASTODON_CHAR_LIMIT'),
  },
  feedback: {
    rateLimitWindowMs: parseWholeNumber(process.env.FEEDBACK_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000, 'FEEDBACK_RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: parseWholeNumber(process.env.FEEDBACK_RATE_LIMIT_MAX, 3, 'FEEDBACK_RATE_LIMIT_MAX'),
    messageMaxLength: 2000,
    /**
     * Key for the HMAC of the visitor IP stored with feedback (ADR-0037). Unset: every
     * feedback submission is refused with 503, in every environment.
     */
    ipHashSecret: process.env.FEEDBACK_IP_HASH_SECRET || '',
  },
  socialAutoPost: {
    lookbackHours: parseWholeNumber(
      process.env.SOCIAL_LOOKBACK_HOURS || process.env.BLUESKY_LOOKBACK_HOURS,
      25,
      process.env.SOCIAL_LOOKBACK_HOURS ? 'SOCIAL_LOOKBACK_HOURS' : 'BLUESKY_LOOKBACK_HOURS',
    ),
    pickModelTier: 'medium' as const,
  },
  /** Story link previews: the og:image endpoint and the story-page shell route (.context/seo.md). */
  storyPreview: {
    /** The built client's index.html on the static site; the story-page route injects meta tags into it. */
    shellUrl: `${siteUrl}/index.html`,
    /** How long the fetched shell is reused before it is revalidated (short: it names the build's hashed assets). */
    shellCacheSeconds: parseWholeNumber(process.env.STORY_PAGE_SHELL_CACHE_SECONDS, 60, 'STORY_PAGE_SHELL_CACHE_SECONDS', 0),
    shellFetchTimeoutMs: 5000,
    /** Browser and CDN cache of the story-page HTML. */
    pageCacheSeconds: 60,
    /** In-memory cache of rendered pages, per slug. */
    pageCacheEntries: 200,
    /** HTTP cache lifetime of a story's og.png. */
    imageCacheSeconds: parseWholeNumber(process.env.STORY_OG_IMAGE_CACHE_SECONDS, 86400, 'STORY_OG_IMAGE_CACHE_SECONDS', 0),
    /** In-memory cache of rendered og.png images (about 50-150 KB each). */
    imageCacheEntries: 50,
    imageCacheTtlSeconds: 6 * 60 * 60,
  },
  /** Public newsletter archive (the issue list on `/newsletter`, `.context/newsletter-podcast.md`). */
  newsletterArchive: {
    cacheMaxAge: 300,
  },
} as const
