import { createHmac } from 'crypto'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('feedback-ip-hash')

if (!config.feedback.ipHashSecret) {
  log.error('FEEDBACK_IP_HASH_SECRET is not set: feedback submissions will be refused')
}

/**
 * The hash stored with a feedback submission to spot repeated abuse (ADR-0037):
 * HMAC-SHA256 of the visitor's IP under FEEDBACK_IP_HASH_SECRET. An unkeyed hash of
 * an IPv4 address is reversed by hashing all 2^32 addresses, so without the secret
 * this returns null and the caller must refuse the submission (fail closed, in every
 * environment). The secret is read at call time.
 */
export function hashFeedbackIp(ip: string): string | null {
  const secret = config.feedback.ipHashSecret
  if (!secret) return null
  return createHmac('sha256', secret).update(ip).digest('hex')
}
