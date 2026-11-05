/**
 * Section preview images (.context/seo.md, "Section preview images"), at `/api/section-images`
 * (`SECTION_IMAGE_MOUNT`): `GET /newsletter.png`, `GET /podcast.png` and `GET /issues/:slug.png`,
 * the 1200x630 card images of the newsletter issue, podcast transcript and topic pages. Behind the
 * shared rate limiter, as the story images are.
 */
import { Router } from 'express'
import { failsWith } from '../../middleware/routeErrors.js'
import { getSectionImage, getTopicImage } from '../../services/sectionPreview.js'
import { sendPreviewImage } from './previewImage.js'

export const sectionImageRouter = Router()

sectionImageRouter.get('/issues/:slug.png', failsWith('Failed to render image'), async (req, res) => {
  const png = await getTopicImage(req.params.slug!)
  if (!png) {
    res.status(404).json({ error: 'Topic not found' })
    return
  }
  sendPreviewImage(res, png)
})

sectionImageRouter.get('/:section.png', failsWith('Failed to render image'), async (req, res) => {
  const png = await getSectionImage(req.params.section!)
  if (!png) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  sendPreviewImage(res, png)
})
