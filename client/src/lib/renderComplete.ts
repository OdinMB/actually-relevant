/**
 * Tells the build-time prerenderer (vite.config.ts, `renderAfterDocumentEvent`) when a page is
 * ready to snapshot. Pages are lazy chunks, so the snapshot waits until no route fallback is
 * showing: otherwise a slow chunk ships the loading spinner as the page's static HTML.
 * Data fetched by the page itself is waited for only where the page marks its loading view with
 * `prerenderWaitProps` (lib/loadState.ts), as the topic pages do so that their own head, not the
 * homepage's, is in their static HTML (BACKLOG: prerender content check).
 */

/**
 * True in the prerenderer's browser, which Puppeteer drives, so `navigator.webdriver` is set
 * (also in Playwright and other automated browsers). The build's API may be unreachable, so a
 * state that only means "the API did not answer" must not render then, or it is baked into every
 * page's static HTML. `loadStateOf` (lib/loadState.ts) applies this to the data a page loads.
 */
export function isPrerendering(nav: Pick<Navigator, 'webdriver'> = navigator): boolean {
  return nav.webdriver === true
}

/** Marks a Suspense fallback shown while a page chunk loads. */
export const ROUTE_FALLBACK_ATTR = 'data-route-fallback'

/** Spread onto a route fallback's root element. */
export const routeFallbackProps = { [ROUTE_FALLBACK_ATTR]: '' }

/** Marks a page's loading view while the prerenderer should wait for the page's content (`prerenderWaitProps`). */
export const PRERENDER_WAIT_ATTR = 'data-prerender-wait'

/**
 * Fires `render-complete` once no route fallback and no content wait is showing, or after
 * `maxWaitMs` at the latest. After any wait it fires `initialDelayMs` later: Helmet writes the
 * rendered page's head on a later animation frame, which the first snapshot gets the same delay for.
 * Any wait, not only one that showed the content marker: a page can mark its wait and clear it
 * between two checks.
 */
export function signalRenderComplete(doc: Document = document, { initialDelayMs = 100, pollMs = 50, maxWaitMs = 5000 } = {}): void {
  const deadline = Date.now() + maxWaitMs
  let waited = false
  const fire = () => doc.dispatchEvent(new Event('render-complete'))
  const check = () => {
    if (Date.now() < deadline && doc.querySelector(`[${ROUTE_FALLBACK_ATTR}], [${PRERENDER_WAIT_ATTR}]`)) {
      waited = true
      setTimeout(check, pollMs)
      return
    }
    if (waited) setTimeout(fire, initialDelayMs)
    else fire()
  }
  setTimeout(check, initialDelayMs)
}
