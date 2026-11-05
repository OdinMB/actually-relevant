/**
 * Tells the build-time prerenderer (vite.config.ts, `renderAfterDocumentEvent`) when a page is
 * ready to snapshot. Pages are lazy chunks, so the snapshot waits until no route fallback is
 * showing: otherwise a slow chunk ships the loading spinner as the page's static HTML.
 * Data fetched by the page itself is waited for only where the page marks its loading view with
 * `prerenderWaitProps` (lib/loadState.ts), as the topic pages do so that their own head, not the
 * homepage's, is in their static HTML (BACKLOG: prerender content check).
 */
import { PRERENDER_FLAG } from './prerenderFlag'

declare global {
  interface Window {
    /** Set by the build's prerenderer (lib/prerenderFlag.ts). */
    [PRERENDER_FLAG]?: unknown
  }
}

/**
 * True in the build's prerenderer only: it sets `PRERENDER_FLAG` on the window before the page's
 * scripts run (vite.config.ts). Any other browser, an automated one included, gets the live page.
 * The build's API may be unreachable, so a state that only means "the API did not answer" must not
 * render then, or it is baked into every page's static HTML; nor may dated data, which would go
 * stale there. `loadStateOf` (lib/loadState.ts) applies this to the data a page loads.
 */
export function isPrerendering(win: Pick<Window, typeof PRERENDER_FLAG> = window): boolean {
  return win[PRERENDER_FLAG] === true
}

/** Marks a Suspense fallback shown while a page chunk loads. */
export const ROUTE_FALLBACK_ATTR = 'data-route-fallback'

/** Spread onto a route fallback's root element. */
export const routeFallbackProps = { [ROUTE_FALLBACK_ATTR]: '' }

/** Marks a page's loading view while the prerenderer should wait for the page's content (`prerenderWaitProps`). */
export const PRERENDER_WAIT_ATTR = 'data-prerender-wait'

/** Whether this page load marked a content wait, even one whose marker is gone before a check sees it. */
let contentWaitNoted = false

/** Records that the page marked a content wait (`prerenderWaitProps` calls it). */
export function noteContentWait(): void {
  contentWaitNoted = true
}

/** Tests only: forget a noted content wait. */
export function _resetContentWait(): void {
  contentWaitNoted = false
}

/**
 * Fires `render-complete` once no route fallback and no content wait is showing, or after
 * `maxWaitMs` at the latest. If the page waited for its content it fires `initialDelayMs` later:
 * Helmet writes the loaded page's head on a later animation frame, which the first snapshot gets the
 * same delay for. That holds even when the content marker came and went between two checks (it was
 * noted), and only then: a page that waited for its chunk alone is snapshotted at once, so data it
 * loads unawaited has no extra time to reach its static HTML.
 */
export function signalRenderComplete(doc: Document = document, { initialDelayMs = 100, pollMs = 50, maxWaitMs = 5000 } = {}): void {
  const deadline = Date.now() + maxWaitMs
  const fire = () => doc.dispatchEvent(new Event('render-complete'))
  const check = () => {
    if (doc.querySelector(`[${PRERENDER_WAIT_ATTR}]`)) noteContentWait()
    if (Date.now() < deadline && doc.querySelector(`[${ROUTE_FALLBACK_ATTR}], [${PRERENDER_WAIT_ATTR}]`)) {
      setTimeout(check, pollMs)
      return
    }
    if (contentWaitNoted) setTimeout(fire, initialDelayMs)
    else fire()
  }
  setTimeout(check, initialDelayMs)
}
