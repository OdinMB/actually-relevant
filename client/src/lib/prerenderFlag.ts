/**
 * The window property the build's prerenderer sets to `true` before the page's scripts run
 * (vite.config.ts, the Puppeteer renderer's `inject`/`injectProperty`), and `isPrerendering()`
 * (lib/renderComplete.ts) reads. Only the build sets it: any other browser, automated or not, gets
 * the live page. Kept free of browser code, so the build config can import it.
 */
export const PRERENDER_FLAG = '__PRERENDER_INJECTED'
