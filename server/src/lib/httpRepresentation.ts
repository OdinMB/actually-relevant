/**
 * A small, cached response body served with HTTP validators and compression: a strong ETag (hash of
 * the body), Last-Modified, Content-Length, gzip or deflate by Accept-Encoding, and 304 for
 * If-None-Match / If-Modified-Since. The encodings are computed once, when the body is prepared, so
 * a cached representation costs nothing per request. Used by the podcast feed, which directory
 * crawlers poll; the app has no global compression middleware.
 */
import { createHash } from 'node:crypto'
import { deflateSync, gzipSync } from 'node:zlib'
import type { Request, Response } from 'express'

export type ContentCoding = 'gzip' | 'deflate' | 'identity'

export interface Representation {
  identity: Buffer
  gzip: Buffer
  deflate: Buffer
  /** Strong ETag of the identity body, quoted. Each encoding is served with its own suffixed tag. */
  etag: string
  /** Whole seconds, as HTTP dates carry. */
  lastModified: Date
}

/** Encodings we can serve, in order of preference when the client rates them equally. */
const CODINGS = ['gzip', 'deflate'] as const

export function prepareRepresentation(body: string, lastModified: Date): Representation {
  const identity = Buffer.from(body, 'utf8')
  return {
    identity,
    gzip: gzipSync(identity),
    deflate: deflateSync(identity),
    etag: `"${createHash('sha256').update(identity).digest('base64url').slice(0, 27)}"`,
    lastModified: new Date(Math.floor(lastModified.getTime() / 1000) * 1000),
  }
}

/** The best of gzip or deflate the Accept-Encoding header allows (q-values, `*`), else identity. */
export function negotiateEncoding(acceptEncoding: string | undefined): ContentCoding {
  const q = new Map<string, number>()
  for (const part of (acceptEncoding ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    if (!name) continue
    const qParam = params.map(p => p.trim()).find(p => p.startsWith('q='))
    const value = qParam ? Number(qParam.slice(2)) : 1
    q.set(name, Number.isFinite(value) ? value : 0)
  }
  let best: ContentCoding = 'identity'
  let bestQ = 0
  for (const coding of CODINGS) {
    const value = q.get(coding) ?? q.get('*') ?? 0
    if (value > bestQ) { best = coding; bestQ = value }
  }
  return best
}

const taggedFor = (etag: string, coding: ContentCoding) =>
  coding === 'identity' ? etag : `${etag.slice(0, -1)}-${coding}"`

/** Conditional GET: If-None-Match (weak comparison, any of our encodings' tags) wins over If-Modified-Since. */
function isNotModified(req: Request, rep: Representation): boolean {
  const ifNoneMatch = req.headers['if-none-match']
  if (ifNoneMatch) {
    const ours = new Set<string>(['identity', ...CODINGS].map(c => taggedFor(rep.etag, c as ContentCoding)))
    return ifNoneMatch.split(',').map(t => t.trim().replace(/^W\//, '')).some(t => t === '*' || ours.has(t))
  }
  const since = Date.parse(req.headers['if-modified-since'] ?? '')
  return Number.isFinite(since) && rep.lastModified.getTime() <= since
}

/** Send the representation (or a 304) with `headers` (Content-Type, Cache-Control) and the validators. */
export function sendRepresentation(req: Request, res: Response, rep: Representation, headers: Record<string, string>): void {
  const coding = negotiateEncoding(req.headers['accept-encoding'])
  res.set(headers)
  res.vary('Accept-Encoding')
  res.set('ETag', taggedFor(rep.etag, coding))
  res.set('Last-Modified', rep.lastModified.toUTCString())
  if (isNotModified(req, rep)) {
    res.status(304).end()
    return
  }
  const body = rep[coding]
  if (coding !== 'identity') res.set('Content-Encoding', coding)
  res.set('Content-Length', String(body.length))
  res.status(200).end(body)
}
