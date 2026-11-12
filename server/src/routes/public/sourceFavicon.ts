/**
 * `GET /api/source-favicons/:host`: a research source's stored favicon by host, a 32 px PNG
 * (services/sourceFavicons.ts), for the citations and sources list of a researched story page.
 * 404 for a host that is not a plain host name (never looked up) or that has none stored; the page
 * then shows the outlet's initial. Mounted before the shared rate limiter, like the feed favicons:
 * a researched story page asks for one per source. Not in the OpenAPI document, as the feed
 * favicon route is not.
 */
import { Router } from 'express'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { getSourceFavicon, isSourceHost } from '../../services/sourceFavicons.js'

const router = Router()

router.get('/:host', failsWith('Failed to load favicon'), async (req, res) => {
  const host = req.params.host!
  const favicon = isSourceHost(host) ? await getSourceFavicon(host) : null
  if (!favicon) {
    res.status(404).json({ error: 'Favicon not found' })
    return
  }
  res.set('Content-Type', 'image/png')
  res.set('Cache-Control', `public, max-age=${config.favicon.httpCacheSeconds}`)
  res.set('ETag', favicon.etag)
  // Helmet's default (same-origin) would stop the site, on another origin, showing it
  res.set('Cross-Origin-Resource-Policy', 'cross-origin')
  // send() answers 304 when If-None-Match carries this ETag
  res.send(favicon.png)
})

export default router
