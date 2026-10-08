import { randomUUID } from 'crypto'
import axios from 'axios'
import { config } from '../config.js'
import { withRetry, isRetryableError } from './retry.js'
import { createLogger } from './logger.js'

const log = createLogger('turnstile')

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

if (!config.subscribe.turnstileSecretKey) {
  if (process.env.NODE_ENV === 'production') {
    log.error('TURNSTILE_SECRET_KEY is not set: newsletter signups will be refused')
  } else {
    log.warn('TURNSTILE_SECRET_KEY is not set: the Turnstile check is skipped outside production')
  }
}

/**
 * `ok`: a person passed the check (or the check is skipped outside production).
 * `failed`: Cloudflare rejected the token, or there was none.
 * `unavailable`: the check could not run; the signup must be refused (fail closed).
 */
export type TurnstileResult = 'ok' | 'failed' | 'unavailable'

interface SiteverifyResponse {
  success: boolean
  'error-codes'?: string[]
}

/**
 * Verify a Cloudflare Turnstile token with siteverify. One idempotency key is sent
 * with every attempt, so a retry after Cloudflare already saw the token gets the
 * first answer again instead of `timeout-or-duplicate`.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | undefined,
): Promise<TurnstileResult> {
  const secret = config.subscribe.turnstileSecretKey
  if (!secret) return process.env.NODE_ENV === 'production' ? 'unavailable' : 'ok'
  if (!token) return 'failed'

  const idempotencyKey = randomUUID()
  try {
    const data = await withRetry(
      async () => {
        const res = await axios.post<SiteverifyResponse>(
          SITEVERIFY_URL,
          { secret, response: token, remoteip: remoteIp, idempotency_key: idempotencyKey },
          { timeout: 5000 },
        )
        return res.data
      },
      { retries: 2, retryOn: isRetryableError },
    )
    if (data.success) return 'ok'
    log.info({ errorCodes: data['error-codes'] }, 'turnstile check failed')
    return 'failed'
  } catch (err) {
    log.error({ err }, 'turnstile siteverify unavailable')
    return 'unavailable'
  }
}
