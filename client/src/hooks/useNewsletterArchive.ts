import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { publicApi } from '../lib/api'

/** One page of published newsletter issues, newest first. */
export function useNewsletterArchive(page: number) {
  return useQuery({
    queryKey: ['public-newsletter-archive', page],
    queryFn: () => publicApi.newsletterArchive(page),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
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
