/**
 * Tells the build-time prerenderer (vite.config.ts, `renderAfterDocumentEvent`) when a page is
 * ready to snapshot. Pages are lazy chunks, so the snapshot waits until no route fallback is
 * showing: otherwise a slow chunk ships the loading spinner as the page's static HTML.
 * Data fetched by the page itself is not waited for (BACKLOG: prerender content check).
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

export function signalRenderComplete(doc: Document = document, { initialDelayMs = 100, pollMs = 50, maxWaitMs = 5000 } = {}): void {
  const deadline = Date.now() + maxWaitMs
  const check = () => {
    if (doc.querySelector(`[${ROUTE_FALLBACK_ATTR}]`) && Date.now() < deadline) {
      setTimeout(check, pollMs)
      return
    }
    doc.dispatchEvent(new Event('render-complete'))
  }
  setTimeout(check, initialDelayMs)
}
