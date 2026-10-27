/**
 * Runs `body` as in an automated browser, the prerenderer's or any other (Puppeteer, Playwright):
 * `navigator.webdriver` is true, which `isPrerendering()` (lib/renderComplete.ts) reads. jsdom's is not.
 */
export async function inAutomatedBrowser(body: () => Promise<void>): Promise<void> {
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
  try {
    await body()
  } finally {
    delete (navigator as { webdriver?: boolean }).webdriver
  }
}
