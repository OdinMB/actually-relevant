/**
 * How a run (research's, story context's, a research pass's) reports and judges an unexpected error:
 * stored by name and code only, and a failure that may pass on a later attempt told from one that
 * will not. Pure.
 */
import { isRetryableError } from './retry.js'

/** An unexpected error by name and code only: a message may quote fetched text or a query's arguments. */
export function sanitizedError(err: unknown): string {
  if (!(err instanceof Error)) return 'unexpected error'
  const code = (err as { code?: unknown }).code
  return `unexpected error (${err.name}${typeof code === 'string' ? ` ${code}` : ''})`
}

/**
 * A failure that may pass on a later attempt, once the SDK's and `withRetry`'s own retries are spent
 * (`.context/story-context.md`, "Failures"): a rate limit, a server error, a timeout or a lost
 * connection. A refused request, a missing key, an answer of the wrong shape and an error of ours do not.
 */
export function transientFailure(err: unknown): boolean {
  if (isRetryableError(err)) return true
  if (!(err instanceof Error)) return false
  // LangChain rethrows the SDK's timeout under this name; the SDK's connection errors carry no status
  return err.name === 'TimeoutError' || ['APIConnectionError', 'APIConnectionTimeoutError'].includes(err.constructor.name)
}
