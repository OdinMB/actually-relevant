import { createLogger } from './logger.js'

const log = createLogger('retry')

interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  retryOn?: (err: unknown) => boolean
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('socket hang up')) {
      return true
    }
  }
  // HTTP status: axios puts it on err.response.status, the OpenAI SDK (and LangChain's
  // wrappers around it) on err.status
  const e = err as { response?: { status?: unknown }; status?: unknown } | null
  const status = e?.response?.status ?? e?.status
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status < 600)
  }
  // Network errors (no response)
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return true
  }
  return false
}

const NOT_CONNECTED_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * True only when the request certainly never reached the server: no response, and
 * a connection that was refused or a host name that did not resolve. Use it for
 * calls that must not run twice (sending an email), where a timeout or a reset
 * might mean the first attempt was already accepted.
 */
export function isConnectionNotEstablished(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { response, code } = err as { response?: unknown; code?: unknown }
  if (response) return false
  return typeof code === 'string' && NOT_CONNECTED_CODES.has(code)
}

/** The HTTP status of the answer an axios error carries; undefined when no answer came. */
export function responseStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * True when a failed send certainly sent nothing: no connection was made, or the server refused the
 * request (4xx). Anything else (a timeout, a reset, a 5xx) may come after the server accepted it.
 */
export function provedNotSent(err: unknown): boolean {
  if (isConnectionNotEstablished(err)) return true
  const status = responseStatus(err)
  return status !== undefined && status >= 400 && status < 500
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 1000, retryOn = isRetryableError } = options

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt >= retries || !retryOn(err)) {
        throw err
      }
      const delay = baseDelayMs * Math.pow(2, attempt)
      log.debug({ attempt: attempt + 1, retries, delayMs: delay, err }, 'retrying after error')
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
