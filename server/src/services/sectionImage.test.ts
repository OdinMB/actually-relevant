import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'fs'

/** Every text and image the renderer draws, recorded by a pass-through wrapper around the real canvas. */
const drawnText = vi.hoisted(() => [] as { text: string; font: string; x: number; width: number }[])
const drawnImages = vi.hoisted(() => [] as { naturalWidth: number; width: number }[])

vi.mock('@napi-rs/canvas', async importOriginal => {
  const actual = await importOriginal<typeof import('@napi-rs/canvas')>()
  return {
    ...actual,
    createCanvas: (width: number, height: number) => {
      const canvas = actual.createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      const fillText = ctx.fillText.bind(ctx)
      ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
        drawnText.push({ text, font: ctx.font, x, width: ctx.measureText(text).width })
        fillText(text, x, y, maxWidth)
      }
      const drawImage = ctx.drawImage.bind(ctx) as (...args: unknown[]) => void
      ctx.drawImage = ((image: { width: number }, ...rest: number[]) => {
        drawnImages.push({ naturalWidth: image.width, width: rest[2]! })
        drawImage(image, ...rest)
      }) as typeof ctx.drawImage
      canvas.getContext = (() => ctx) as unknown as typeof canvas.getContext
      return canvas
    },
  }
})

const { createSectionImage, fitLabel, SECTION_FONT_PATH, SECTION_LOGO_PATH } = await import('./sectionImage.js')
const { createStoryImage, OG_IMAGE_SIZE } = await import('./carousel.js')

function pngSize(png: Buffer) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** A measure that gives every character the same width, so the fitting is easy to follow. */
const perChar = (charWidth: number) => (text: string, size: number) => text.length * size * charWidth

describe('fitLabel', () => {
  const none = () => 0
  const plain = { lead: none, trail: none }

  it('keeps a short name on one line at the largest size', () => {
    expect(fitLabel(perChar(0.5), 'Podcast', 1000, plain)).toEqual({ size: 100, lines: ['Podcast'] })
  })

  it('shrinks a name to fit one line before it breaks it', () => {
    // 20 characters at half the size each: 900 wide fits sizes up to 90
    expect(fitLabel(perChar(0.5), 'Twenty characters ok', 900, plain)).toEqual({ size: 88, lines: ['Twenty characters ok'] })
  })

  it('breaks a long name into two lines of about equal width, at the largest size where both fit', () => {
    const { size, lines } = fitLabel(perChar(0.5), 'Global Governance and International Institution Failure', 1080, plain)
    expect(lines).toEqual(['Global Governance and', 'International Institution Failure'])
    expect(size).toBe(64)
  })

  it('leaves room on the line for the dot before the name and the badge after it', () => {
    const sized = (size: number) => size
    expect(fitLabel(perChar(0.5), 'Podcast', 400, { lead: sized, trail: none })).toEqual({ size: 88, lines: ['Podcast'] })
    expect(fitLabel(perChar(0.5), 'Podcast', 400, { lead: none, trail: sized })).toEqual({ size: 88, lines: ['Podcast'] })
  })

  it("puts the dot's room on the first line only and the badge's on the last line only", () => {
    // At 80 the lines are 960 and 160 wide: room for 160 more on the last line, none on the first
    const twice = (size: number) => size * 2
    expect(fitLabel(perChar(1), 'aaaaaaaaaaaa bb', 1000, { lead: none, trail: twice })).toEqual({ size: 80, lines: ['aaaaaaaaaaaa', 'bb'] })
    expect(fitLabel(perChar(1), 'bb aaaaaaaaaaaa', 1000, { lead: twice, trail: none })).toEqual({ size: 80, lines: ['bb', 'aaaaaaaaaaaa'] })
  })

  it('cuts a name that fits nowhere with an ellipsis, and never cuts one long word that fits at the smallest size', () => {
    const long = fitLabel(perChar(0.5), 'x'.repeat(60), 1080, plain)
    expect(long.size).toBe(52)
    expect(long.lines).toHaveLength(1)
    expect(long.lines[0]).toMatch(/^x+…$/)
    expect(long.lines[0]!.length * 52 * 0.5).toBeLessThanOrEqual(1080)
    expect(fitLabel(perChar(0.5), 'x'.repeat(40), 1080, plain)).toEqual({ size: 52, lines: ['x'.repeat(40)] })
  })
})

describe('createSectionImage', () => {
  // First, while no section image has registered its font yet
  it('leaves the story images as they were: registering its font changes no other text', async () => {
    const story = { title: 'A headline', category: 'Planet & Climate', summary: 'A summary.', publisher: 'Nation', date: null }
    const before = createStoryImage(story, OG_IMAGE_SIZE)
    await createSectionImage({ text: 'Newsletter' })
    expect(createStoryImage(story, OG_IMAGE_SIZE).equals(before)).toBe(true)
  })

  it('ships its font and logo with the server', () => {
    expect(existsSync(SECTION_FONT_PATH)).toBe(true)
    expect(existsSync(SECTION_LOGO_PATH)).toBe(true)
  })

  it('renders a 1200x630 PNG', async () => {
    const png = await createSectionImage({ text: 'Newsletter' })
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(pngSize(png)).toEqual(OG_IMAGE_SIZE)
  })

  it('draws the section name in the brand font, centered, and nothing else as text', async () => {
    drawnText.length = 0
    await createSectionImage({ text: 'Podcast' })
    expect(drawnText).toHaveLength(1)
    const [label] = drawnText
    expect(label!.text).toBe('Podcast')
    expect(label!.font).toContain('SectionRobotoBold')
    expect(label!.x + label!.width / 2).toBeCloseTo(OG_IMAGE_SIZE.width / 2, 0)
  })

  it("draws a badge after the name at half the name's size, the two centered together", async () => {
    drawnText.length = 0
    await createSectionImage({ text: 'Newsletter', badge: 'AI' })
    expect(drawnText.map(d => d.text)).toEqual(['Newsletter', 'AI'])
    const [name, badge] = drawnText as [(typeof drawnText)[number], (typeof drawnText)[number]]
    expect(name.font).toBe('100px SectionRobotoBold, sans-serif')
    expect(badge.font).toBe('50px SectionRobotoBold, sans-serif')
    expect(badge.x).toBeGreaterThan(name.x + name.width)
    // The badge's right edge: its text, then its side padding and border (0.4em + 0.1em of 50px)
    const right = badge.x + badge.width + 25
    expect((name.x + right) / 2).toBeCloseTo(OG_IMAGE_SIZE.width / 2, 0)
  })

  it('draws the logo no larger than its own size, so it stays sharp', async () => {
    drawnImages.length = 0
    await createSectionImage({ text: 'Newsletter' })
    expect(drawnImages).toHaveLength(1)
    expect(drawnImages[0]!.width).toBeLessThanOrEqual(drawnImages[0]!.naturalWidth)
  })

  it('draws a long topic name on two lines inside the image', async () => {
    drawnText.length = 0
    await createSectionImage({ text: 'Global Governance and International Institution Failure', accent: '#f87171' })
    expect(drawnText.map(d => d.text)).toEqual(['Global Governance and', 'International Institution Failure'])
    for (const line of drawnText) {
      expect(line.x).toBeGreaterThanOrEqual(0)
      expect(line.x + line.width).toBeLessThanOrEqual(OG_IMAGE_SIZE.width)
    }
  })

  it('carries no AI mark: it holds no AI text', async () => {
    const png = await createSectionImage({ text: 'Newsletter' })
    expect(png.includes('DigitalSourceType')).toBe(false)
  })
})
