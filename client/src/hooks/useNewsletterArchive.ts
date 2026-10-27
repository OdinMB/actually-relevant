import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'
import { thisWeekIssuePath } from '../lib/this-week-issue'

const STALE_MS = 5 * 60 * 1000

/** One archive page's query, shared so `/newsletter` and the header's "This week" link make one request. */
function archivePageQuery(page: number) {
  return {
    queryKey: ['public-newsletter-archive', page],
    queryFn: () => publicApi.newsletterArchive(page),
    staleTime: STALE_MS,
  }
}

/** One page of published newsletter issues, newest first. */
export function useNewsletterArchive(page: number) {
  return useQuery({ ...archivePageQuery(page), placeholderData: keepPreviousData })
}

/**
 * Where the site's "This week" links lead (`thisWeekIssuePath`): this week's issue's web edition,
 * or null while there is none to offer, so the links stay out (loading, failed, nothing published,
 * newest issue too old). Always null while prerendering, so no static page carries the link: the
 * hook then fetches nothing, and ignores the archive page even when `/newsletter`'s issue list has
 * loaded it into the shared cache before the snapshot.
 */
export function useThisWeekIssuePath(): string | null {
  const prerendering = isPrerendering()
  const { data } = useQuery({
    ...archivePageQuery(1),
    enabled: !prerendering,
    select: archive => thisWeekIssuePath(archive.data, Date.now()),
  })
  return prerendering ? null : (data ?? null)
}

/** One published issue's web edition. */
export function useNewsletterIssue(slug: string) {
  return useQuery({
    queryKey: ['public-newsletter-issue', slug],
    queryFn: () => publicApi.newsletterIssue(slug),
    enabled: !!slug,
    staleTime: STALE_MS,
    retry: false,
  })
}
