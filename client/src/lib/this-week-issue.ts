import type { PublicNewsletterIssueSummary } from '@shared/types'

/**
 * How long the newest issue counts as this week's: the week until the next Saturday issue, plus a
 * day's grace for a late one. An older newest issue is not this week's, so the "This week" link goes.
 */
export const THIS_WEEK_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000

/**
 * Where the site's "This week" link leads: the web edition of the newest published issue (the
 * archive's first, as the API lists issues newest first), while that issue is at most
 * `THIS_WEEK_MAX_AGE_MS` old. Null when no issue is known (none published, archive not loaded)
 * or the newest is older.
 */
export function thisWeekIssuePath(issues: readonly Pick<PublicNewsletterIssueSummary, 'slug' | 'publishedAt'>[] | undefined, now: number): string | null {
  const newest = issues?.[0]
  if (!newest) return null
  const age = now - Date.parse(newest.publishedAt)
  return age <= THIS_WEEK_MAX_AGE_MS ? `/newsletter/${newest.slug}` : null
}
