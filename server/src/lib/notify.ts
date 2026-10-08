import axios from 'axios'
import { config } from '../config.js'
import { createLogger } from './logger.js'
import { recordNotice, type NoticeInput, type NoticeSource, type RecordOptions } from '../services/adminNotices.js'

const log = createLogger('notify')

/**
 * The one entry point for owner alerts (ADR-0028): record the notice in the admin, then forward it
 * to WEBHOOK_URL when one is set. The steps fail independently and neither throws, so an alert sent
 * while the database is down still reaches the webhook.
 */
export async function notify(input: NoticeInput, options: RecordOptions = {}): Promise<void> {
  let forward = true
  try {
    // An insert-only repeat that was skipped is no new event, so it is not forwarded again.
    forward = await recordNotice(input, options)
  } catch (err) {
    log.error({ err, source: input.source, title: input.title }, 'failed to record admin notice')
  }
  if (forward) await postWebhook(input)
}

/** Post to WEBHOOK_URL; silent without it, and a failed post is logged, never thrown. */
async function postWebhook(input: NoticeInput): Promise<void> {
  const url = process.env.WEBHOOK_URL
  if (!url) return

  const open = input.link ? `\nOpen: ${config.clientUrl}${input.link}` : ''
  const payload = {
    content: `**${input.title}**\n${input.message}${open}`,
    text: `${input.title}\n${input.message}${open}`,
    title: input.title,
    message: input.message,
    source: input.source,
    severity: input.severity,
    timestamp: new Date().toISOString(),
  }
  try {
    await axios.post(url, payload, { timeout: 5000, maxContentLength: 1 * 1024 * 1024 })
  } catch (err) {
    log.warn({ err, source: input.source, title: input.title }, 'failed to send webhook notification')
  }
}

/** Jobs whose failures are filed under their product rather than under Jobs, with that product's admin page. */
const JOB_FAILURE_HOMES: Record<string, { source: NoticeSource; link: string }> = {
  generate_newsletter: { source: 'newsletter', link: '/admin/newsletters' },
  generate_podcast: { source: 'podcast', link: '/admin/podcasts' },
  publish_podcast: { source: 'podcast', link: '/admin/podcasts' },
}

/** The notice for a failed job run: one row per job, reopened by each new failure. */
export function jobFailureNotice(jobName: string, error: string): NoticeInput {
  const home = JOB_FAILURE_HOMES[jobName] ?? { source: 'jobs', link: '/admin/jobs' }
  return {
    source: home.source,
    severity: 'warning',
    title: `Job ${jobName} failed`,
    message: error,
    link: home.link,
    dedupeKey: `job-failure:${jobName}`,
  }
}
