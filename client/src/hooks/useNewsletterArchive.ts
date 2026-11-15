import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { NewsletterEdition, PublicNewsletterIssueSummary } from '@shared/types'
import { publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'

/**
 * One page of published newsletter issues, newest first: both editions', or only `edition`'s. Never
 * asked for while prerendering, so no static HTML (the /newsletter list, the newest-issue card) keeps
 * a dated issue.
 */
export function useNewsletterArchive(page: number, edition?: NewsletterEdition) {
  return useQuery({
    queryKey: ['public-newsletter-archive', page, edition ?? 'all'],
    queryFn: () => publicApi.newsletterArchive(page, edition),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    enabled: !isPrerendering(),
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
 * `edition`'s newest published newsletter issue, for the home page card: the first entry of that
 * edition's archive page. Null while loading (also while the other edition's answer is still the one
 * at hand, so the card never shows the edition the reader just left), when no issue is published and
 * when the archive fails to load, so the way in quietly stays away; and while the page is
 * prerendered, so no static HTML keeps a dated issue.
 */
export function useLatestNewsletterIssue(edition: NewsletterEdition): LatestNewsletterIssue | null {
  const { data, isPlaceholderData } = useNewsletterArchive(1, edition)
  const latest = isPlaceholderData ? undefined : data?.data[0]
  if (!latest) return null
  return { ...latest, thisWeek: new Date().getTime() - new Date(latest.publishedAt).getTime() < WEEK_MS }
}
