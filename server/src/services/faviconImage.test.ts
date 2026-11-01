import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deflateSync } from 'zlib'
import { createCanvas } from '@napi-rs/canvas'

// The real decoder, watched: an image refused on its declared size must never reach it
vi.mock('@napi-rs/canvas', async importOriginal => {
  const actual = await importOriginal<typeof import('@napi-rs/canvas')>()
  return { ...actual, loadImage: vi.fn(actual.loadImage) }
})

const canvas = await import('@napi-rs/canvas')
const { toFaviconPng, FAVICON_SIZE_PX } = await import('./faviconImage.js')

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

async function solid(width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<Buffer> {
  const c = createCanvas(width, height)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#c00'
  ctx.fillRect(0, 0, width, height)
  return format === 'png' ? c.encode('png') : format === 'jpeg' ? c.encode('jpeg') : c.encode('webp')
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A valid 1-bit grayscale PNG of any size: a few kB that decode to width x height bytes or more. */
function blankPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 1 // bit depth
  header[9] = 0 // grayscale
  const rows = Buffer.alloc((1 + Math.ceil(width / 8)) * height)
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** An ICO file holding one PNG; `directorySize` is what the directory claims (0 means 256). */
function icoOf(png: Buffer, directorySize = 0): Buffer {
  const header = Buffer.from([0, 0, 1, 0, 1, 0])
  const entry = Buffer.alloc(16)
  entry[0] = directorySize
  entry[1] = directorySize
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)
  return Buffer.concat([header, entry, png])
}

const dimensions = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) })

beforeEach(() => {
  vi.mocked(canvas.loadImage).mockClear()
})

describe('toFaviconPng', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('turns a %s into a square PNG of the favicon size', async format => {
    const png = await toFaviconPng(await solid(64, 64, format))
    expect(png?.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(dimensions(png!)).toEqual({ width: FAVICON_SIZE_PX, height: FAVICON_SIZE_PX })
  })

  it('turns an ICO into a PNG (the BACKLOG case: ICO bytes stored under a .png name)', async () => {
    const png = await toFaviconPng(icoOf(await solid(48, 48), 48))
    expect(png?.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(dimensions(png!)).toEqual({ width: FAVICON_SIZE_PX, height: FAVICON_SIZE_PX })
  })

  it('keeps the aspect ratio of an icon that is not square, centred on transparency', async () => {
    const png = await toFaviconPng(await solid(64, 32))
    const image = await canvas.loadImage(png!)
    const ctx = createCanvas(FAVICON_SIZE_PX, FAVICON_SIZE_PX).getContext('2d')
    ctx.drawImage(image, 0, 0)
    const alphaAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3]
    expect(alphaAt(16, 2)).toBe(0) // above the band
    expect(alphaAt(16, 16)).toBe(255) // inside it
    expect(alphaAt(16, 29)).toBe(0) // below it
  })

  it('refuses bytes that are not an image it takes', async () => {
    expect(await toFaviconPng(Buffer.from('<!doctype html><title>Not found</title>'))).toBeNull()
    expect(await toFaviconPng(Buffer.alloc(0))).toBeNull()
  })

  it('refuses SVG, which would be rasterized at whatever size it declares', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>')
    expect(await toFaviconPng(svg)).toBeNull()
    expect(canvas.loadImage).not.toHaveBeenCalled()
  })

  it('refuses, without decoding, an image whose declared size would take too much memory to decode', async () => {
    const bomb = blankPng(4096, 4096)
    expect(bomb.length).toBeLessThan(100_000) // small enough to pass the download cap
    expect(await toFaviconPng(bomb)).toBeNull()
    expect(canvas.loadImage).not.toHaveBeenCalled()
  })

  it('refuses, without decoding, an ICO whose embedded PNG is larger than its directory says', async () => {
    expect(await toFaviconPng(icoOf(blankPng(4096, 4096), 0))).toBeNull()
    expect(canvas.loadImage).not.toHaveBeenCalled()
  })

  it('refuses an ICO whose directory points outside the file', async () => {
    const ico = icoOf(await solid(16, 16), 16)
    ico.writeUInt32LE(10_000, 18) // the entry's offset
    expect(await toFaviconPng(ico)).toBeNull()
    expect(canvas.loadImage).not.toHaveBeenCalled()
  })
})
