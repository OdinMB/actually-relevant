/**
 * The public caches that may hold an overview link (`.context/overviews.md`, "Caches"): the
 * homepage's stories (their `overview` field), the sitemap, the link previews, the `/ongoing` list and
 * the overview pages (`ongoing-page`). A write that takes a link away empties them once it commits
 * (`forgetOverviewLinks`, from the lifecycle and the job's switch); one that only adds a link waits for
 * their next refresh. Related stories keep only ids and read the field fresh, so their cache, where
 * each entry costs a model call to rebuild, stays.
 */
import { clearPublicCaches } from '../lib/publicCaches.js'

export const OVERVIEW_LINK_CACHES = ['homepage', 'sitemap', 'link-preview-pages', 'ongoing-list', 'ongoing-page'] as const

export function forgetOverviewLinks(): void {
  clearPublicCaches(OVERVIEW_LINK_CACHES)
}
