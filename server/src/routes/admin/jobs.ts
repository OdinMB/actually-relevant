import { Router } from 'express'
import { createLogger } from '../../lib/logger.js'
import cron from 'node-cron'
import { runJob, reloadJob, isJobRunning } from '../../jobs/scheduler.js'
import { jobEnableRefusal } from '../../jobs/jobEnableChecks.js'
import { validateBody } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { updateJobSchema } from '../../schemas/job.js'
import { JOB_HANDLERS } from '../../jobs/handlers.js'
import { getJobs, updateJob } from '../../services/job.js'

const router = Router()
const log = createLogger('jobs')

router.get('/', failsWith('Failed to fetch jobs'), async (_req, res) => {
  res.json(await getJobs())
})

router.get('/server-time', (_req, res) => {
  res.json({
    time: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
})

router.put('/:jobName', failsWith('Failed to update job', { notFound: 'Job not found' }), validateBody(updateJobSchema), async (req, res) => {
  if (req.body.cronExpression && !cron.validate(req.body.cronExpression)) {
    res.status(400).json({ error: 'Invalid cron expression' })
    return
  }
  if (req.body.enabled === true) {
    const refusal = jobEnableRefusal(req.params.jobName)
    if (refusal) {
      res.status(422).json({ error: `Cannot enable ${req.params.jobName}: ${refusal}` })
      return
    }
  }

  const job = await updateJob(req.params.jobName, req.body)
  await reloadJob(req.params.jobName)
  res.json(job)
})

router.post('/:jobName/run', failsWith('Failed to trigger job'), async (req, res) => {
  const handler = JOB_HANDLERS[req.params.jobName]
  if (!handler) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  // In this process, or in another by a live job lease
  if (await isJobRunning(req.params.jobName)) {
    res.status(409).json({ error: `Job ${req.params.jobName} is already running` })
    return
  }

  // Run in background — don't block the response
  runJob(req.params.jobName, handler).catch(err => {
    log.error({ err, jobName: req.params.jobName }, 'manual job run failed')
  })

  res.json({ message: `Job ${req.params.jobName} triggered` })
})

export default router
