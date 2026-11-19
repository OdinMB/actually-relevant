import { useQuery } from '@tanstack/react-query'
import { isNotFound, publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'

/*
 * Ongoing stories for readers (`.context/overviews.md`, "Public"). While the module is switched off
 * the list says `on: false` and every page is a 404, so the site shows no "Ongoing" link and no page.
 */

/**
 * The public ongoing stories, the most recently changed first, and whether the module is on (the
 * `/ongoing` index). Never asked for while prerendering, and never retried.
 */
export function usePublicOverviews() {
  return useQuery({
    queryKey: ['public-overviews'],
    queryFn: () => publicApi.overviews.list(),
    staleTime: 5 * 60 * 1000,
    enabled: !isPrerendering(),
    retry: false,
  })
}

/**
 * Whether the site shows its "Ongoing" links: only while the module is switched on. The layout asks
 * on every visitor's first page view, so it asks for no overview (`limit` 0), only the switch. Never
 * asked for while prerendering (the static pages carry no link; the client adds it once on), and never
 * retried: a failed request leaves the site without the link, as when the module is off.
 */
export function useOngoingOn(): boolean {
  const { data } = useQuery({
    queryKey: ['public-overviews', 'on'],
    queryFn: () => publicApi.overviews.list(0),
    staleTime: 5 * 60 * 1000,
    enabled: !isPrerendering(),
    retry: false,
  })
  return data?.on === true
}

/** One ongoing story's page; a 404 (switched off, or not public) is never retried. */
export function usePublicOverview(slug: string) {
  return useQuery({
    queryKey: ['public-overview', slug],
    queryFn: () => publicApi.overviews.get(slug),
    enabled: !!slug,
    staleTime: 60 * 1000,
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  })
}
