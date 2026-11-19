import { Router } from 'express'
import { failsWith } from '../../middleware/routeErrors.js'
import { publicOverview, publicOverviewList } from '../../services/overviewPublic.js'

/*
 * Ongoing-story overviews for readers (.context/overviews.md, "Public"); not in the OpenAPI contract
 * while later modules may still change the shape, as the story's `/context` is not. The index says
 * whether the module is switched on (the site's "Ongoing" links show only then) and lists the public
 * overviews; an overview that is not public, or any while the module is off, is a 404.
 */
const router = Router()

router.get('/', failsWith('Failed to fetch ongoing stories'), async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json(await publicOverviewList())
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
