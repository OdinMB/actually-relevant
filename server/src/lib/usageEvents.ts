import type { AnalyticsEvent } from './simpleAnalytics.js'

/**
 * Which requests usage counting reports to Simple Analytics, and what it says about them
 * (.context/public-website.md, "Usage counting"). Only what this module puts in an event leaves
 * the server: a route pattern, a calling site's hostname, an HTTP status and the widget's issue
 * filter; never an address, a user agent, a query value or an id from the path.
 */

/** What usage counting reads off a request and its response. */
export interface UsageRequest {
  method: string
  /** The path without its query string, as the app first saw it. */
  path: string
  origin: string | undefined
  referer: string | undefined
  /** The request carries the widget's marker, `ref=widget` (client/public/widget.js). */
  fromWidget: boolean
  /** The `issueSlug` query value: the widget's issue filter. */
  issueSlug: string | undefined
  /** The browser sent `DNT: 1` or `Sec-GPC: 1`. */
  doNotTrack: boolean
  status: number
}

/**
 * The public API routes that are counted, as their routers define them: the JSON API and the
 * OpenAPI spec. Left out: the RSS feeds (readers poll them on a timer), the link-preview pages,
 * images and favicons the site's own pages and crawlers load, the signup and feedback forms, the
 * sitemap, `/health`, auth and admin. A new public route is not counted until it is listed here.
 */
const COUNTED_ROUTES = [
  '/api/stories',
  '/api/stories/:slug',
  '/api/stories/:slug/related',
  '/api/stories/:slug/cluster',
  '/api/stories/:slug/appearances',
  '/api/homepage',
  '/api/issues',
  '/api/issues/:slug',
  '/api/sources',
  '/api/newsletters',
  '/api/newsletters/:slug',
  '/api/podcast',
  '/api/podcast/episodes/:id',
  '/api/docs/openapi.json',
] as const

const WIDGET_ROUTE = '/api/stories'

/** The segments of each route; a `:name` segment stands for one id or slug. */
const ROUTE_SEGMENTS = COUNTED_ROUTES.map(route => ({ route, segments: route.split('/') }))

/** An id or slug: one non-empty segment without a dot, so a file route such as `feed.xml` never passes for one. */
const ID_SEGMENT = /^[^.]+$/

/** The counted route a path belongs to, or null. Matching ignores letter case and a trailing slash, as Express does. */
export function countedRoute(path: string): string | null {
  const segments = path
    .toLowerCase()
    .replace(/(.)\/$/, '$1')
    .split('/')
  const match = ROUTE_SEGMENTS.find(
    candidate =>
      candidate.segments.length === segments.length &&
      candidate.segments.every((part, i) => (part.startsWith(':') ? ID_SEGMENT.test(segments[i] ?? '') : part === segments[i])),
  )
  return match?.route ?? null
}

/** The hostnames of our own site, from its configured addresses, without `www.`; their subdomains count as ours too. */
export function ownSiteHosts(urls: readonly string[]): string[] {
  const hosts = urls.map(webHostname).filter((host): host is string => host !== undefined)
  return [...new Set(hosts.map(host => host.replace(/^www\./, '')))]
}

/** The hostname of an http(s) address; undefined for an empty, opaque (`null`) or other-scheme one. */
function webHostname(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : undefined
  } catch {
    return undefined
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Ours: the site, its subdomains (the API among them) and loopback (the build's prerender, local development). */
function isOwnHost(host: string, ownHosts: readonly string[]): boolean {
  return LOOPBACK_HOSTS.has(host) || ownHosts.some(own => host === own || host.endsWith(`.${own}`))
}

/** A site addressed by an IP address is reported as `ip-address`: the address could identify a person. */
function reportableHost(host: string): string {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') ? 'ip-address' : host
}

/** An issue slug's shape and length; anything else the embedding site configured is left out. */
const ISSUE_SLUG = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The event to send for a finished request, or null when it is not counted: anything but a GET of
 * a counted route, a browser asking not to be tracked, and every call from our own site. A widget
 * request is a `widget_view` and nothing else; any other is an `api_request`.
 */
export function usageEvent(request: UsageRequest, ownHosts: readonly string[]): AnalyticsEvent | null {
  if (request.method !== 'GET' || request.doNotTrack) return null
  const route = countedRoute(request.path)
  if (!route) return null

  const host = webHostname(request.origin) ?? webHostname(request.referer)
  if (host && isOwnHost(host, ownHosts)) return null
  const caller = host ? reportableHost(host) : undefined

  if (request.fromWidget && route === WIDGET_ROUTE) {
    const issue = request.issueSlug && ISSUE_SLUG.test(request.issueSlug) ? request.issueSlug : undefined
    return { event: 'widget_view', metadata: { site: caller ?? 'unknown', ...(issue ? { issue } : {}) } }
  }
  return { event: 'api_request', metadata: { route, caller: caller ?? 'direct', status: request.status } }
}
