/**
 * Site pages served with their link-preview tags (.context/seo.md, "Link previews").
 *
 * - `pagePreviewRouter`, at `/api/page`: the HTML for `/<section>/…` on the site (a newsletter
 *   issue, a podcast transcript, a topic page that is not prerendered), which the static site's
 *   rewrites send here (`lib/linkPreviewPaths.ts`).
 * - `previewPageHandler()`, which the story pages' own route (`/api/story-page`) shares.
 *
 * Each answer is the client's index.html with the page's tags in the head; for a path with no such
 * page, a page that is not found or any failure, the shell unchanged with 200, so the SPA shows its
 * own page. Mounted before the shared rate limiter: behind the rewrites, every visitor may arrive
 * from the static site's proxy address, and a shared bucket would answer them 429.
 */
import { Router, type Request, type Response } from 'express'
import { config } from '../../config.js'
import { createLogger } from '../../lib/logger.js'
import { renderPreviewPage } from '../../services/linkPreview.js'
import { previewTargetOf } from '../../services/pagePreviews.js'

const log = createLogger('link-preview')

/** Answers with the page at the site path `sitePathOf(req)` names. */
export function previewPageHandler(sitePathOf: (req: Request) => string) {
  return async (req: Request, res: Response) => {
    const html = await renderPreviewPage(previewTargetOf(sitePathOf(req))).catch(err => {
      log.error({ err, path: req.path }, 'failed to render a link-preview page')
      return null
    })
    // This is the site's page, not an API response: drop the API's security policy, which
    // would block the client's own scripts and API calls on actuallyrelevant.news.
    res.removeHeader('Content-Security-Policy')
    res.removeHeader('Cross-Origin-Resource-Policy')
    if (!html) {
      // The shell has never been fetched (the static site is unreachable): nothing to serve
      res.status(503).set('Retry-After', '10').type('text/plain').send('Temporarily unavailable, please reload.')
      return
    }
    res.set('Cache-Control', `public, max-age=${config.storyPreview.pageCacheSeconds}`)
    res.type('html').send(html)
  }
}

export const pagePreviewRouter = Router()

// Any path under the mount point gets a page, so no site URL ever gets the API's JSON 404
pagePreviewRouter.get(
  '*',
  previewPageHandler(req => req.path),
)
