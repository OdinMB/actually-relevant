import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync } from 'fs'
import { rm, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

/** Every text the slide renderer draws, recorded by a pass-through wrapper around the real canvas. */
const drawnText = vi.hoisted(() => [] as { text: string; x: number; align: string; width: number }[])

vi.mock('@napi-rs/canvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@napi-rs/canvas')>()
  return {
    ...actual,
    createCanvas: (width: number, height: number) => {
      const canvas = actual.createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      const fillText = ctx.fillText.bind(ctx)
      ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
        drawnText.push({ text, x, align: ctx.textAlign, width: ctx.measureText(text).width })
        fillText(text, x, y, maxWidth)
      }
      canvas.getContext = (() => ctx) as unknown as typeof canvas.getContext
      return canvas
    },
  }
})

const {
  createStoryImage,
  generateCarouselPdf,
  generateCarouselZip,
  buildCarouselPostText,
  slideAltText,
  CAROUSEL_POST_TEXT_FILE,
} = await import('./carousel.js')
type CarouselStory = import('./carousel.js').CarouselStory
const { IPTC_TRAINED_ALGORITHMIC_MEDIA } = await import('../lib/aiProvenance.js')

const sampleStory: CarouselStory = {
  title: 'Major AI breakthrough in quantum computing research',
  category: 'AI & Technology',
  summary: 'Researchers have developed a new approach to quantum error correction that could accelerate the development of practical quantum computers.',
  publisher: 'Nature',
  date: '2024-06-15T00:00:00Z',
}

describe('createStoryImage', () => {
  it('returns a PNG buffer', () => {
    const buffer = createStoryImage(sampleStory)
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)
    // PNG magic bytes
    expect(buffer[0]).toBe(0x89)
    expect(buffer[1]).toBe(0x50) // P
    expect(buffer[2]).toBe(0x4e) // N
    expect(buffer[3]).toBe(0x47) // G
  })

  it('handles stories with no date', () => {
    const story = { ...sampleStory, date: null }
    const buffer = createStoryImage(story)
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('handles stories with long titles', () => {
    const story = {
      ...sampleStory,
      title: 'This is a very long title that should be word-wrapped across multiple lines on the generated image to ensure readability',
    }
    const buffer = createStoryImage(story)
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('marks the image as AI-generated in embedded XMP', () => {
    const buffer = createStoryImage(sampleStory)
    expect(buffer.includes(`DigitalSourceType="${IPTC_TRAINED_ALGORITHMIC_MEDIA}"`)).toBe(true)
  })

  it('draws the AI label into the slide footer, fully inside the slide', () => {
    drawnText.length = 0
    createStoryImage(sampleStory)
    const footer = drawnText.find((d) => d.text === 'actuallyrelevant.news · AI-generated')
    expect(footer).toBeDefined()
    expect(footer!.align).toBe('right')
    expect(footer!.x).toBeLessThanOrEqual(1200)
    expect(footer!.x - footer!.width).toBeGreaterThanOrEqual(0)
  })
})

describe('carousel post text', () => {
  it('leads with the AI line and gives each slide file an alt text with the AI prefix', () => {
    const second = { ...sampleStory, title: 'Is the ozone layer healing?', summary: 'It is.' }
    const text = buildCarouselPostText([sampleStory, second], ['01_a.png', '02_b.png'])

    expect(text).toBe(
      [
        'Post text:',
        'The headlines and summaries in these slides are AI-generated.',
        '',
        'Alt text:',
        `01_a.png\nAI-generated summary: ${sampleStory.title}. ${sampleStory.summary}`,
        '',
        '02_b.png\nAI-generated summary: Is the ozone layer healing? It is.',
        '',
      ].join('\n'),
    )
  })

  it('starts every alt text with the AI prefix', () => {
    expect(slideAltText(sampleStory).startsWith('AI-generated summary: ')).toBe(true)
  })
})

describe('generateCarouselPdf', () => {
  const outputDir = join(tmpdir(), `test_carousel_pdf_${Date.now()}`)

  afterEach(async () => {
    try {
      if (existsSync(outputDir)) await rm(outputDir, { recursive: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('marks the PDF as AI-generated in its XMP metadata stream', async () => {
    mkdirSync(outputDir, { recursive: true })
    const imagePath = join(outputDir, 'slide.png')
    await writeFile(imagePath, createStoryImage(sampleStory))
    const pdfPath = join(outputDir, 'carousel.pdf')

    await generateCarouselPdf([imagePath], pdfPath)

    const pdf = await readFile(pdfPath)
    expect(pdf.includes('/Type /Metadata')).toBe(true)
    expect(pdf.includes(`DigitalSourceType="${IPTC_TRAINED_ALGORITHMIC_MEDIA}"`)).toBe(true)
  })
})

describe('generateCarouselZip', () => {
  const outputDir = join(tmpdir(), `test_carousel_${Date.now()}`)

  afterEach(async () => {
    // Clean up
    try {
      if (existsSync(outputDir)) await rm(outputDir, { recursive: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('generates a ZIP file', async () => {
    const stories: CarouselStory[] = [
      sampleStory,
      { ...sampleStory, title: 'Climate report shows progress', category: 'Planet & Climate' },
    ]

    const zipPath = await generateCarouselZip(stories, outputDir)
    expect(existsSync(zipPath)).toBe(true)
    expect(zipPath).toContain('carousel_images.zip')
  })

  it('ships the post text file in the ZIP', async () => {
    const zipPath = await generateCarouselZip([sampleStory], outputDir)
    // ZIP headers store entry names uncompressed
    expect((await readFile(zipPath)).includes(CAROUSEL_POST_TEXT_FILE)).toBe(true)
  })

  it('handles a single story', async () => {
    const zipPath = await generateCarouselZip([sampleStory], outputDir)
    expect(existsSync(zipPath)).toBe(true)
  })
})
