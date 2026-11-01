import { config } from '../config.js'

/**
 * Absolute URL of a feed's favicon (`GET /api/feeds/:id/favicon`), on the API's public origin, for
 * places that cannot use a relative one: the newsletter email (.context/feed-management.md, "Favicons").
 */
export function feedFaviconUrl(feedId: string): string {
  return `${config.apiUrl}/api/feeds/${encodeURIComponent(feedId)}/favicon`
}
