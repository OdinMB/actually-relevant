import { Router } from 'express'
import { createLogger } from '../../lib/logger.js'
import cron from 'node-cron'
import { runJob, reloadJob, isJobRunning } from '../../jobs/scheduler.js'
import { jobEnableRefusal } from '../../jobs/jobEnableChecks.js'
import { validateBody } from '../../middleware/validate.js'
import { failsWith } from '../../middleware/routeErrors.js'
import { updateJobSchema } from '../../schemas/job.js'
import { JOB_HANDLERS } from '../../jobs/handlers.js'
import { chainContinueStep, getJobs, updateJob } from '../../services/job.js'
import { chainOf, isChain } from '../../jobs/chainDefinitions.js'
import { runChain } from '../../jobs/chains.js'

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
  const jobName = req.params.jobName!
  // A step runs when its chain reaches it, so it has no schedule; only a step pauses for review;
  // only a chain has a flex cut-off and a deadline (jobs/chains.ts)
  const misplaced =
    (req.body.cronExpression !== undefined && chainOf(jobName) && 'a step of a chain runs when its chain reaches it and has no schedule of its own') ||
    (req.body.pauseForReview !== undefined && !chainOf(jobName) && 'only a step of a chain can wait for review') ||
    (req.body.notBefore !== undefined && !chainOf(jobName) && 'only a step of a chain can be held until a time') ||
    ((req.body.flexUntil !== undefined || req.body.deadline !== undefined) && !isChain(jobName) && 'only a chain has a flex cut-off and a deadline')
  if (misplaced) {
    res.status(400).json({ error: `Cannot change ${jobName}: ${misplaced}` })
    return
  }
  if (req.body.enabled === true) {
    const refusal = jobEnableRefusal(jobName)
    if (refusal) {
      res.status(422).json({ error: `Cannot enable ${req.params.jobName!}: ${refusal}` })
      return
    }
  }

  const job = await updateJob(req.params.jobName!, req.body)
  await reloadJob(req.params.jobName!)
  res.json(job)
})

router.post('/:jobName/run', failsWith('Failed to trigger job'), async (req, res) => {
  const handler = JOB_HANDLERS[req.params.jobName!]
  if (!handler) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  // In this process, or in another by a live job lease
  if (await isJobRunning(req.params.jobName!)) {
    res.status(409).json({ error: `Job ${req.params.jobName!} is already running` })
    return
  }

  // Run in background — don't block the response
  runJob(req.params.jobName!, handler).catch(err => {
    log.error({ err, jobName: req.params.jobName! }, 'manual job run failed')
  })

  res.json({ message: `Job ${req.params.jobName!} triggered` })
})

// A chain waiting for review, or stopped at a failed step, goes on from that step (jobs/chains.ts)
router.post('/:jobName/continue', failsWith('Failed to continue chain', { notFound: 'Job not found' }), async (req, res) => {
  const jobName = req.params.jobName!
  if (!isChain(jobName)) {
    res.status(404).json({ error: 'Chain not found' })
    return
  }
  if (await isJobRunning(jobName)) {
    res.status(409).json({ error: `Chain ${jobName} is already running` })
    return
  }
  const from = await chainContinueStep(jobName)
  if (!from) {
    res.status(400).json({ error: `Chain ${jobName} is not waiting for review or stopped at a step` })
    return
  }

  runJob(jobName, () => runChain(jobName, 'continue')).catch(err => {
    log.error({ err, jobName }, 'chain continue failed')
  })

  res.json({ message: `Chain ${jobName} continues from ${from}` })
})

export default router
