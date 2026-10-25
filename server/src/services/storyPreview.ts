/**
 * Story link previews (.context/seo.md, "Story link previews"):
 * - the per-story og:image, rendered with the carousel's canvas renderer at 1200x630;
 * - the story page HTML: the built client's index.html (the "shell", fetched from the static
 *   site and cached briefly) with the story's title, description, canonical, og:* and
 *   twitter:* tags injected, for crawlers that do not run JavaScript.
 * Both serve published stories only. Anything that goes wrong leaves the shell unchanged.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { withRetry } from '../lib/retry.js'
import { BoundedCache } from '../lib/boundedCache.js'
import { storyOgImageUrl } from '../lib/storyPreviewUrls.js'
import { createStoryImage, OG_IMAGE_SIZE } from './carousel.js'

const log = createLogger('story-preview')

const SITE_NAME = 'Actually Relevant'
/** The same author line StoryPage's Helmet sets. */
const STORY_AUTHOR = 'RelevanceAI by Actually Relevant'

const PREVIEW_STORY_SELECT = {
  slug: true,
  title: true,
  titleLabel: true,
  sourceTitle: true,
  summary: true,
  datePublished: true,
  sourceDatePublished: true,
  issue: { select: { name: true } },
  feed: { select: { title: true, displayTitle: true, issue: { select: { name: true } } } },
} as const

export async function findPreviewStory(slug: string) {
  return prisma.story.findFirst({ where: { slug, status: 'published' }, select: PREVIEW_STORY_SELECT })
}

export type PreviewStory = NonNullable<Awaited<ReturnType<typeof findPreviewStory>>>

// --- Titles (mirrors client/src/lib/title-label.ts) ---

function titleLabelOf(story: PreviewStory): string | null {
  if (story.titleLabel) return story.titleLabel
  if (!story.title) return null
  const colonIdx = story.title.indexOf(':')
  return colonIdx > 0 && colonIdx <= 40 ? story.title.slice(0, colonIdx).trim() : null
}

function headlineOf(story: PreviewStory): string {
  const title = story.title || story.sourceTitle
  if (story.titleLabel || !story.title) return title
  const colonIdx = story.title.indexOf(':')
  if (colonIdx > 0 && colonIdx <= 40) {
    const afterColon = story.title.slice(colonIdx + 1).trim()
    if (afterColon) return afterColon
  }
  return title
}

/** "Label: Headline", as the story page's title and og:title show it. */
export function displayTitleOf(story: PreviewStory): string {
  const label = titleLabelOf(story)
  const headline = headlineOf(story)
  return label ? `${label}: ${headline}` : headline
}

// --- og:image ---

const imageCache = new BoundedCache<Buffer>(config.storyPreview.imageCacheEntries, config.storyPreview.imageCacheTtlSeconds * 1000)

/** The story's 1200x630 preview PNG (AI-marked in pixels and XMP), or null if it is not published. */
export async function getStoryOgImage(slug: string): Promise<Buffer | null> {
  const hit = imageCache.get(slug)
  if (hit) return hit
  const story = await findPreviewStory(slug)
  if (!story) return null
  const png = createStoryImage(
    {
      title: headlineOf(story),
      category: story.issue?.name || story.feed?.issue?.name || 'General',
      summary: story.summary || '',
      publisher: story.feed?.displayTitle || story.feed?.title || '',
      date: (story.sourceDatePublished ?? story.datePublished)?.toISOString() ?? null,
    },
    OG_IMAGE_SIZE,
  )
  imageCache.set(slug, png)
  return png
}

// --- The shell ---

interface Shell {
  html: string
  etag: string | null
  lastModified: string | null
  fetchedAt: number
}

let shell: Shell | null = null
let inflight: Promise<string | null> | null = null

class ShellFetchError extends Error {
  constructor(public response: { status: number }) {
    super(`shell fetch failed with HTTP ${response.status}`)
  }
}

async function fetchShell(previous: Shell | null): Promise<Shell> {
  const headers: Record<string, string> = { Accept: 'text/html' }
  if (previous?.etag) headers['If-None-Match'] = previous.etag
  if (previous?.lastModified) headers['If-Modified-Since'] = previous.lastModified
  const res = await withRetry(
    async () => {
      const response = await fetch(config.storyPreview.shellUrl, {
        headers,
        signal: AbortSignal.timeout(config.storyPreview.shellFetchTimeoutMs),
      })
      if (response.status >= 500) throw new ShellFetchError(response)
      return response
    },
    { retries: 1, baseDelayMs: 200 },
  )
  if (res.status === 304 && previous) return { ...previous, fetchedAt: Date.now() }
  if (!res.ok) throw new ShellFetchError(res)
  const html = await res.text()
  if (!/<\/head>/i.test(html) || !/<div id="root"/.test(html)) throw new Error('shell is not the client index.html')
  return { html, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), fetchedAt: Date.now() }
}

/**
 * The client's built index.html, fetched from the static site and reused for
 * `shellCacheSeconds`, then revalidated. If a fetch fails, the last good copy is served;
 * null only when the shell has never been fetched.
 */
export async function getShell(): Promise<string | null> {
  const fresh = shell && Date.now() - shell.fetchedAt < config.storyPreview.shellCacheSeconds * 1000
  if (shell && fresh) return shell.html
  if (!inflight) {
    inflight = fetchShell(shell)
      .then(next => {
        shell = next
        return next.html
      })
      .catch(err => {
        log.warn({ err, url: config.storyPreview.shellUrl, haveStale: Boolean(shell) }, 'failed to fetch the client shell')
        if (shell) shell = { ...shell, fetchedAt: Date.now() } // retry after another TTL, not on every request
        return shell?.html ?? null
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Test hook: forget the cached shell and pages. */
export function resetStoryPreviewCaches(): void {
  shell = null
  inflight = null
  pageCache.clear()
  imageCache.clear()
}

// --- Meta tags ---

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** The head tags the story page's Helmet sets, as HTML. Marked data-rh so Helmet takes them over. */
export function buildStoryHeadTags(story: PreviewStory): string {
  const displayTitle = displayTitleOf(story)
  const description = story.summary || displayTitle
  const url = `${config.siteUrl}/stories/${story.slug}`
  const image = storyOgImageUrl(story.slug!)
  const meta = (attr: 'name' | 'property', key: string, content: string) => `<meta data-rh="true" ${attr}="${key}" content="${escapeHtml(content)}" />`
  const tags = [
    `<title>${escapeHtml(`${displayTitle} - ${SITE_NAME}`)}</title>`,
    meta('name', 'description', description.slice(0, 160)),
    `<link data-rh="true" rel="canonical" href="${escapeHtml(url)}" />`,
    meta('property', 'og:type', 'article'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', displayTitle),
    meta('property', 'og:description', description.slice(0, 200)),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', String(OG_IMAGE_SIZE.width)),
    meta('property', 'og:image:height', String(OG_IMAGE_SIZE.height)),
    meta('property', 'article:author', STORY_AUTHOR),
    ...(story.datePublished ? [meta('property', 'article:published_time', story.datePublished.toISOString())] : []),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', displayTitle),
    meta('name', 'twitter:description', description.slice(0, 200)),
    meta('name', 'twitter:image', image),
  ]
  return tags.join('\n    ')
}

/**
 * Replace the shell's head tags that a page sets (the title and every Helmet-owned tag,
 * `data-rh="true"`: description, og:*, twitter:*, canonical, JSON-LD) with the story's.
 * Returns the shell unchanged if its head cannot be found.
 */
export function injectHeadTags(html: string, tags: string): string {
  const headEnd = html.search(/<\/head>/i)
  if (headEnd < 0) return html
  const head = html
    .slice(0, headEnd)
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/gi, '')
    .replace(/<(meta|link)\b[^>]*\bdata-rh="true"[^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*\bdata-rh="true"[^>]*>[\s\S]*?<\/script>\s*/gi, '')
  return `${head}  ${tags}\n  ${html.slice(headEnd)}`
}

const pageCache = new BoundedCache<string>(config.storyPreview.pageCacheEntries, config.storyPreview.pageCacheSeconds * 1000)

/**
 * The HTML for `/stories/<slug>`: the shell with the story's tags, or the unchanged shell when
 * the story is not published (the SPA shows its own not-found page) or anything fails.
 * Null only when no shell could ever be fetched.
 */
export async function renderStoryPage(slug: string | null): Promise<string | null> {
  const html = await getShell()
  if (!html || !slug) return html
  const cacheKey = `${slug}\n${shell?.etag ?? shell?.fetchedAt ?? ''}`
  const hit = pageCache.get(cacheKey)
  if (hit) return hit
  try {
    const story = await findPreviewStory(slug)
    const page = story ? injectHeadTags(html, buildStoryHeadTags(story)) : html
    pageCache.set(cacheKey, page)
    return page
  } catch (err) {
    log.error({ err, slug }, 'failed to build story page tags, serving the plain shell')
    return html
  }
}
