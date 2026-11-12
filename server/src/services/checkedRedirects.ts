/**
 * A page fetch's redirects, followed one hop at a time so that each target is checked before it is
 * requested (.context/content-extraction.md, "Publisher opt-out check"): by the SSRF guard's URL
 * check (the request's own `lookup` checks the address) and by the publisher opt-out for the target
 * URL. A redirector (FeedBurner, a URL shortener) answers its own robots.txt; the page it leads to is
 * governed by its publisher's.
 */
import type { AxiosResponse } from 'axios'
import { BlockedUrlError, isAllowedUrl } from '../utils/urlValidation.js'
import { checkOptOut, type Reservation } from './publisherOptOut.js'

/** Redirects followed before the fetch fails, as many as follow-redirects followed for it before. */
export const MAX_REDIRECTS = 5

/** A redirect target the publisher reserved, which was not requested. */
export interface ReservedHop extends Reservation {
  url: string
}

/** Where a 3xx answer points, resolved against the URL that gave it; null for any other answer. */
function redirectTarget(response: AxiosResponse<unknown>, from: string): string | null {
  const { status } = response
  if (!(status >= 300 && status < 400)) return null
  const location: unknown = response.headers?.location
  if (typeof location !== 'string' || location === '') throw new Error(`HTTP ${status} without a Location header`)
  return new URL(location, from).href
}

/**
 * GET `url` with `getOnce`, which must not follow redirects itself, then each redirect target in
 * turn, at most MAX_REDIRECTS of them. Each target is checked before it is requested, on the same
 * host too (its path may be disallowed; the host files are cached, so robots.txt is not read again):
 * one the publisher reserved is returned as a `ReservedHop`; one the SSRF guard refuses, a 3xx
 * without a usable Location, or one redirect too many throws. The first URL is the caller's to check.
 */
export async function getFollowingCheckedRedirects<T>(
  url: string,
  getOnce: (url: string) => Promise<AxiosResponse<T>>,
): Promise<{ response: AxiosResponse<T> } | { reservedHop: ReservedHop }> {
  let current = url
  for (let redirects = 0; ; redirects++) {
    const response = await getOnce(current)
    const next = redirectTarget(response, current)
    if (next === null) return { response }
    if (redirects === MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`)
    if (!isAllowedUrl(next)) throw new BlockedUrlError(`Blocked redirect to disallowed URL: ${next}`)
    const verdict = await checkOptOut(next, { fetchesPage: true })
    if (verdict.reserved) return { reservedHop: { url: next, reason: verdict.reason, unverified: verdict.unverified } }
    current = next
  }
}
