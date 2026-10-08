import { Router } from 'express'
import { createLogger } from '../../lib/logger.js'
import cron from 'node-cron'
import { runJob, reloadJob, isJobRunning } from '../../jobs/scheduler.js'
import { jobEnableRefusal } from '../../jobs/jobEnableChecks.js'
import { validateBody } from '../../middleware/validate.js'
import { updateJobSchema } from '../../schemas/job.js'
import { JOB_HANDLERS } from '../../jobs/handlers.js'
import { getJobs, updateJob } from '../../services/job.js'

const router = Router()
const log = createLogger('jobs')

router.get('/', async (_req, res) => {
  try {
    const jobs = await getJobs()
    res.json(jobs)
  } catch (err) {
    log.error({ err }, 'failed to fetch jobs')
    res.status(500).json({ error: 'Failed to fetch jobs' })
  }
})

router.get('/server-time', (_req, res) => {
  res.json({
    time: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
})

router.put('/:jobName', validateBody(updateJobSchema), async (req, res) => {
  try {
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
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    log.error({ err }, 'failed to update job')
    res.status(500).json({ error: 'Failed to update job' })
  }
})

router.post('/:jobName/run', async (req, res) => {
  const handler = JOB_HANDLERS[req.params.jobName]
  if (!handler) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  try {
    // In this process, or in another by a live job lease
    if (await isJobRunning(req.params.jobName)) {
      res.status(409).json({ error: `Job ${req.params.jobName} is already running` })
      return
    }
  } catch (err) {
    log.error({ err, jobName: req.params.jobName }, 'failed to check whether the job is running')
    res.status(500).json({ error: 'Failed to trigger job' })
    return
  }

  // Run in background — don't block the response
  runJob(req.params.jobName, handler).catch(err => {
    log.error({ err, jobName: req.params.jobName }, 'manual job run failed')
  })

  res.json({ message: `Job ${req.params.jobName} triggered` })
})

export default router
