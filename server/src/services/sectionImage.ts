/**
 * The link-preview image of a section of the site (.context/seo.md, "Section preview images"): the
 * logo on white above a band in the brand's deep purple that names the section ("Newsletter",
 * "Podcast", a topic's name), the four topic colors between them (`previewImageParts.ts`, shared
 * with the story card). 1200x630, drawn with the canvas the carousel and the story images use.
 *
 * The font is Roboto Bold (Apache 2.0, its licence beside it in server/assets/fonts/Roboto), the
 * copy the website ships in client/public/fonts/Roboto. The image holds no AI-generated text, so it
 * carries no AI mark; a label may add the website's "AI" badge after the name, for a card whose
 * text or subject is AI-written.
 */
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { BAND_COLOR, OG_IMAGE_SIZE, STRIP_HEIGHT, drawTopicStrip, loadPreviewLogo } from './previewImageParts.js'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets')
export const SECTION_FONT_PATH = join(ASSETS_DIR, 'fonts', 'Roboto', 'Roboto-Bold.ttf')

/** A family name of our own, so the font never stands in for another one. */
const FONT_FAMILY = 'SectionRobotoBold'

const { width: WIDTH, height: HEIGHT } = OG_IMAGE_SIZE
const BAND_TOP = 360
/** The logo's width, or its own width if that is smaller: scaled up, it would blur. */
const LOGO_MAX_WIDTH = 560
const LABEL_MAX_WIDTH = 1080
const LABEL_COLOR = '#ffffff'
/** One line while the name fits at one of these sizes, else two lines at one of the next. */
const ONE_LINE_SIZES = [100, 96, 92, 88, 84, 80, 76, 72]
const TWO_LINE_SIZES = [80, 76, 72, 68, 64, 60, 56, 52]
const LINE_HEIGHT = 1.15

/** The dot before a topic's name, and the space after it, as fractions of the name's size. */
const DOT_RADIUS = 0.17
const DOT_GAP = 0.28
/**
 * The badge after the name, as the website's AiBadge draws it (10px bold text with a 1px border,
 * 4px side and 1px top padding, 4px corners): sizes in its own text's em, its text half the name's
 * size, so the badge stands about as tall as the name's capitals.
 */
const BADGE = { textSize: 0.5, gap: 0.28, padX: 0.4, padY: 0.1, border: 0.1, radius: 0.4 }

export interface SectionLabel {
  /** The section's name, as the band shows it. */
  text: string
  /** A dot in this color before the name (a topic's color). */
  accent?: string
  /** A badge with this text after the name (`PREVIEW_IMAGE_AI_BADGE`). */
  badge?: string
}

/** Room a label needs besides its text, at a given size: before its first line, after its last. */
export interface LabelExtras {
  lead: (size: number) => number
  trail: (size: number) => number
}

let fontRegistered = false

function registerFont(): void {
  if (!fontRegistered) {
    fontRegistered = GlobalFonts.registerFromPath(SECTION_FONT_PATH, FONT_FAMILY)
  }
}

const fontOf = (size: number) => `${size}px ${FONT_FAMILY}, sans-serif`

/** The name's lines and size: the largest single line that fits, else two lines, cut short only as a last resort. */
export function fitLabel(measure: (text: string, size: number) => number, text: string, maxWidth: number, extras: LabelExtras) {
  const widest = (lines: string[], size: number) =>
    Math.max(...lines.map((line, i) => measure(line, size) + (i === 0 ? extras.lead(size) : 0) + (i === lines.length - 1 ? extras.trail(size) : 0)))
  for (const size of ONE_LINE_SIZES) {
    if (widest([text], size) <= maxWidth) return { size, lines: [text] }
  }
  const words = text.split(/\s+/).filter(Boolean)
  for (const size of TWO_LINE_SIZES) {
    let best: { lines: string[]; width: number } | null = null
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      const width = widest(lines, size)
      if (width <= maxWidth && (!best || width < best.width)) best = { lines, width }
    }
    if (best) return { size, lines: best.lines }
  }
  // Still too long (or one long word): the smallest size on one line, cut with an ellipsis if it must be
  const size = TWO_LINE_SIZES[TWO_LINE_SIZES.length - 1]!
  if (widest([text], size) <= maxWidth) return { size, lines: [text] }
  let cut = text
  while (cut.length > 1 && widest([`${cut}…`], size) > maxWidth) cut = cut.slice(0, -1)
  return { size, lines: [`${cut.trimEnd()}…`] }
}

/** The badge's outline and text, its left edge at `x`, centered on `midline`. */
function drawBadge(ctx: SKRSContext2D, text: string, size: number, x: number, midline: number) {
  const textSize = size * BADGE.textSize
  const border = textSize * BADGE.border
  ctx.font = fontOf(textSize)
  const textWidth = ctx.measureText(text).width
  const capHeight = ctx.measureText('H').actualBoundingBoxAscent
  const width = textWidth + 2 * textSize * (BADGE.padX + BADGE.border)
  const height = textSize * (1 + 2 * (BADGE.padY + BADGE.border))
  ctx.strokeStyle = LABEL_COLOR
  ctx.lineWidth = border
  ctx.beginPath()
  ctx.roundRect(x + border / 2, midline - height / 2 + border / 2, width - border, height - border, textSize * BADGE.radius)
  ctx.stroke()
  ctx.fillStyle = LABEL_COLOR
  ctx.fillText(text, x + (width - textWidth) / 2, midline + capHeight / 2)
}

function drawLabel(ctx: SKRSContext2D, { text, accent, badge }: SectionLabel, centerY: number) {
  const measure = (line: string, size: number) => {
    ctx.font = fontOf(size)
    return ctx.measureText(line).width
  }
  const badgeWidth = (size: number) => (badge ? measure(badge, size * BADGE.textSize) + 2 * size * BADGE.textSize * (BADGE.padX + BADGE.border) : 0)
  const extras: LabelExtras = {
    lead: size => (accent ? size * (2 * DOT_RADIUS + DOT_GAP) : 0),
    trail: size => (badge ? size * BADGE.gap + badgeWidth(size) : 0),
  }
  const { size, lines } = fitLabel(measure, text, LABEL_MAX_WIDTH, extras)
  ctx.font = fontOf(size)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const capHeight = ctx.measureText('H').actualBoundingBoxAscent
  const lineHeight = size * LINE_HEIGHT
  lines.forEach((line, i) => {
    const lead = i === 0 ? extras.lead(size) : 0
    const trail = i === lines.length - 1 ? extras.trail(size) : 0
    const lineWidth = measure(line, size)
    const x = (WIDTH - (lead + lineWidth + trail)) / 2
    const baseline = centerY + (i - (lines.length - 1) / 2) * lineHeight + capHeight / 2
    const midline = baseline - capHeight / 2
    if (lead > 0) {
      ctx.fillStyle = accent!
      ctx.beginPath()
      ctx.arc(x + size * DOT_RADIUS, midline, size * DOT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.font = fontOf(size)
    ctx.fillStyle = LABEL_COLOR
    ctx.fillText(line, x + lead, baseline)
    if (trail > 0) drawBadge(ctx, badge!, size, x + lead + lineWidth + size * BADGE.gap, midline)
  })
}

/** The section's 1200x630 preview PNG. */
export async function createSectionImage(label: SectionLabel): Promise<Buffer> {
  registerFont()
  const logoImage = await loadPreviewLogo()
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, WIDTH, BAND_TOP)
  const logoWidth = Math.min(LOGO_MAX_WIDTH, logoImage.width)
  const logoHeight = (logoWidth * logoImage.height) / logoImage.width
  ctx.drawImage(logoImage, (WIDTH - logoWidth) / 2, (BAND_TOP - STRIP_HEIGHT - logoHeight) / 2, logoWidth, logoHeight)

  drawTopicStrip(ctx, BAND_TOP - STRIP_HEIGHT)
  ctx.fillStyle = BAND_COLOR
  ctx.fillRect(0, BAND_TOP, WIDTH, HEIGHT - BAND_TOP)
  drawLabel(ctx, label, BAND_TOP + (HEIGHT - BAND_TOP) / 2)

  return canvas.toBuffer('image/png')
}
