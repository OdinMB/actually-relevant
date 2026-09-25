import { describe, it, expect } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { IPTC_TRAINED_ALGORITHMIC_MEDIA } from './aiProvenance.js'
import { aiGeneratedXmpPacket, crc32, embedXmpInPng } from './xmp.js'

interface PngChunk {
  type: string
  data: Buffer
  crcValid: boolean
}

/** Minimal PNG chunk reader, independent of the writer under test. */
function readChunks(png: Buffer): PngChunk[] {
  const chunks: PngChunk[] = []
  let offset = 8
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const typeAndData = png.subarray(offset + 4, offset + 8 + length)
    const crc = png.readUInt32BE(offset + 8 + length)
    chunks.push({
      type: typeAndData.subarray(0, 4).toString('latin1'),
      data: typeAndData.subarray(4),
      crcValid: crc === crc32(typeAndData),
    })
    offset += 12 + length
  }
  return chunks
}

function smallPng(): Buffer {
  const canvas = createCanvas(4, 4)
  canvas.getContext('2d').fillRect(0, 0, 4, 4)
  return canvas.toBuffer('image/png')
}

describe('crc32', () => {
  it('matches the standard CRC-32 check value', () => {
    expect(crc32(Buffer.from('123456789', 'latin1'))).toBe(0xcbf43926)
  })
})

describe('aiGeneratedXmpPacket', () => {
  it('declares the IPTC digital source type for AI-generated media', () => {
    expect(aiGeneratedXmpPacket()).toContain(`Iptc4xmpExt:DigitalSourceType="${IPTC_TRAINED_ALGORITHMIC_MEDIA}"`)
  })
})

describe('embedXmpInPng', () => {
  it('inserts one XMP iTXt chunk directly after IHDR with a valid CRC', () => {
    const xmp = aiGeneratedXmpPacket()
    const chunks = readChunks(embedXmpInPng(smallPng(), xmp))

    expect(chunks[0].type).toBe('IHDR')
    expect(chunks[1].type).toBe('iTXt')
    expect(chunks.filter((c) => c.type === 'iTXt')).toHaveLength(1)
    expect(chunks.every((c) => c.crcValid)).toBe(true)
    expect(chunks[chunks.length - 1].type).toBe('IEND')
  })

  it('writes the packet under the XMP keyword, uncompressed', () => {
    const xmp = aiGeneratedXmpPacket()
    const itxt = readChunks(embedXmpInPng(smallPng(), xmp)).find((c) => c.type === 'iTXt')!
    const keyword = 'XML:com.adobe.xmp'

    expect(itxt.data.subarray(0, keyword.length).toString('latin1')).toBe(keyword)
    // null separator, compression flag 0, method 0, empty language tag, empty translated keyword
    expect([...itxt.data.subarray(keyword.length, keyword.length + 5)]).toEqual([0, 0, 0, 0, 0])
    expect(itxt.data.subarray(keyword.length + 5).toString('utf8')).toBe(xmp)
  })

  it('keeps every original chunk byte for byte', () => {
    const original = smallPng()
    const originalChunks = readChunks(original)
    const embeddedChunks = readChunks(embedXmpInPng(original, aiGeneratedXmpPacket())).filter((c) => c.type !== 'iTXt')
    expect(embeddedChunks.map((c) => [c.type, c.data.toString('hex')])).toEqual(
      originalChunks.map((c) => [c.type, c.data.toString('hex')]),
    )
  })

  it('still decodes as an image', async () => {
    const image = await loadImage(embedXmpInPng(smallPng(), aiGeneratedXmpPacket()))
    expect(image.width).toBe(4)
  })

  it('rejects input that is not a PNG', () => {
    expect(() => embedXmpInPng(Buffer.from('not a png'), aiGeneratedXmpPacket())).toThrow()
  })
})
