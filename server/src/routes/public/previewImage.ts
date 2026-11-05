import type { Response } from 'express'
import { config } from '../../config.js'

/** Answers with a link-preview image (a story's og.png, a section image): cacheable, and shown by other sites. */
export function sendPreviewImage(res: Response, png: Buffer): void {
  res.set('Content-Type', 'image/png')
  res.set('Cache-Control', `public, max-age=${config.storyPreview.imageCacheSeconds}`)
  // Helmet's default (same-origin) would stop browsers showing the image on other sites
  res.set('Cross-Origin-Resource-Policy', 'cross-origin')
  res.send(png)
}
