/**
 * Link previews for the site's pages that are not prerendered (.context/seo.md, "Link previews").
 * A crawler that runs no JavaScript would see only index.html's homepage tags there, so the static
 * site's rewrites send these pages to the backend, which answers with the built client's index.html
 * (the "shell", fetched from the static site and cached briefly) carrying the page's own title,
 * description, canonical, og:* and twitter:* tags in its head.
 *
 * This module is what every such page shares: the shell, the tags and the failure rule. What each
 * page's tags say is in `pagePreviews.ts` (and `storyPreview.ts` for stories). Anything that goes
 * wrong leaves the shell unchanged.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { withRetry } from '../lib/retry.js'
import { BoundedCache } from '../lib/boundedCache.js'
import { registerPublicCache } from '../lib/publicCaches.js'
import { escapeHtml } from '../lib/xml.js'

const log = createLogger('link-preview')

export const SITE_NAME = 'Actually Relevant'

export interface PreviewImage {
  url: string
  /** og:image:type, where it is known. */
  type?: string
  width: number
  height: number
}

/** The site's 1200x630 card image, the one the client's `CommonOgTags` sets when a page has none of its own. */
export const SITE_OG_IMAGE: PreviewImage = { url: `${config.siteUrl}/images/og-image.png`, width: 1200, height: 630 }

/** What a page's head says about it: the values its Helmet sets. */
export interface LinkPreview {
  /** The document's `<title>`. */
  documentTitle: string
  /** og:title and twitter:title. */
  title: string
  /** Plain text. Cut to 160 characters for `description`, to 200 for og:description and twitter:description. */
  description: string
  /** The page's address on the site: og:url, and the canonical link where the page sets one. */
  url: string
  canonical: boolean
  type: 'article' | 'website'
  image: PreviewImage
  /** article:author. Only story pages carry one. */
  author?: string
  /** article:published_time, ISO 8601. */
  publishedTime?: string
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
// Clearing only marks the shell stale: the next request revalidates it and keeps the last good copy if the fetch fails
registerPublicCache('client-shell', {
  get size() {
    return shell ? 1 : 0
  },
  clear() {
    if (shell) shell = { ...shell, fetchedAt: 0 }
  },
})

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

// --- Meta tags ---

/** The head tags a page's Helmet sets, as HTML. Marked data-rh so Helmet takes them over. */
export function buildHeadTags(preview: LinkPreview): string {
  const { image } = preview
  const meta = (attr: 'name' | 'property', key: string, content: string) => `<meta data-rh="true" ${attr}="${key}" content="${escapeHtml(content)}" />`
  const tags = [
    `<title>${escapeHtml(preview.documentTitle)}</title>`,
    meta('name', 'description', preview.description.slice(0, 160)),
    ...(preview.canonical ? [`<link data-rh="true" rel="canonical" href="${escapeHtml(preview.url)}" />`] : []),
    meta('property', 'og:type', preview.type),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:title', preview.title),
    meta('property', 'og:description', preview.description.slice(0, 200)),
    meta('property', 'og:url', preview.url),
    meta('property', 'og:image', image.url),
    ...(image.type ? [meta('property', 'og:image:type', image.type)] : []),
    meta('property', 'og:image:width', String(image.width)),
    meta('property', 'og:image:height', String(image.height)),
    ...(preview.author ? [meta('property', 'article:author', preview.author)] : []),
    ...(preview.publishedTime ? [meta('property', 'article:published_time', preview.publishedTime)] : []),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', preview.title),
    meta('name', 'twitter:description', preview.description.slice(0, 200)),
    meta('name', 'twitter:image', image.url),
  ]
  return tags.join('\n    ')
}

/**
 * Replace the shell's head tags that a page sets (the title and every Helmet-owned tag,
 * `data-rh="true"`: description, og:*, twitter:*, canonical, JSON-LD) with the page's.
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

// --- Pages ---

const pageCache = new BoundedCache<string>(config.storyPreview.pageCacheEntries, config.storyPreview.pageCacheSeconds * 1000)
registerPublicCache('link-preview-pages', pageCache)

/** A page that gets its own preview: its cache key (its path on the site) and how to read what its head says. */
export interface PreviewTarget {
  key: string
  /** Null when there is no such page (not published, or never was). */
  find: () => Promise<LinkPreview | null>
}

/**
 * The shell with the page's tags; the unchanged shell when the path is no page with a preview,
 * the page is not found (the SPA then shows its own not-found view, which is noindex) or anything
 * fails. Null only when no shell could ever be fetched.
 */
export async function renderPreviewPage(target: PreviewTarget | null): Promise<string | null> {
  const html = await getShell()
  if (!html || !target) return html
  const cacheKey = `${target.key}\n${shell?.etag ?? shell?.fetchedAt ?? ''}`
  const hit = pageCache.get(cacheKey)
  if (hit) return hit
  try {
    const preview = await target.find()
    const page = preview ? injectHeadTags(html, buildHeadTags(preview)) : html
    pageCache.set(cacheKey, page)
    return page
  } catch (err) {
    log.error({ err, page: target.key }, 'failed to build link-preview tags, serving the plain shell')
    return html
  }
}

/** Tests only: forget the cached shell and pages. */
export function _resetLinkPreviewCaches(): void {
  shell = null
  inflight = null
  pageCache.clear()
}
