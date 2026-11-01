import { Router } from 'express'
import { getHomepage } from '../../services/homepage.js'
import { failsWith } from '../../middleware/routeErrors.js'

const router = Router()

router.get('/', failsWith('Failed to fetch homepage data'), async (_req, res) => {
  const data = await getHomepage()
  res.set('Cache-Control', 'public, max-age=60')
  res.json(data)
})

export default router
