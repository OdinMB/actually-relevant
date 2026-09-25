import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import PDFDocument from 'pdfkit'
import archiver from 'archiver'
import { createWriteStream, mkdirSync, unlinkSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { aiGeneratedXmpDescription, aiGeneratedXmpPacket, embedXmpInPng } from '../lib/xmp.js'
import { CAROUSEL_COPY } from '../lib/aiLabelCopy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(__dirname, '..', '..', 'assets')

// Image dimensions (matching PHP version)
const WIDTH = 1200
const HEIGHT = 675
const PADDING = 50
const HEADER_HEIGHT = 80

export interface CarouselStory {
  title: string
  category: string
  summary: string
  publisher: string
  date: string | null
}

function registerFonts() {
  const boldPath = join(ASSETS_DIR, 'fonts', 'Inter-Bold.ttf')
  const regularPath = join(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf')
  if (existsSync(boldPath)) {
    GlobalFonts.registerFromPath(boldPath, 'InterBold')
  }
  if (existsSync(regularPath)) {
    GlobalFonts.registerFromPath(regularPath, 'InterRegular')
  }
}

function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const metrics = ctx.measureText(testLine)
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

export function createStoryImage(story: CarouselStory): Buffer {
  registerFonts()

  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Header bar (colored rectangle)
  ctx.fillStyle = '#2563eb'
  ctx.fillRect(0, 0, WIDTH, HEADER_HEIGHT)

  // Header text (category name on the header)
  ctx.fillStyle = '#ffffff'
  ctx.font = '24px InterBold, Arial, sans-serif'
  ctx.fillText(story.category.toUpperCase(), PADDING, HEADER_HEIGHT / 2 + 8)

  // Content area starts below header
  let currentY = HEADER_HEIGHT + PADDING

  // Category text
  ctx.fillStyle = '#6b7280'
  ctx.font = '15px InterRegular, Arial, sans-serif'
  ctx.fillText(story.category, PADDING, currentY)
  currentY += 25

  // Title (bold, word-wrapped)
  ctx.fillStyle = '#000000'
  ctx.font = '30px InterBold, Arial, sans-serif'
  const titleLines = wrapText(ctx, story.title, WIDTH - PADDING * 2)
  for (const line of titleLines) {
    ctx.fillText(line, PADDING, currentY)
    currentY += 42
  }
  currentY += 10

  // Publisher + date
  ctx.fillStyle = '#374151'
  ctx.font = '20px InterRegular, Arial, sans-serif'
  let publisherText = story.publisher
  if (story.date) {
    try {
      const d = new Date(story.date)
      if (d.getTime() > 0) {
        const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        publisherText += `, ${formatted}`
      }
    } catch {
      // Ignore invalid dates
    }
  }
  ctx.fillText(publisherText, PADDING, currentY)
  currentY += 35

  // Summary (word-wrapped)
  ctx.fillStyle = '#374151'
  ctx.font = '20px InterRegular, Arial, sans-serif'
  const summaryLines = wrapText(ctx, story.summary, WIDTH - PADDING * 2)
  for (const line of summaryLines) {
    if (currentY > HEIGHT - PADDING - 80) break // Leave room for logo area
    ctx.fillText(line, PADDING, currentY)
    currentY += 30
  }

  // Footer (bottom-right): the site and the AI label, drawn into the pixels so the label travels
  // with the image when it is posted or reshared (AI Act Art. 50(4)). Right-aligned so the longer
  // text stays on the slide; the same gray as the category line, for contrast on white.
  ctx.fillStyle = '#6b7280'
  ctx.font = '14px InterRegular, Arial, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(CAROUSEL_COPY.slideFooter, WIDTH - PADDING, HEIGHT - PADDING / 2 - 10)

  // The slide renders AI-written headline and summary text: mark the file as AI-generated.
  return embedXmpInPng(canvas.toBuffer('image/png'), aiGeneratedXmpPacket())
}

export async function generateCarouselZip(
  stories: CarouselStory[],
  outputDir: string,
): Promise<string> {
  mkdirSync(outputDir, { recursive: true })

  const imagePaths: string[] = []
  const filenames = stories.map(slideFilename)
  const fs = await import('fs/promises')

  // Generate PNG images
  for (let i = 0; i < stories.length; i++) {
    const buffer = createStoryImage(stories[i])
    const filepath = join(outputDir, filenames[i])
    await fs.writeFile(filepath, buffer)
    imagePaths.push(filepath)
  }

  // Generate PDF
  const pdfPath = join(outputDir, 'carousel_images.pdf')
  await generateCarouselPdf(imagePaths, pdfPath)

  // The slides are posted by hand, so the ZIP carries the AI-labeled post text and alt texts
  const postTextPath = join(outputDir, CAROUSEL_POST_TEXT_FILE)
  await fs.writeFile(postTextPath, buildCarouselPostText(stories, filenames), 'utf8')

  // Create ZIP
  const zipPath = join(outputDir, 'carousel_images.zip')
  await createZip([...imagePaths, pdfPath, postTextPath], zipPath)

  // Clean up individual images, PDF and post text
  for (const filePath of [...imagePaths, pdfPath, postTextPath]) {
    try { unlinkSync(filePath) } catch { /* ignore */ }
  }

  return zipPath
}

function slideFilename(story: CarouselStory, index: number): string {
  return `${String(index + 1).padStart(2, '0')}_${story.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}.png`
}

/** Name of the text file in the carousel ZIP that holds the post text and the alt texts. */
export const CAROUSEL_POST_TEXT_FILE = 'post-text.txt'

/** Alt text of one slide: the AI label prefix, then the headline and summary it shows. */
export function slideAltText(story: CarouselStory): string {
  const title = /[.!?]$/.test(story.title) ? story.title : `${story.title}.`
  return `${CAROUSEL_COPY.altTextPrefix}${title} ${story.summary}`.trim()
}

/** Post text line and one alt text per slide file, for whoever posts the carousel by hand. */
export function buildCarouselPostText(stories: CarouselStory[], filenames: string[]): string {
  const altTexts = stories.map((story, i) => `${filenames[i]}\n${slideAltText(story)}`)
  return ['Post text:', CAROUSEL_COPY.postText, '', 'Alt text:', altTexts.join('\n\n'), ''].join('\n')
}

/**
 * Document info marking the PDF as AI-generated. Names the application, never the
 * admin who exported it (AI Act Guidelines ¶94: no creator identity in the marks).
 */
const AI_PDF_INFO = {
  Creator: 'Actually Relevant',
  Producer: 'Actually Relevant',
  Subject: 'AI-generated',
  Keywords: 'AI-generated, trainedAlgorithmicMedia',
}

export function generateCarouselPdf(imagePaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      layout: 'landscape',
      size: [HEIGHT, WIDTH], // PDFKit uses [width, height] but landscape flips them
      margin: 0,
      autoFirstPage: false,
      // PDFKit writes the XMP metadata stream only for PDF 1.4 and later
      pdfVersion: '1.4',
      info: AI_PDF_INFO,
    })

    const stream = createWriteStream(outputPath)
    doc.pipe(stream)

    for (const imagePath of imagePaths) {
      doc.addPage({ size: [WIDTH, HEIGHT], margin: 0 })
      doc.image(imagePath, 0, 0, { width: WIDTH, height: HEIGHT })
    }

    doc.appendXML(aiGeneratedXmpDescription())
    doc.end()
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

function createZip(filePaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', resolve)
    archive.on('error', reject)

    archive.pipe(output)

    for (const filePath of filePaths) {
      const name = filePath.split(/[/\\]/).pop()!
      archive.file(filePath, { name })
    }

    archive.finalize()
  })
}
