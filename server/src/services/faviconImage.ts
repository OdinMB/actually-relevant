/**
 * Turns a downloaded favicon into what is stored and served: a square PNG of FAVICON_SIZE_PX
 * (.context/feed-management.md, "Favicons"). Decoding is the risk: a file of a few kB can declare a
 * huge image (a blank PNG of 100 kB decodes to gigabytes), so the size each image declares is read
 * from its header first, and anything larger than MAX_SOURCE_SIDE_PX is refused before it is decoded.
 */
import { imageSize } from 'image-size'
import { createCanvas, loadImage } from '@napi-rs/canvas'

export const FAVICON_SIZE_PX = 32
/** Largest width or height decoded (1024 x 1024 is 4 MB of pixels); favicons run from 16 to 512. */
const MAX_SOURCE_SIDE_PX = 1024
/**
 * Raster formats taken, as image-size names them. SVG is not: it is rasterized at the size it
 * declares, which its attributes do not reliably give.
 */
const ACCEPTED_TYPES = new Set(['png', 'jpg', 'gif', 'webp', 'bmp', 'ico'])
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ICO_HEADER_BYTES = 6
const ICO_ENTRY_BYTES = 16

interface Size {
  width: number
  height: number
}

/** The size the image declares, before anything is decoded; null for a format not taken or a malformed header. */
function declaredSize(bytes: Buffer): Size | null {
  try {
    const size = imageSize(bytes)
    if (!size.type || !ACCEPTED_TYPES.has(size.type)) return null
    return size.type === 'ico' ? largestIcoImage(bytes) : { width: size.width, height: size.height }
  } catch {
    return null
  }
}

/**
 * The largest image an ICO holds, read from each image's own header: the directory's one-byte sizes
 * stop at 256, while the decoder goes by the embedded PNG or BMP. Throws on an entry outside the file.
 */
function largestIcoImage(ico: Buffer): Size | null {
  let largest: Size = { width: 0, height: 0 }
  const count = ico.readUInt16LE(4)
  for (let i = 0; i < count; i++) {
    const entry = ICO_HEADER_BYTES + i * ICO_ENTRY_BYTES
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    if (offset + length > ico.length) return null
    const size = embeddedSize(ico.subarray(offset, offset + length))
    largest = { width: Math.max(largest.width, size.width), height: Math.max(largest.height, size.height) }
  }
  return largest
}

/** An ICO image is a PNG, or a BMP info header whose height counts the image and its mask. */
function embeddedSize(image: Buffer): Size {
  if (image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    const { width, height } = imageSize(image)
    return { width, height }
  }
  return { width: Math.abs(image.readInt32LE(4)), height: Math.abs(image.readInt32LE(8)) / 2 }
}

const fits = (size: Size | null): size is Size =>
  size !== null && size.width >= 1 && size.height >= 1 && size.width <= MAX_SOURCE_SIDE_PX && size.height <= MAX_SOURCE_SIDE_PX

/**
 * The favicon as a FAVICON_SIZE_PX square PNG, the image scaled to fit and centred on transparency;
 * null when the bytes are not an image taken here, declare too large a size, or do not decode.
 */
export async function toFaviconPng(bytes: Buffer): Promise<Buffer | null> {
  if (!fits(declaredSize(bytes))) return null
  try {
    // A Buffer only: given a string, loadImage would read a file path or fetch a URL
    const image = await loadImage(bytes)
    const scale = FAVICON_SIZE_PX / Math.max(image.width, image.height)
    const width = image.width * scale
    const height = image.height * scale
    const canvas = createCanvas(FAVICON_SIZE_PX, FAVICON_SIZE_PX)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, (FAVICON_SIZE_PX - width) / 2, (FAVICON_SIZE_PX - height) / 2, width, height)
    return await canvas.encode('png')
  } catch {
    return null
  }
}
