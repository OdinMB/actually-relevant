import axios from 'axios'
import { createLogger } from './logger.js'

const log = createLogger('notify')

/**
 * Whether failures and notices reach anyone outside the admin. Without WEBHOOK_URL they are only
 * visible on the Jobs and Podcasts pages; nothing requires one.
 */
export function hasAlertChannel(): boolean {
  return Boolean(process.env.WEBHOOK_URL)
}

/** Post to WEBHOOK_URL; silent without it, and a failed post is logged, never thrown. */
async function postWebhook(payload: Record<string, unknown>, context: Record<string, unknown>): Promise<void> {
  const url = process.env.WEBHOOK_URL
  if (!url) return

  try {
    await axios.post(url, { ...payload, timestamp: new Date().toISOString() }, { timeout: 5000, maxContentLength: 1 * 1024 * 1024 })
  } catch (err) {
    log.warn({ err, ...context }, 'failed to send webhook notification')
  }
}

export async function notifyJobFailure(jobName: string, error: string): Promise<void> {
  await postWebhook({
    content: `Job **${jobName}** failed: ${error}`,
    text: `Job "${jobName}" failed: ${error}`,
    jobName,
    error,
  }, { jobName })
}

/** A notice that something happened (not a failure), through the same webhook. */
export async function notifyEvent(title: string, message: string): Promise<void> {
  await postWebhook({
    content: `**${title}**\n${message}`,
    text: `${title}\n${message}`,
    title,
    message,
  }, { title })
}
