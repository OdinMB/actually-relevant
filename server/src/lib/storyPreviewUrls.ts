import { config } from '../config.js'

/**
 * Absolute URL of a story's link-preview image (`GET /api/stories/:slug/og.png`), on the API's
 * public origin. Used for the story page's og:image (injected by the story-page route) and as
 * the Bluesky link-card thumbnail (.context/seo.md, "Story link previews").
 */
export function storyOgImageUrl(slug: string): string {
  return `${config.storyPreview.apiUrl}/api/stories/${encodeURIComponent(slug)}/og.png`
}
