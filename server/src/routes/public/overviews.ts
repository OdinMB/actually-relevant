import { Router } from 'express'
import { z } from 'zod'
import { config } from '../../config.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { validateQuery } from '../../middleware/validate.js'
import { publicOverview, servedOverviewList } from '../../services/overviewPublic.js'

/*
 * Ongoing-story overviews for readers (.context/overviews.md, "Public"); not in the OpenAPI contract
 * while later modules may still change the shape, as the story's `/context` is not. The index says
 * whether the module is switched on (the site's "Ongoing" links show only then) and lists the public
 * overviews, from memory (`servedOverviewList`); `?limit=0` answers only whether it is on, the
 * layout's question on every visitor's first page view. An overview that is not public, or any while
 * the module is off, is a 404.
 */
const router = Router()

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(0).max(100).optional() })

router.get('/', failsWith('Failed to fetch ongoing stories'), validateQuery(listQuerySchema), async (req, res) => {
  const { limit }: z.infer<typeof listQuerySchema> = req.parsedQuery!
  res.set('Cache-Control', `public, max-age=${config.overviews.listCacheSeconds}`)
  res.json(await servedOverviewList(limit))
})

router.get('/:slug', failsWith('Failed to fetch the ongoing story'), async (req, res) => {
  const overview = await publicOverview(req.params.slug!)
  res.set('Cache-Control', 'public, max-age=60')
  if (!overview) {
    res.status(404).json({ error: 'Ongoing story not found' })
    return
  }
  res.json(overview)
})

export default router
