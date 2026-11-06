import { describe, it, expect, vi } from 'vitest'

/** Every text, filled shape color and image the renderer draws, recorded by a pass-through wrapper around the real canvas. */
const drawn = vi.hoisted(() => ({
  text: [] as { text: string; font: string; fill: string; x: number; y: number; align: string; width: number }[],
  fills: [] as string[],
  images: [] as { naturalWidth: number; x: number; width: number }[],
}))

vi.mock('@napi-rs/canvas', async importOriginal => {
  const actual = await importOriginal<typeof import('@napi-rs/canvas')>()
  return {
    ...actual,
    createCanvas: (width: number, height: number) => {
      const canvas = actual.createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      const fillText = ctx.fillText.bind(ctx)
      ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
        drawn.text.push({ text, font: ctx.font, fill: String(ctx.fillStyle), x, y, align: ctx.textAlign, width: ctx.measureText(text).width })
        fillText(text, x, y, maxWidth)
      }
      const fill = ctx.fill.bind(ctx) as () => void
      ctx.fill = (() => {
        drawn.fills.push(String(ctx.fillStyle))
        fill()
      }) as typeof ctx.fill
      const drawImage = ctx.drawImage.bind(ctx) as (...args: unknown[]) => void
      ctx.drawImage = ((image: { width: number }, ...rest: number[]) => {
        drawn.images.push({ naturalWidth: image.width, x: rest[0]!, width: rest[2]! })
        drawImage(image, ...rest)
      }) as typeof ctx.drawImage
      canvas.getContext = (() => ctx) as unknown as typeof canvas.getContext
      return canvas
    },
  }
})

const { createStoryCardImage, fitHeadline, sourceLine, HEADLINE_SIZES } = await import('./storyCardImage.js')
const { OG_IMAGE_SIZE } = await import('./previewImageParts.js')
const { IPTC_TRAINED_ALGORITHMIC_MEDIA } = await import('../lib/aiProvenance.js')
type StoryCard = import('./storyCardImage.js').StoryCard

const FOOTER = 'actuallyrelevant.news · AI-generated'
const LONG_HEADLINE = 'Malaria vaccine rollout reaches twelve more countries as two manufacturers double their yearly supply of doses'

const card: StoryCard = {
  headline: 'Cuts fall far short of 2035 goal',
  topic: 'Planet & Climate',
  topicColor: '#2dd4bf',
  publisher: 'Nation',
  date: '2026-10-11T07:30:00Z',
}

function reset() {
  drawn.text.length = 0
  drawn.fills.length = 0
  drawn.images.length = 0
}

const fontSize = (font: string) => Number(/^(\d+(?:\.\d+)?)px/.exec(font)?.[1])

/** A measure that gives every character the same width, so the fitting is easy to follow. */
const perChar = (charWidth: number) => (text: string, size: number) => text.length * size * charWidth

describe('fitHeadline', () => {
  it('keeps a short headline on one line at the largest size', () => {
    expect(fitHeadline(perChar(0.5), 'Ozone recovers', 1072, 332)).toEqual({ size: 88, lines: ['Ozone recovers'] })
  })

  it('evens out the lines, so the last one is not left with a word or two', () => {
    // Filled line by line, the first line would take "Cuts fall far short of" and leave "2035 goal"
    expect(fitHeadline(perChar(0.5), 'Cuts fall far short of 2035 goal', 1072, 332)).toEqual({ size: 88, lines: ['Cuts fall far', 'short of 2035 goal'] })
  })

  it('shrinks a long headline to the largest size where all of it fits the width and the height', () => {
    // 110 characters: at 68 it needs five lines where the height holds four; at 64 four lines of at most 30 characters fit
    const { size, lines } = fitHeadline(perChar(0.55), LONG_HEADLINE, 1072, 332)
    expect(size).toBe(64)
    expect(lines).toHaveLength(4)
    expect(lines.join(' ')).toBe(LONG_HEADLINE)
    for (const line of lines) expect(line.length * size * 0.55).toBeLessThanOrEqual(1072)
    expect(lines.length * size * 1.14).toBeLessThanOrEqual(332)
  })

  it('cuts a headline that fits nowhere with an ellipsis, at the smallest size', () => {
    const { size, lines } = fitHeadline(perChar(0.5), 'word '.repeat(200).trim(), 1072, 332)
    expect(size).toBe(HEADLINE_SIZES[HEADLINE_SIZES.length - 1])
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines[lines.length - 1]).toMatch(/…$/)
    for (const line of lines) expect(line.length * size * 0.5).toBeLessThanOrEqual(1072)
  })

  it('cuts one word too long for the width with an ellipsis', () => {
    const { size, lines } = fitHeadline(perChar(0.5), 'x'.repeat(60), 1072, 332)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^x+…$/)
    expect(lines[0]!.length * size * 0.5).toBeLessThanOrEqual(1072)
  })
})

describe('sourceLine', () => {
  it('names the source and the day it published the story', () => {
    expect(sourceLine('Nation', '2026-10-11T07:30:00Z')).toBe('Nation, Oct 11')
  })

  it('leaves out whatever is missing', () => {
    expect(sourceLine('Nation', null)).toBe('Nation')
    expect(sourceLine('Nation', 'not a date')).toBe('Nation')
    expect(sourceLine('', '2026-10-11T07:30:00Z')).toBe('Oct 11')
    expect(sourceLine('', null)).toBe('')
  })
})

describe('createStoryCardImage', () => {
  it('renders a 1200x630 PNG, marked as AI-generated in embedded XMP', async () => {
    const png = await createStoryCardImage(card)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(OG_IMAGE_SIZE.width)
    expect(png.readUInt32BE(20)).toBe(OG_IMAGE_SIZE.height)
    expect(png.includes(`DigitalSourceType="${IPTC_TRAINED_ALGORITHMIC_MEDIA}"`)).toBe(true)
  })

  it('draws the AI label at the bottom right, fully inside the image', async () => {
    reset()
    await createStoryCardImage(card)
    const footer = drawn.text.find(d => d.text === FOOTER)
    expect(footer).toBeDefined()
    expect(footer!.align).toBe('right')
    expect(footer!.x).toBeLessThanOrEqual(OG_IMAGE_SIZE.width)
    expect(footer!.x - footer!.width).toBeGreaterThanOrEqual(0)
    expect(footer!.y).toBeGreaterThan(OG_IMAGE_SIZE.height * 0.85)
    expect(footer!.y).toBeLessThanOrEqual(OG_IMAGE_SIZE.height)
    // Large enough to read when a card shows the image at about 360px wide
    expect(fontSize(footer!.font)).toBeGreaterThanOrEqual(28)
  })

  it('draws a long headline whole, inside the image, as the largest text on it', async () => {
    reset()
    await createStoryCardImage({ ...card, headline: LONG_HEADLINE })
    const headline = drawn.text.filter(d => LONG_HEADLINE.includes(d.text) && d.text.length > 3)
    expect(headline.map(d => d.text).join(' ')).toBe(LONG_HEADLINE)
    for (const line of headline) {
      expect(line.x).toBeGreaterThanOrEqual(0)
      expect(line.x + line.width).toBeLessThanOrEqual(OG_IMAGE_SIZE.width)
      expect(line.y).toBeLessThan(OG_IMAGE_SIZE.height)
      expect(fontSize(line.font)).toBeGreaterThanOrEqual(48)
    }
    const others = drawn.text.filter(d => !headline.includes(d))
    expect(Math.max(...others.map(d => fontSize(d.font)))).toBeLessThan(fontSize(headline[0]!.font))
  })

  it("draws the topic after a dot in the topic's color", async () => {
    reset()
    await createStoryCardImage({ ...card, topic: 'Bioterrorism', topicColor: '#f87171' })
    expect(drawn.text.some(d => d.text === 'Bioterrorism')).toBe(true)
    expect(drawn.fills).toContain('#f87171')
  })

  it('fits a long topic name between the logo and the right edge', async () => {
    reset()
    await createStoryCardImage({ ...card, topic: 'Global Governance and International Institution Failure' })
    const [logo] = drawn.images
    const topic = drawn.text.find(d => d.text.startsWith('Global'))!
    expect(topic.x).toBeGreaterThan(logo!.x + logo!.width * 0.9)
    expect(topic.x + topic.width).toBeLessThanOrEqual(OG_IMAGE_SIZE.width)
  })

  it('draws the source and date at the bottom left, and nothing there without them', async () => {
    reset()
    await createStoryCardImage(card)
    const source = drawn.text.find(d => d.text === 'Nation, Oct 11')
    expect(source).toBeDefined()
    expect(source!.align).toBe('left')
    expect(source!.y).toBe(drawn.text.find(d => d.text === FOOTER)!.y)

    reset()
    await createStoryCardImage({ ...card, publisher: '', date: null })
    const footer = drawn.text.find(d => d.text === FOOTER)!
    expect(drawn.text.filter(d => d.y === footer.y)).toEqual([footer])
  })

  it('cuts a long source name before it reaches the AI label', async () => {
    reset()
    await createStoryCardImage({ ...card, publisher: 'The Very Long Name of an Investigative Newsroom and Its Partner Network' })
    const source = drawn.text.find(d => d.text.startsWith('The Very'))!
    const footer = drawn.text.find(d => d.text === FOOTER)!
    expect(source.text).toMatch(/…$/)
    expect(source.x + source.width).toBeLessThan(footer.x - footer.width)
  })

  it('draws the logo no larger than its own size, so it stays sharp', async () => {
    reset()
    await createStoryCardImage(card)
    expect(drawn.images).toHaveLength(1)
    expect(drawn.images[0]!.width).toBeLessThanOrEqual(drawn.images[0]!.naturalWidth)
  })
})
