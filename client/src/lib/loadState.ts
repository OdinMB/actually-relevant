import type { UseQueryResult } from '@tanstack/react-query'
import { isNotFound } from './api'
import { isPrerendering, noteContentWait, PRERENDER_WAIT_ATTR } from './renderComplete'

/**
 * What a public page shows for the query that loads its content (.context/ui-conventions.md, "Load failures"):
 *
 * - `ready`: the data is there, also when a later refetch failed;
 * - `loading`: the first answer is on its way (the page's skeleton);
 * - `not-found`: the API answered 404, or there was nothing to ask for (a query disabled for want of its slug);
 * - `failed`: anything else, such as a dropped connection, a busy server, a 5xx or the browser being
 *   offline. The page says it couldn't load right now and offers "Try again" (`LoadFailure`).
 *   It stays `failed` while that retry runs: TanStack Query puts a query without data back to pending
 *   when it fetches again (or fills it with another page's placeholder data), and the skeleton or
 *   that page would take the button, and the reader's focus, away.
 *
 * In the prerenderer it is only ever `ready` or `loading`: the build's API may not answer, and a page
 * must not bake "not found" or "couldn't load" into its static HTML (renderComplete.ts). A page that
 * is never prerendered (one only in App.tsx, not in shared/routes.json) passes `false` for
 * `prerendering`: its not-found view, with its `noindex`, must always show.
 */
export type LoadState = 'ready' | 'loading' | 'not-found' | 'failed'

export function loadStateOf(
  query: Pick<UseQueryResult<unknown>, 'data' | 'error' | 'isLoading' | 'isPaused' | 'isPlaceholderData' | 'errorUpdateCount'>,
  prerendering = isPrerendering(),
): LoadState {
  const retryingAfterFailure = query.errorUpdateCount > 0 && (query.isLoading || query.isPlaceholderData)
  if (query.data != null && !retryingAfterFailure) return 'ready'
  if (prerendering) return 'loading'
  if (query.error) return isNotFound(query.error) ? 'not-found' : 'failed'
  if (retryingAfterFailure) return 'failed'
  if (query.isLoading) return 'loading'
  // Paused: the browser is offline, and the query waits to be back online
  if (query.isPaused) return 'failed'
  return 'not-found'
}

/**
 * Spread onto a prerendered page's loading view, so that the prerenderer waits for the page's
 * content (renderComplete.ts) and snapshots the loaded page, its head included, rather than the
 * skeleton under the homepage's head. Only in the prerenderer, and only while the first request is
 * on its way: if it fails (the build's API may not answer), the snapshot goes ahead without the
 * retry. `signalRenderComplete` stops waiting after its maximum anyway. A marked wait is also noted,
 * so the snapshot gives the head time to settle even if the marker clears between two of its checks.
 */
export function prerenderWaitProps(
  query: Pick<UseQueryResult<unknown>, 'isLoading' | 'failureCount'>,
  prerendering = isPrerendering(),
): Partial<Record<typeof PRERENDER_WAIT_ATTR, ''>> {
  if (!(prerendering && query.isLoading && query.failureCount === 0)) return {}
  noteContentWait()
  return { [PRERENDER_WAIT_ATTR]: '' }
}
