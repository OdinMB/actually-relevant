/**
 * Story link previews (.context/seo.md, "Story link previews").
 *
 * - `storyImageRouter`, at `/api/stories`: `GET /:slug/og.png`, the story's 1200x630 preview image.
 * - `storyPageRouter`, at `/api/story-page`: the HTML for `/stories/<slug>` on the site, which a
 *   Render rewrite sends here. It is the client's index.html with the story's tags in the head;
 *   for a missing story or any failure, the shell unchanged with 200, so the SPA shows its own
 *   page. Mounted before the shared rate limiter: behind the rewrite, every visitor may arrive
 *   from the static site's proxy address, and a shared bucket would answer them 429.
 */
import { Router, type Request, type Response } from 'express'
import { config } from '../../config.js'
import { createLogger } from '../../lib/logger.js'
import { getStoryOgImage, renderStoryPage } from '../../services/storyPreview.js'

const log = createLogger('story-preview')

export const storyImageRouter = Router()

storyImageRouter.get('/:slug/og.png', async (req, res) => {
  try {
    const png = await getStoryOgImage(req.params.slug)
    if (!png) {
      res.status(404).json({ error: 'Story not found' })
      return
    }
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', `public, max-age=${config.storyPreview.imageCacheSeconds}`)
    // Helmet's default (same-origin) would stop browsers showing the image on other sites
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.send(png)
  } catch (err) {
    log.error({ err, slug: req.params.slug }, 'failed to render story og image')
    res.status(500).json({ error: 'Failed to render image' })
  }
})

export const storyPageRouter = Router()

/** First path segment after the mount point: the slug of `/stories/<slug>` (null for none). */
function slugOf(req: Request): string | null {
  const segment = req.path.split('/').filter(Boolean)[0]
  if (!segment) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

async function sendStoryPage(req: Request, res: Response) {
  const html = await renderStoryPage(slugOf(req)).catch((err) => {
    log.error({ err, path: req.path }, 'failed to render story page')
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

// Any path under the mount point gets a page, so no story URL ever gets the API's JSON 404
storyPageRouter.get('*', sendStoryPage)
