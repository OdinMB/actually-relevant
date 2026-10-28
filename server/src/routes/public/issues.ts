import { Router } from 'express'
import * as issueService from '../../services/issue.js'
import { TTLCache, cached } from '../../lib/cache.js'
import { registerPublicCache } from '../../lib/publicCaches.js'
import { failsWith } from '../../middleware/routeErrors.js'

const router = Router()

const ISSUES_TTL = 5 * 60 * 1000 // 5 minutes
const issuesCache = new TTLCache<unknown>(ISSUES_TTL)
registerPublicCache('issues', issuesCache)

router.get('/', failsWith('Failed to fetch issues'), async (_req, res) => {
  const issues = await cached(issuesCache, 'public-issues', () => issueService.getPublicIssues())
  res.set('Cache-Control', 'public, max-age=300')
  res.json(issues)
})

router.get('/:slug', failsWith('Failed to fetch issue'), async (req, res) => {
  const issue = await issueService.getPublicIssueBySlug(req.params.slug!)
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }
  res.set('Cache-Control', 'public, max-age=300')
  res.json(issue)
})

export default router
