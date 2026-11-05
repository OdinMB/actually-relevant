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
import { failsWith } from '../../middleware/routeErrors.js'
import { getStoryOgImage } from '../../services/storyPreview.js'
import { previewPageHandler } from './pagePreview.js'
import { sendPreviewImage } from './previewImage.js'

export const storyImageRouter = Router()

storyImageRouter.get('/:slug/og.png', failsWith('Failed to render image'), async (req, res) => {
  const png = await getStoryOgImage(req.params.slug!)
  if (!png) {
    res.status(404).json({ error: 'Story not found' })
    return
  }
  sendPreviewImage(res, png)
})

export const storyPageRouter = Router()

// Any path under the mount point gets a page, so no story URL ever gets the API's JSON 404
storyPageRouter.get(
  '*',
  previewPageHandler(req => `/stories${req.path}`),
)
