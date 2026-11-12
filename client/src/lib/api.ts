import type {
  PublicStory,
  PublicStoryDetail,
  PaginatedResponse,
  PublicPodcastResponse,
  PublicPodcastEpisodeDetail,
  PublicNewsletterIssue,
  PublicNewsletterIssueSummary,
  PublicStoryAppearances,
  NewsletterEdition,
  PodcastEdition,
} from '@shared/types'

export const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api'

/** RSS feed of the published newsletter issues (server/src/routes/public/newsletters.ts). */
export const NEWSLETTER_FEED_URL = `${API_BASE}/newsletters/feed.xml`

/** The public API's OpenAPI spec as JSON (server/src/routes/public/docs.ts), which the /developers reference renders. */
export const OPENAPI_SPEC_URL = `${API_BASE}/docs/openapi.json`

/**
 * A story's link-preview image (1200x630, served by the API); the site-wide image without a slug.
 * The server's story-page route injects the same URL for crawlers (server/src/lib/storyPreviewUrls.ts).
 */
export function storyOgImageUrl(slug: string | null | undefined): string {
  return slug ? `${API_BASE}/stories/${encodeURIComponent(slug)}/og.png` : 'https://actuallyrelevant.news/images/og-image.png'
}

/** A link-preview image as `CommonOgTags` (lib/seo.tsx) takes it. */
export interface OgImage {
  image: string
  imageType: string
}

/**
 * The card image of every newsletter issue or every podcast transcript page, and of `/newsletter`
 * and `/podcast` (1200x630 PNG, the logo and the section's name, the podcast's with the website's
 * "AI" badge, served by the API). The server's
 * link-preview pages name the same (server/src/services/sectionPreview.ts).
 */
export function sectionOgImage(section: 'newsletter' | 'podcast'): OgImage {
  return { image: `${API_BASE}/section-images/${section}.png`, imageType: 'image/png' }
}

/** A topic page's card image: the logo and the topic's name, as `sectionOgImage`. */
export function topicOgImage(slug: string): OgImage {
  return { image: `${API_BASE}/section-images/issues/${encodeURIComponent(slug)}.png`, imageType: 'image/png' }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason from the error body, e.g. `SIGNUPS_PAUSED`. */
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The API answered 404: what was asked for does not exist or is not published. Any other failure may pass on a retry. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** The API answered 429: this client asked too often, and a retry passes only once its rate-limit window has moved on. */
export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.error || res.statusText, typeof body.code === 'string' ? body.code : undefined)
  }

  return res.json()
}

function toQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value))
    }
  }
  const qs = searchParams.toString()
  return qs ? `?${qs}` : ''
}

export interface PublicIssue {
  id: string
  name: string
  slug: string
  description: string
  intro: string
  evaluationIntro: string
  evaluationCriteria: string[]
  sourceNames: string[]
  makeADifference: { label: string; url: string }[]
  parentId: string | null
  publishedStoryCount?: number
  children?: PublicIssue[]
  parent?: { id: string; name: string; slug: string } | null
}

export interface HomepageData {
  issues: PublicIssue[]
  storiesByIssue: Record<string, { uplifting: PublicStory[]; calm: PublicStory[]; negative: PublicStory[] }>
}

export const publicApi = {
  homepage: () => request<HomepageData>('/homepage'),

  stories: {
    list: (params?: { page?: number; pageSize?: number; issueSlug?: string; search?: string; emotionTags?: string }) =>
      request<PaginatedResponse<PublicStory>>(`/stories${toQueryString((params || {}) as Record<string, unknown>)}`),
    get: (slug: string) => request<PublicStoryDetail>(`/stories/${slug}`),
    related: (slug: string, limit = 4) => request<PublicStory[]>(`/stories/${slug}/related?limit=${limit}`),
    cluster: (slug: string) => request<{ sources: { feedTitle: string; sourceUrl: string }[] }>(`/stories/${slug}/cluster`),
    /** The newsletter issue and podcast episode the story appeared in, each null when none. */
    appearances: (slug: string) => request<PublicStoryAppearances>(`/stories/${slug}/appearances`),
  },

  issues: {
    list: () => request<PublicIssue[]>(`/issues`),
    get: (slug: string) => request<PublicIssue>(`/issues/${slug}`),
  },

  /** A podcast show (the main one by default): show information and published episodes, newest first. 404 for a show that is not public. */
  podcast: (edition: PodcastEdition = 'full') => request<PublicPodcastResponse>(`/podcast${edition === 'full' ? '' : toQueryString({ edition })}`),

  /** One published episode with its readable transcript (404 unless published). */
  podcastEpisode: (id: string) => request<PublicPodcastEpisodeDetail>(`/podcast/episodes/${encodeURIComponent(id)}`),

  /** Published newsletter issues, newest first (the web archive): both editions', or one edition's. */
  newsletterArchive: (page = 1, edition?: NewsletterEdition) =>
    request<PaginatedResponse<PublicNewsletterIssueSummary>>(`/newsletters${toQueryString({ page, edition })}`),

  /** One published newsletter issue's web edition; 404 unless published. */
  newsletterIssue: (slug: string) => request<PublicNewsletterIssue>(`/newsletters/${encodeURIComponent(slug)}`),

  sources: () => request<{ byRegion: Record<string, string[]>; byIssue: Record<string, string[]>; totalCount: number }>('/sources'),

  /** `edition`: the edition chosen in the form, sent only when the token offered the choice. */
  subscribe: (data: { email: string; website?: string; formToken?: string; turnstileToken?: string; edition?: NewsletterEdition }) =>
    request<{ success: boolean; message: string }>('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  /** A signup form token; `editionChoice`: the form offers the two editions (the server has them open). */
  getSubscribeToken: () => request<{ token: string; editionChoice?: boolean }>('/subscribe/token'),

  /**
   * Switch a subscriber, named by the contact id of an issue's footer link, to an edition. A refusal
   * is an ApiError whose `code` says why: `closed`, `broken_link`, `unknown_contact`, `not_subscribed`.
   */
  switchEdition: (data: { contactId: string; edition: NewsletterEdition }) =>
    request<{ success: true; edition: NewsletterEdition }>('/subscribe/edition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  confirmSubscription: (data: { token: string; email: string }) =>
    request<{ success: boolean; reason?: string }>('/subscribe/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  getFeedbackToken: () => request<{ token: string }>('/feedback/token'),

  /** `success: false` with a message when the human check refuses (`.context/public-website.md`, "Feedback"). */
  submitFeedback: (data: {
    category: string
    message: string
    email?: string
    website?: string
    storyId?: string
    formToken?: string
    turnstileToken?: string
  }) =>
    request<{ success: boolean; message?: string }>('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
}
