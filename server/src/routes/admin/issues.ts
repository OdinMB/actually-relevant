import { Router } from 'express'
import * as issueService from '../../services/issue.js'
import { validateBody } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { createIssueSchema, updateIssueSchema } from '../../schemas/issue.js'

// Errors: the issue service throws BadRequestError for a parent rule (400) and ConflictError for a
// delete that feeds or child issues block (409); the global handler in app.ts answers them.
const router = Router()
const issueErrors = { notFound: 'Issue not found', duplicate: 'An issue with this slug already exists' }

router.get('/', failsWith('Failed to fetch issues'), async (_req, res) => {
  res.json(await issueService.getAllIssues())
})

router.get('/:id', failsWith('Failed to fetch issue'), async (req, res) => {
  const issue = await issueService.getIssueById(req.params.id)
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }
  res.json(issue)
})

router.post('/', failsWith('Failed to create issue', issueErrors), validateBody(createIssueSchema), async (req, res) => {
  res.status(201).json(await issueService.createIssue(req.body))
})

router.put('/:id', failsWith('Failed to update issue', issueErrors), validateBody(updateIssueSchema), async (req, res) => {
  res.json(await issueService.updateIssue(req.params.id, req.body))
})

router.delete('/:id', failsWith('Failed to delete issue', issueErrors), async (req, res) => {
  await issueService.deleteIssue(req.params.id)
  res.status(204).send()
})

export default router
