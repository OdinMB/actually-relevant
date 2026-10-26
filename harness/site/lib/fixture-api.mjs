/**
 * The fixture API: answers the /api routes the public pages call with the invented fixtures, the
 * way server/src/routes/public/ answers them (status codes, error bodies, the forms' bot gate).
 * `handleApiRequest` is pure; `startFixtureServer` serves it on 127.0.0.1 at a port it picks.
 */
import http from 'node:http'
import { topLevelSlug } from './fixtures.mjs'

const CHECK_EMAIL_MESSAGE = 'Check your email to confirm your subscription.'
const FEEDBACK_CATEGORIES = ['general', 'bug', 'suggestion', 'other', 'correction']
const DEFAULT_PAGE_SIZE = 25
const MAX_BODY_BYTES = 64 * 1024

/** A failure or delay spec (`--fail`, `--delay`) matches a path exactly, or as a prefix ending in `*`. */
export function specMatches(specPath, requestPath) {
  return specPath.endsWith('*') ? requestPath.startsWith(specPath.slice(0, -1)) : requestPath === specPath
}

function json(status, body) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body), handled: true }
}

function notFound(error) {
  return json(404, { error })
}

function paginate(items, page, pageSize) {
  const total = items.length
  return {
    data: items.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

function wholeNumber(value, fallback, max) {
  if (value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) return null
  return max ? Math.min(n, max) : n
}

function isPlausibleEmail(value) {
  return typeof value === 'string' && value.trim().length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function validationFailed(field, message) {
  return json(400, { error: 'Validation failed', details: { formErrors: [], fieldErrors: { [field]: [message] } } })
}

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
}

function rss(title, link, items) {
  const body = items
    .map(item => `<item><title>${escapeXml(item.title)}</title><link>${escapeXml(item.link)}</link><guid>${escapeXml(item.link)}</guid></item>`)
    .join('')
  return {
    status: 200,
    contentType: 'application/rss+xml; charset=utf-8',
    body: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link><description>Invented items served by the site harness.</description>${body}</channel></rss>`,
    handled: true,
  }
}

/** Two seconds of 8 kHz 8-bit silence: a playable stand-in for an episode's audio. */
export function silentWav(seconds = 2, rate = 8000) {
  const dataSize = seconds * rate
  const buf = Buffer.alloc(44 + dataSize, 0x80)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28) // bytes per second
  buf.writeUInt16LE(1, 32) // block align
  buf.writeUInt16LE(8, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

const ARTWORK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#661845"/><text x="300" y="320" font-family="sans-serif" font-size="56" fill="#fff" text-anchor="middle">Fixture artwork</text></svg>'

/**
 * Answers one request from the fixtures. `failures` and `delays` come from `--fail` and `--delay`.
 * Returns { status, contentType, body, handled } or { drop: true }, plus `delayMs` and `injected`.
 */
export function handleApiRequest(state, { method, path, query, body }) {
  const delay = state.delays.find(spec => specMatches(spec.path, path))
  const failure = state.failures.find(spec => specMatches(spec.path, path))
  const delayMs = delay ? delay.ms : 0
  if (failure) {
    if (failure.status === 'drop') return { drop: true, delayMs, injected: true, handled: true }
    const errorBody = { error: `Fixture failure (${failure.status})`, ...(failure.code ? { code: failure.code } : {}) }
    return { ...json(failure.status, errorBody), delayMs, injected: true }
  }
  return { ...route(state, method, path, query, body), delayMs, injected: false }
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function route(state, method, path, query, body) {
  const { fixtures, apiOrigin } = state
  const segments = path.split('/').filter(Boolean).map(safeDecode)

  if (path.startsWith('/fixture-media/') && method === 'GET') {
    if (path === '/fixture-media/artwork.svg') return { status: 200, contentType: 'image/svg+xml', body: ARTWORK_SVG, handled: true }
    if (/^\/fixture-media\/episode-\d+\.wav$/.test(path)) return { status: 200, contentType: 'audio/wav', body: silentWav(), handled: true }
  }
  if (segments[0] !== 'api') return { ...notFound('Not found'), handled: false }
  const [, area, id, sub] = segments

  if (method === 'POST') {
    if (area === 'subscribe' && id === undefined) return subscribe(state, body)
    if (area === 'subscribe' && id === 'confirm' && sub === undefined) return confirmSubscription(body)
    if (area === 'feedback' && id === undefined) return feedback(state, body)
    if (area === 'auth' && id === 'refresh') return json(401, { error: 'Unauthorized' })
    return { ...notFound('Not found'), handled: false }
  }
  if (method !== 'GET' && method !== 'HEAD') return { ...json(405, { error: 'Method not allowed' }), handled: false }

  switch (area) {
    case 'homepage':
      if (id === undefined) return json(200, fixtures.homepage)
      break
    case 'issues':
      if (id === undefined) return json(200, fixtures.issues)
      if (sub === undefined) return issueBySlug(fixtures, id)
      break
    case 'stories':
      if (id === undefined) return storyList(fixtures, query)
      if (sub === undefined) {
        const story = fixtures.stories.find(s => s.slug === id)
        return story ? json(200, story) : notFound('Story not found')
      }
      if (sub === 'related') return relatedStories(fixtures, id, query)
      if (sub === 'cluster') return clusterMembers(fixtures, id)
      break
    case 'sources':
      if (id === undefined) return json(200, fixtures.sources)
      break
    case 'podcast':
      if (id === undefined) return json(200, fixtures.podcast)
      if (id === 'feed.xml' && sub === undefined) {
        return rss(
          'Actually Relevant (fixture podcast)',
          `${apiOrigin}/api/podcast/feed.xml`,
          fixtures.episodes.map(e => ({ title: e.title, link: e.audioUrl })),
        )
      }
      if (id === 'episodes' && sub !== undefined && segments.length === 4) {
        const episode = fixtures.episodes.find(e => e.id === sub)
        return episode ? json(200, episode) : notFound('Episode not found')
      }
      break
    case 'newsletters':
      if (id === undefined) return newsletterArchive(fixtures, query)
      if (id === 'feed.xml' && sub === undefined) {
        return rss(
          'Actually Relevant (fixture newsletter)',
          `${apiOrigin}/api/newsletters/feed.xml`,
          fixtures.newsletterSummaries.map(n => ({ title: n.title, link: `${apiOrigin}/api/newsletters/${n.slug}` })),
        )
      }
      if (sub === undefined) {
        const issue = fixtures.newsletters.find(n => n.slug === id)
        return issue ? json(200, issue) : notFound('Issue not found')
      }
      break
    case 'feed':
      if (sub === undefined) {
        const items = fixtures.stories.filter(s => id === undefined || topLevelSlug(s.issue?.slug ?? '') === id)
        return rss(
          'Actually Relevant (fixture feed)',
          `${apiOrigin}/api/feed${id ? `/${id}` : ''}`,
          items.map(s => ({ title: s.title, link: s.sourceUrl })),
        )
      }
      break
    case 'docs':
      if (id === 'openapi.json' && sub === undefined) return json(200, openApiSpec())
      break
    case 'subscribe':
      if (id === 'token' && sub === undefined) return json(200, { token: `fixture-subscribe-token-${++state.tokens}` })
      break
    case 'feedback':
      if (id === 'token' && sub === undefined) return json(200, { token: `fixture-feedback-token-${++state.tokens}` })
      break
  }
  return { ...notFound('Not found'), handled: false }
}

function issueBySlug(fixtures, slug) {
  const top = fixtures.issues.find(i => i.slug === slug)
  if (top) return json(200, { ...top, parent: null })
  for (const parent of fixtures.issues) {
    const child = (parent.children ?? []).find(c => c.slug === slug)
    if (child) return json(200, { ...child, children: [], parent: { id: parent.id, name: parent.name, slug: parent.slug } })
  }
  return notFound('Issue not found')
}

function storyList(fixtures, query) {
  const page = wholeNumber(query.get('page'), 1)
  const pageSize = wholeNumber(query.get('pageSize'), DEFAULT_PAGE_SIZE, 100)
  if (page === null || pageSize === null) return json(400, { error: 'Invalid query parameters' })
  const issueSlug = query.get('issueSlug')
  const search = (query.get('search') ?? '').trim().toLowerCase()
  const tags = (query.get('emotionTags') ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  const stories = fixtures.stories.filter(story => {
    if (issueSlug && story.issue?.slug !== issueSlug && topLevelSlug(story.issue?.slug ?? '') !== issueSlug) return false
    if (tags.length > 0 && !tags.includes(story.emotionTag)) return false
    if (search && ![story.title, story.titleLabel, story.summary, story.sourceTitle].some(text => (text ?? '').toLowerCase().includes(search))) return false
    return true
  })
  return json(200, paginate(stories, page, pageSize))
}

function relatedStories(fixtures, slug, query) {
  const story = fixtures.stories.find(s => s.slug === slug)
  if (!story) return json(200, [])
  const limit = wholeNumber(query.get('limit'), 4, 20) ?? 4
  const issue = topLevelSlug(story.issue?.slug ?? '')
  return json(200, fixtures.stories.filter(s => s.slug !== slug && topLevelSlug(s.issue?.slug ?? '') === issue).slice(0, limit))
}

/** The newest story is reported by two more invented publishers, so "Also covered by" shows. */
function clusterMembers(fixtures, slug) {
  if (fixtures.stories[0]?.slug !== slug) return json(200, { sources: [] })
  return json(200, {
    sources: [
      { feedTitle: 'Coastline Times', sourceUrl: `https://example.net/fixture/${slug}` },
      { feedTitle: 'Civic Monitor', sourceUrl: `https://example.com/fixture/${slug}` },
    ],
  })
}

function newsletterArchive(fixtures, query) {
  const page = wholeNumber(query.get('page'), 1)
  const pageSize = wholeNumber(query.get('pageSize'), 20, 50)
  if (page === null || pageSize === null) return json(400, { error: 'Invalid query parameters' })
  return json(200, paginate(fixtures.newsletterSummaries, page, pageSize))
}

/** As server/src/routes/public/subscribe.ts: honeypot and form token gates answer success silently. */
function subscribe(state, body) {
  if (!body || typeof body !== 'object') return validationFailed('email', 'Required')
  if (!isPlausibleEmail(body.email)) return validationFailed('email', 'Invalid email address')
  if (body.website) return json(200, { success: true, message: CHECK_EMAIL_MESSAGE })
  if (typeof body.formToken !== 'string' || !body.formToken.startsWith('fixture-subscribe-token-')) {
    return json(200, { success: true, message: CHECK_EMAIL_MESSAGE })
  }
  state.signups++
  return json(200, { success: true, message: CHECK_EMAIL_MESSAGE })
}

function confirmSubscription(body) {
  if (!body || typeof body.token !== 'string' || body.token.length === 0 || !isPlausibleEmail(body.email)) {
    return validationFailed('token', 'Required')
  }
  return json(200, { success: true })
}

/** As server/src/routes/public/feedback.ts, storing nothing. */
function feedback(state, body) {
  if (!body || typeof body !== 'object') return validationFailed('message', 'Required')
  if (!FEEDBACK_CATEGORIES.includes(body.category)) return validationFailed('category', 'Invalid enum value')
  if (typeof body.message !== 'string' || body.message.length === 0) return validationFailed('message', 'Required')
  if (body.email !== undefined && body.email !== '' && !isPlausibleEmail(body.email)) return validationFailed('email', 'Invalid email')
  if (body.website) return json(200, { success: true })
  if (typeof body.formToken !== 'string' || !body.formToken.startsWith('fixture-feedback-token-')) return json(200, { success: true })
  if (body.storyId !== undefined && !state.fixtures.stories.some(s => s.id === body.storyId)) {
    return json(400, { error: 'That story does not exist.' })
  }
  state.feedback++
  return json(200, { success: true })
}

function openApiSpec() {
  return {
    openapi: '3.1.0',
    info: { title: 'Actually Relevant API (fixture)', version: '0.0.0', description: 'A minimal, invented spec served by the site harness.' },
    paths: {
      '/api/stories': {
        get: {
          summary: 'Published stories',
          parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: { description: 'A page of stories' } },
        },
      },
    },
  }
}

/** The per-run state of the fixture API. */
export function createApiState({ fixtures, apiOrigin, failures = [], delays = [] }) {
  return { fixtures, apiOrigin, failures, delays, tokens: 0, signups: 0, feedback: 0 }
}

/** CORS headers for a request from `origin`: only the site server the harness started is allowed. */
export function corsHeaders(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0 || size > MAX_BODY_BYTES) return resolve(undefined)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

/**
 * Serves the fixture API on 127.0.0.1 at a port the OS picks. `allowedOrigins()` names the
 * origins CORS lets in (the site server, once it listens). The fixtures need the API's own origin
 * (media and feed URLs), so the run fills `state.fixtures` once this listens; until then every
 * request answers 503. Each request is logged by method, path and status only: request bodies
 * are never kept.
 */
export function startFixtureServer({ state, allowedOrigins, log }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const cors = corsHeaders(req.headers.origin, allowedOrigins())
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }
    if (!state.fixtures) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', ...cors })
      res.end('The fixture API is not ready.')
      return
    }
    const body = req.method === 'POST' ? await readBody(req) : undefined
    const answer = handleApiRequest(state, { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body })
    if (answer.delayMs > 0) await new Promise(resolve => setTimeout(resolve, answer.delayMs))
    log.push({ method: req.method, path: url.pathname, status: answer.drop ? 'dropped' : answer.status, handled: answer.handled, injected: answer.injected })
    if (answer.drop) {
      req.socket.destroy()
      return
    }
    res.writeHead(answer.status, { 'Content-Type': answer.contentType, 'Cache-Control': 'no-store', ...cors })
    res.end(req.method === 'HEAD' ? undefined : answer.body)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () =>
          new Promise(done => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}
