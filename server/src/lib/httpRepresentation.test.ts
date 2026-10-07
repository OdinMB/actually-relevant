import { describe, it, expect } from 'vitest'
import { gunzipSync, inflateSync } from 'node:zlib'
import http, { type IncomingHttpHeaders } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import express from 'express'
import request from 'supertest'
import { negotiateEncoding, prepareRepresentation, sendRepresentation } from './httpRepresentation.js'

const BODY = '<rss>' + 'relevant '.repeat(200) + '</rss>'
const MODIFIED = new Date('2026-10-12T07:30:00.750Z')

function app(body = BODY) {
  const rep = prepareRepresentation(body, MODIFIED)
  return { rep, server: express().get('/f', (req, res) => sendRepresentation(req, res, rep, { 'Content-Type': 'application/rss+xml' })) }
}

interface RawResponse { status: number; headers: IncomingHttpHeaders; body: Buffer }

/** Raw request through node's client (supertest decompresses): headers and bytes as the server sent them. */
async function raw(server: express.Express, headers: Record<string, string> = {}): Promise<RawResponse> {
  const listener = server.listen(0)
  await once(listener, 'listening')
  try {
    const { port } = listener.address() as AddressInfo
    return await new Promise<RawResponse>((resolve, reject) => {
      http.get({ port, path: '/f', headers }, res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
  } finally {
    listener.close()
  }
}

describe('negotiateEncoding', () => {
  it('prefers gzip, then deflate, and falls back to identity', () => {
    expect(negotiateEncoding('gzip, deflate, br')).toBe('gzip')
    expect(negotiateEncoding('deflate')).toBe('deflate')
    expect(negotiateEncoding('br')).toBe('identity')
    expect(negotiateEncoding(undefined)).toBe('identity')
    expect(negotiateEncoding('')).toBe('identity')
  })

  it('honors q-values, q=0 refusals and the wildcard', () => {
    expect(negotiateEncoding('gzip;q=0.2, deflate;q=0.8')).toBe('deflate')
    expect(negotiateEncoding('gzip;q=0, deflate;q=0')).toBe('identity')
    expect(negotiateEncoding('*')).toBe('gzip')
    expect(negotiateEncoding('*;q=0.5, gzip;q=0')).toBe('deflate')
    expect(negotiateEncoding('GZIP')).toBe('gzip')
  })
})

describe('prepareRepresentation', () => {
  it('gives a strong ETag that follows the body and a Last-Modified in whole seconds', () => {
    const a = prepareRepresentation(BODY, MODIFIED)
    expect(a.etag).toMatch(/^"[^"]+"$/)
    expect(prepareRepresentation(BODY, MODIFIED).etag).toBe(a.etag)
    expect(prepareRepresentation(BODY + ' ', MODIFIED).etag).not.toBe(a.etag)
    expect(a.lastModified.toISOString()).toBe('2026-10-12T07:30:00.000Z')
  })
})

describe('sendRepresentation', () => {
  it('sends gzip with its length, a per-encoding ETag and the validators', async () => {
    const { rep, server } = app()
    const res = await raw(server, { 'Accept-Encoding': 'gzip' })
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['vary']).toMatch(/Accept-Encoding/)
    expect(Number(res.headers['content-length'])).toBe(res.body.length)
    expect(res.body.length).toBeLessThan(Buffer.byteLength(BODY))
    expect(gunzipSync(res.body).toString('utf8')).toBe(BODY)
    expect(res.headers['etag']).toMatch(/^"[^"]+"$/)
    expect(res.headers['etag']).not.toBe(rep.etag)
    expect(res.headers['last-modified']).toBe('Mon, 12 Oct 2026 07:30:00 GMT')
    expect(res.headers['content-type']).toBe('application/rss+xml')
  })

  it('sends deflate or the plain body as the client accepts', async () => {
    const { rep, server } = app()
    const deflated = await raw(server, { 'Accept-Encoding': 'deflate' })
    expect(deflated.headers['content-encoding']).toBe('deflate')
    expect(inflateSync(deflated.body).toString('utf8')).toBe(BODY)
    const plain = await raw(server, { 'Accept-Encoding': 'identity' })
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.headers['etag']).toBe(rep.etag)
    expect(Number(plain.headers['content-length'])).toBe(Buffer.byteLength(BODY))
    expect(plain.body.toString('utf8')).toBe(BODY)
  })

  it('answers 304 to a matching If-None-Match, whatever encoding the tag was for, weak or strong', async () => {
    const { rep, server } = app()
    const gzTag = (await raw(server, { 'Accept-Encoding': 'gzip' })).headers['etag'] ?? ''
    for (const tag of [rep.etag, gzTag, `W/${gzTag}`, `"other", ${rep.etag}`, '*']) {
      const res = await raw(server, { 'Accept-Encoding': 'gzip', 'If-None-Match': tag })
      expect(res.status, tag).toBe(304)
      expect(res.body.length).toBe(0)
      expect(res.headers['etag']).toBe(gzTag)
    }
    expect((await raw(server, { 'If-None-Match': '"other"' })).status).toBe(200)
  })

  it('answers 304 to If-Modified-Since at or after Last-Modified, and 200 before it', async () => {
    const { server } = app()
    expect((await raw(server, { 'If-Modified-Since': 'Mon, 12 Oct 2026 07:30:00 GMT' })).status).toBe(304)
    expect((await raw(server, { 'If-Modified-Since': 'Tue, 13 Oct 2026 00:00:00 GMT' })).status).toBe(304)
    expect((await raw(server, { 'If-Modified-Since': 'Mon, 12 Oct 2026 07:29:59 GMT' })).status).toBe(200)
    expect((await raw(server, { 'If-Modified-Since': 'not a date' })).status).toBe(200)
  })

  it('lets If-None-Match decide over If-Modified-Since', async () => {
    const { server } = app()
    const res = await raw(server, { 'If-None-Match': '"stale"', 'If-Modified-Since': 'Tue, 13 Oct 2026 00:00:00 GMT' })
    expect(res.status).toBe(200)
  })

  it('answers HEAD with the headers and no body', async () => {
    const { server } = app()
    const res = await request(server).head('/f').set('Accept-Encoding', 'gzip')
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0)
  })
})
