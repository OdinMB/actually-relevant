import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { PublicNewsletterIssueSummary } from '@shared/types'
import { publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'

/** One page of published newsletter issues, newest first. */
export function useNewsletterArchive(page: number, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['public-newsletter-archive', page],
    queryFn: () => publicApi.newsletterArchive(page),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

/** One published issue's web edition. */
export function useNewsletterIssue(slug: string) {
  return useQuery({
    queryKey: ['public-newsletter-issue', slug],
    queryFn: () => publicApi.newsletterIssue(slug),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface LatestNewsletterIssue extends PublicNewsletterIssueSummary {
  /** Published less than a week ago: the newsletter is weekly, so an older issue is only the latest */
  thisWeek: boolean
}

/**
 * The newest published newsletter issue, for the ways in to its web edition (the home page card,
 * the line at the end of each story). It is the first entry of the archive's first page, the
 * request the Past issues list on /newsletter makes, so the two share one cache entry. Null while
 * loading, when no issue is published and when the archive fails to load, so the way in quietly
 * stays away; and while the page is prerendered, so no static HTML keeps a dated issue.
 */
export function useLatestNewsletterIssue(): LatestNewsletterIssue | null {
  const { data } = useNewsletterArchive(1, { enabled: !isPrerendering() })
  const latest = data?.data[0]
  if (!latest) return null
  return { ...latest, thisWeek: new Date().getTime() - new Date(latest.publishedAt).getTime() < WEEK_MS }
}
