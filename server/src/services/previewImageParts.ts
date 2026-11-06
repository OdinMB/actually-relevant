/**
 * What the link-preview images share (.context/seo.md, "Section preview images" and "Story link
 * previews"): their size, the logo, the strip of the four topic colors and the brand's deep purple.
 * The section images (`sectionImage.ts`) and the story card (`storyCardImage.ts`) draw them.
 *
 * The logo is a copy of the website's client/public/images/logo-text-horizontal.png (a JPEG, on
 * white), to be drawn no larger than its own size: scaled up, it would blur.
 */
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { TOPIC_COLORS } from '../lib/topicColors.js'

/** The size link previews use for og:image (1.91:1). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets')
export const PREVIEW_LOGO_PATH = join(ASSETS_DIR, 'images', 'logo-text-horizontal.jpg')

/** brand-800, the site's theme color. */
export const BAND_COLOR = '#661845'
export const STRIP_HEIGHT = 10

let logo: Promise<Image> | null = null

/** The logo, read once; after a failed read, the next call tries again. */
export function loadPreviewLogo(): Promise<Image> {
  logo ??= readFile(PREVIEW_LOGO_PATH)
    .then(bytes => loadImage(bytes))
    .catch(err => {
      logo = null
      throw err
    })
  return logo
}

/** The four topic colors side by side across the image, `STRIP_HEIGHT` tall from `y`. */
export function drawTopicStrip(ctx: SKRSContext2D, y: number): void {
  const colors = Object.values(TOPIC_COLORS)
  const segment = OG_IMAGE_SIZE.width / colors.length
  colors.forEach((color, i) => {
    ctx.fillStyle = color
    ctx.fillRect(Math.round(i * segment), y, Math.ceil(segment), STRIP_HEIGHT)
  })
}
