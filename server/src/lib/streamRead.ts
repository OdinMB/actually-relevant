import type { Readable } from 'stream'

/**
 * Read a response stream up to `maxBytes`, stopping the download there. Past the cap, with
 * `truncate` the first `maxBytes` are returned, else null (the caller gives up on the response).
 */
export async function readCapped(body: Readable, maxBytes: number, truncate: boolean): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buf.byteLength
    chunks.push(buf)
    if (totalBytes > maxBytes) {
      body.destroy()
      if (!truncate) return null
      return Buffer.concat(chunks).subarray(0, maxBytes)
    }
  }
  return Buffer.concat(chunks)
}
