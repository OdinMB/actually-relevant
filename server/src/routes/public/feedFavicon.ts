/**
 * `GET /api/feeds/:id/favicon`: a feed's stored favicon, a 32 px PNG (.context/feed-management.md,
 * "Favicons"), for story cards and pages on the site and the newsletter email. 404 when none is
 * stored; the site then falls back to the files committed under client/public/images/feeds/.
 * Mounted before the shared rate limiter: a page of story cards asks for one per feed shown.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { getFavicon } from '../../services/faviconStore.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const router = Router()

router.get('/:id/favicon', failsWith('Failed to load favicon'), async (req, res) => {
  const id = req.params.id!
  const favicon = UUID_RE.test(id) ? await getFavicon(id) : null
  if (!favicon) {
    res.status(404).json({ error: 'Favicon not found' })
    return
  }
  res.set('Content-Type', 'image/png')
  res.set('Cache-Control', `public, max-age=${config.favicon.httpCacheSeconds}`)
  res.set('ETag', favicon.etag)
  // Helmet's default (same-origin) would stop the site, on another origin, and mail clients showing it
  res.set('Cross-Origin-Resource-Policy', 'cross-origin')
  // send() answers 304 when If-None-Match carries this ETag
  res.send(favicon.png)
})

export default router
