/**
 * A story's link-preview image (.context/seo.md, "Story link previews"): the card image when its page
 * is shared, and the thumbnail of its Bluesky link card. 1200x630, in the section images' style
 * (`previewImageParts.ts`): on white, the logo and the story's topic after a dot in its color; the
 * strip of the four topic colors; then the AI headline in white Roboto Bold on the brand's deep
 * purple, as large as fits, so it reads at the 360px or so a card gives the image. At the band's foot
 * the source and date, and the carousel slides' AI label (`CAROUSEL_COPY.slideFooter`), drawn into
 * the pixels so it travels with the image (AI Act Art. 50(4)); the file carries the same XMP mark as
 * the slides (`lib/xmp.ts`). No summary: a card shows it beside the image as its description.
 */
import { createCanvas, GlobalFonts, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { aiGeneratedXmpPacket, embedXmpInPng } from '../lib/xmp.js'
import { CAROUSEL_COPY } from '../lib/aiLabelCopy.js'
import { STORY_FONT_PATHS } from './carousel.js'
import { BAND_COLOR, OG_IMAGE_SIZE, STRIP_HEIGHT, drawTopicStrip, loadPreviewLogo } from './previewImageParts.js'

export interface StoryCard {
  /** The AI headline, without its title label. */
  headline: string
  /** The story's topic, as the site names it. */
  topic: string
  /** The color of the dot before the topic: its top-level topic's (`topicColor()`). */
  topicColor: string
  /** The source's name, or empty. */
  publisher: string
  /** When the source published the story (ISO), or null. */
  date: string | null
}

/** Family names of our own, so the fonts never stand in for another one. */
const BOLD = 'StoryCardRobotoBold'
const REGULAR = 'StoryCardRobotoRegular'

const { width: WIDTH, height: HEIGHT } = OG_IMAGE_SIZE
const PADDING = 64
/** Where the band starts: above it the white top, the strip at its foot. */
const BAND_TOP = 150
/** The logo's height, or its own if that is smaller: scaled up, it would blur. */
const LOGO_HEIGHT = 108
/** The white margin on each side of the logo file, as a share of its width: the mark lines up with the text. */
const LOGO_SIDE_MARGIN = 0.075

const TOPIC_SIZES = [34, 32, 30, 28, 26, 24, 22]
const TOPIC_COLOR = '#374151'
/** The dot before the topic, and the space after it, as fractions of the topic's size. */
const DOT_RADIUS = 0.24
const DOT_GAP = 0.35

/** The headline's sizes, largest first: the first at which it fits is drawn. */
export const HEADLINE_SIZES = [88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48]
const HEADLINE_MAX_LINES = 5
const LINE_HEIGHT = 1.14
/** The box the headline is centered in, inside the band and above its foot. */
const HEADLINE_TOP = BAND_TOP + 44
const HEADLINE_BOTTOM = HEIGHT - 104

/** The source and the AI label: brand-200 on brand-800 (8.5:1). */
const FOOT_SIZE = 28
const FOOT_BASELINE = HEIGHT - 48
const FOOT_COLOR = '#fbcfe8'

export type Measure = (text: string, size: number) => number

/** The words on lines no wider than `width`, as many on each as fit. One word wider than that gets a line of its own. */
function wrapWords(measure: Measure, words: string[], size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const longer = line ? `${line} ${word}` : word
    if (line && measure(longer, size) > width) {
      lines.push(line)
      line = word
    } else {
      line = longer
    }
  }
  if (line) lines.push(line)
  return lines
}

/** The line, cut at a word (or, for one long word, a letter) and ended with an ellipsis, so it fits `maxWidth`. */
function withEllipsis(measure: Measure, line: string, size: number, maxWidth: number): string {
  let words = line.split(' ')
  while (words.length > 1 && measure(`${words.join(' ')}…`, size) > maxWidth) words = words.slice(0, -1)
  let cut = words.join(' ')
  while (cut.length > 1 && measure(`${cut}…`, size) > maxWidth) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/**
 * The headline's size and lines: the largest of `HEADLINE_SIZES` at which it fits `maxWidth` and
 * `maxHeight` in at most five lines, the lines then made as even as that many allow, so the last
 * is not left with a word or two. At the smallest size, cut with an ellipsis only as a last resort.
 */
export function fitHeadline(measure: Measure, text: string, maxWidth: number, maxHeight: number): { size: number; lines: string[] } {
  const words = text.split(/\s+/).filter(Boolean)
  const maxLines = (size: number) => Math.max(1, Math.min(HEADLINE_MAX_LINES, Math.floor(maxHeight / (size * LINE_HEIGHT))))
  const fitsWidth = (lines: string[], size: number, width: number) => lines.every(line => measure(line, size) <= width)

  for (const size of HEADLINE_SIZES) {
    const lines = wrapWords(measure, words, size, maxWidth)
    if (lines.length > maxLines(size) || !fitsWidth(lines, size, maxWidth)) continue
    // The narrowest width that still takes the same number of lines evens them out
    let tooNarrow = 0
    let wide = maxWidth
    while (wide - tooNarrow > 1) {
      const width = Math.floor((tooNarrow + wide) / 2)
      const narrower = wrapWords(measure, words, size, width)
      if (narrower.length <= lines.length && fitsWidth(narrower, size, width)) wide = width
      else tooNarrow = width
    }
    return { size, lines: wrapWords(measure, words, size, wide) }
  }

  const size = HEADLINE_SIZES[HEADLINE_SIZES.length - 1]!
  const lines = wrapWords(measure, words, size, maxWidth)
  const kept = lines.slice(0, maxLines(size))
  const cut = lines.length > kept.length
  return {
    size,
    lines: kept.map((line, i) => ((cut && i === kept.length - 1) || measure(line, size) > maxWidth ? withEllipsis(measure, line, size, maxWidth) : line)),
  }
}

/** "Nation, Oct 11": the source and the day it published the story, leaving out whichever is missing. */
export function sourceLine(publisher: string, date: string | null): string {
  const day = date ? new Date(date) : null
  const when = day && !Number.isNaN(day.getTime()) ? day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
  return [publisher.trim(), when].filter(Boolean).join(', ')
}

let fontsRegistered = false

function registerFonts(): void {
  if (!fontsRegistered) {
    fontsRegistered = GlobalFonts.registerFromPath(STORY_FONT_PATHS.bold, BOLD) && GlobalFonts.registerFromPath(STORY_FONT_PATHS.regular, REGULAR)
  }
}

const fontOf = (family: string, size: number) => `${size}px ${family}, sans-serif`

/** The logo at the left of the white top, centered on `midline`. Returns the right edge of its mark. */
function drawLogo(ctx: SKRSContext2D, logo: Image, midline: number): number {
  const height = Math.min(LOGO_HEIGHT, logo.height)
  const width = (height * logo.width) / logo.height
  const x = PADDING - width * LOGO_SIDE_MARGIN
  ctx.drawImage(logo, x, midline - height / 2, width, height)
  return x + width * (1 - LOGO_SIDE_MARGIN)
}

/** The topic after a dot in its color, right-aligned in the white top, no further left than `minX`. */
function drawTopic(ctx: SKRSContext2D, card: StoryCard, measure: Measure, minX: number, midline: number) {
  const right = WIDTH - PADDING
  const lead = (size: number) => size * (2 * DOT_RADIUS + DOT_GAP)
  const size = TOPIC_SIZES.find(s => lead(s) + measure(card.topic, s) <= right - minX) ?? TOPIC_SIZES[TOPIC_SIZES.length - 1]!
  const text = lead(size) + measure(card.topic, size) <= right - minX ? card.topic : withEllipsis(measure, card.topic, size, right - minX - lead(size))
  const x = right - lead(size) - measure(text, size)

  ctx.fillStyle = card.topicColor
  ctx.beginPath()
  ctx.arc(x + size * DOT_RADIUS, midline, size * DOT_RADIUS, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = fontOf(BOLD, size)
  const capHeight = ctx.measureText('H').actualBoundingBoxAscent
  ctx.fillStyle = TOPIC_COLOR
  ctx.textAlign = 'left'
  ctx.fillText(text, x + lead(size), midline + capHeight / 2)
}

/** The headline in white, left-aligned and centered in its box. */
function drawHeadline(ctx: SKRSContext2D, headline: string, measure: Measure) {
  const { size, lines } = fitHeadline(measure, headline, WIDTH - 2 * PADDING, HEADLINE_BOTTOM - HEADLINE_TOP)
  ctx.font = fontOf(BOLD, size)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  const capHeight = ctx.measureText('H').actualBoundingBoxAscent
  const lineHeight = size * LINE_HEIGHT
  const blockHeight = (lines.length - 1) * lineHeight + capHeight
  const firstBaseline = HEADLINE_TOP + (HEADLINE_BOTTOM - HEADLINE_TOP - blockHeight) / 2 + capHeight
  lines.forEach((line, i) => ctx.fillText(line, PADDING, firstBaseline + i * lineHeight))
}

/** The AI label at the band's bottom right, the source and date at its bottom left, cut short of the label. */
function drawFoot(ctx: SKRSContext2D, card: StoryCard, measure: Measure) {
  const labelWidth = measure(CAROUSEL_COPY.slideFooter, FOOT_SIZE)
  ctx.font = fontOf(REGULAR, FOOT_SIZE)
  ctx.fillStyle = FOOT_COLOR
  ctx.textAlign = 'right'
  ctx.fillText(CAROUSEL_COPY.slideFooter, WIDTH - PADDING, FOOT_BASELINE)

  const source = sourceLine(card.publisher, card.date)
  if (!source) return
  const room = WIDTH - 2 * PADDING - labelWidth - PADDING / 2
  ctx.textAlign = 'left'
  ctx.fillText(measure(source, FOOT_SIZE) <= room ? source : withEllipsis(measure, source, FOOT_SIZE, room), PADDING, FOOT_BASELINE)
}

/** The story's 1200x630 card image, marked as AI-generated in its pixels and in XMP. */
export async function createStoryCardImage(card: StoryCard): Promise<Buffer> {
  registerFonts()
  const logo = await loadPreviewLogo()
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  const measureIn =
    (family: string): Measure =>
    (text, size) => {
      ctx.font = fontOf(family, size)
      return ctx.measureText(text).width
    }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, WIDTH, BAND_TOP)
  const topMidline = (BAND_TOP - STRIP_HEIGHT) / 2
  const logoRight = drawLogo(ctx, logo, topMidline)
  drawTopic(ctx, card, measureIn(BOLD), logoRight + PADDING / 2, topMidline)
  drawTopicStrip(ctx, BAND_TOP - STRIP_HEIGHT)

  ctx.fillStyle = BAND_COLOR
  ctx.fillRect(0, BAND_TOP, WIDTH, HEIGHT - BAND_TOP)
  drawHeadline(ctx, card.headline, measureIn(BOLD))
  drawFoot(ctx, card, measureIn(REGULAR))

  // The card shows an AI-written headline: mark the file as AI-generated, as the carousel slides are
  return embedXmpInPng(canvas.toBuffer('image/png'), aiGeneratedXmpPacket())
}
