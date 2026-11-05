/**
 * Story link previews (.context/seo.md, "Story link previews").
 *
 * - `storyImageRouter`, at `/api/stories`: `GET /:slug/og.png`, the story's 1200x630 preview image.
 * - `storyPageRouter`, at `/api/story-page`: the HTML for `/stories/<slug>` on the site, which a
 *   Render rewrite sends here. It is the shared link-preview page (`pagePreview.ts`): the client's
 *   index.html with the story's tags in the head; for a missing story or any failure, the shell
 *   unchanged with 200, so the SPA shows its own page. Mounted before the shared rate limiter, as
 *   `/api/page` is.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { getStoryOgImage } from '../../services/storyPreview.js'
import { previewPageHandler } from './pagePreview.js'

export const storyImageRouter = Router()

storyImageRouter.get('/:slug/og.png', failsWith('Failed to render image'), async (req, res) => {
  const png = await getStoryOgImage(req.params.slug!)
  if (!png) {
    res.status(404).json({ error: 'Story not found' })
    return
  }
  res.set('Content-Type', 'image/png')
  res.set('Cache-Control', `public, max-age=${config.storyPreview.imageCacheSeconds}`)
  // Helmet's default (same-origin) would stop browsers showing the image on other sites
  res.set('Cross-Origin-Resource-Policy', 'cross-origin')
  res.send(png)
})

export const storyPageRouter = Router()

// Any path under the mount point gets a page, so no story URL ever gets the API's JSON 404
storyPageRouter.get(
  '*',
  previewPageHandler(req => `/stories${req.path}`),
)
