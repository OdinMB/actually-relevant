import { Router } from 'express'
import { clearPublicCaches } from '../../lib/publicCaches.js'

const router = Router()

// Empty the server's public caches so visitors' next requests read the database (.context/admin-dashboard.md)
router.post('/clear', (_req, res) => {
  const caches = clearPublicCaches()
  res.json({ caches, entries: caches.reduce((sum, c) => sum + c.entries, 0) })
})

export default router
