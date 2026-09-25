import { IPTC_TRAINED_ALGORITHMIC_MEDIA } from './aiProvenance.js'

/**
 * XMP metadata marking generated files as AI-generated (IPTC DigitalSourceType).
 * Unsigned: a fallback marker, not the Code of Practice's signed metadata layer.
 * Never put a user's identity in these marks [AI Act Guidelines ¶94].
 */

/** rdf:Description carrying the IPTC DigitalSourceType; PDFKit's appendXML takes this fragment. */
export function aiGeneratedXmpDescription(): string {
  return (
    '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
    `Iptc4xmpExt:DigitalSourceType="${IPTC_TRAINED_ALGORITHMIC_MEDIA}"/>`
  )
}

/** A complete XMP packet for embedding in image files. */
export function aiGeneratedXmpPacket(): string {
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    aiGeneratedXmpDescription() +
    '</rdf:RDF></x:xmpmeta>' +
    '<?xpacket end="r"?>'
  )
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Keyword the XMP spec (Part 3) assigns to the iTXt chunk that carries XMP in PNG. */
const XMP_ITXT_KEYWORD = 'XML:com.adobe.xmp'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** CRC-32 as PNG chunks use it (ISO 3309 / ITU-T V.42). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * Return a copy of `png` with an uncompressed XMP iTXt chunk inserted directly after
 * IHDR. All original chunks are kept byte for byte.
 */
export function embedXmpInPng(png: Buffer, xmp: string): Buffer {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('embedXmpInPng: input is not a PNG')
  }
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8)
  // keyword, null separator, compression flag, compression method, empty language tag + null, empty translated keyword + null
  const itxtData = Buffer.concat([
    Buffer.from(XMP_ITXT_KEYWORD, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(xmp, 'utf8'),
  ])
  return Buffer.concat([png.subarray(0, ihdrEnd), pngChunk('iTXt', itxtData), png.subarray(ihdrEnd)])
}
