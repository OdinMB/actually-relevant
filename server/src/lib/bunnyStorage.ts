/**
 * Writing and deleting objects in the Bunny Storage zone that the audio pull zone serves
 * (`config.podcast.audioBaseUrl`). The CDN caches a deleted object for up to 30 days and nothing
 * here purges it, so callers never reuse a path: every render gets a fresh file name.
 */
import { createHash } from 'crypto'
import axios from 'axios'
import { config } from '../config.js'
import { withRetry } from './retry.js'

export function isBunnyConfigured(): boolean {
  return config.bunny.storageZone !== '' && config.bunny.storagePassword !== ''
}

/** A safe object path: ASCII segments without `..`, no leading slash. */
function assertPath(path: string): void {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) || path.split('/').includes('..')) {
    throw new Error(`invalid storage path: ${path}`)
  }
}

function objectUrl(path: string): string {
  assertPath(path)
  return `https://${config.bunny.storageHost}/${encodeURIComponent(config.bunny.storageZone)}/${path}`
}

/** The public CDN URL of an object. */
export function publicUrl(path: string): string {
  assertPath(path)
  return `${config.podcast.audioBaseUrl}/${path}`
}

/** Upload (or overwrite) an object; Bunny verifies the SHA-256 checksum. Idempotent, so retried. */
export async function putObject(path: string, body: Buffer, contentType: string): Promise<void> {
  const url = objectUrl(path)
  const checksum = createHash('sha256').update(body).digest('hex').toUpperCase()
  await withRetry(() => axios.put(url, body, {
    headers: { AccessKey: config.bunny.storagePassword, 'Content-Type': contentType, Checksum: checksum },
    timeout: config.bunny.timeoutMs,
    maxBodyLength: Infinity,
  }))
}

/** Delete an object; one that is already gone counts as deleted. Idempotent, so retried. */
export async function deleteObject(path: string): Promise<void> {
  const url = objectUrl(path)
  await withRetry(async () => {
    try {
      await axios.delete(url, { headers: { AccessKey: config.bunny.storagePassword }, timeout: config.bunny.timeoutMs })
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return
      throw err
    }
  })
}
