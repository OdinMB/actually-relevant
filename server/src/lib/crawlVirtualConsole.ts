import { VirtualConsole } from 'jsdom'
import { createLogger } from './logger.js'

const log = createLogger('extractor')

/**
 * The console a crawled page's JSDOM reports to. JSDOM's default prints every internal error
 * straight to stderr, outside the structured log, and the commonest by far is "Could not parse CSS
 * stylesheet": jsdom's CSS parser rejecting modern CSS in a publisher's inline styles. That one is
 * dropped, since extraction never reads styles and the parser keeps the sheet's valid rules anyway.
 * Any other jsdom error goes to the log as a warning naming the page. Pages' own console calls are
 * ignored: crawled pages never run scripts.
 */
export function crawlVirtualConsole(url: string): VirtualConsole {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (err: Error & { type?: string }) => {
    if (err.type === 'css-parsing') return
    log.warn({ url, type: err.type, reason: err.message }, 'jsdom reported an error while parsing a page')
  })
  return virtualConsole
}
