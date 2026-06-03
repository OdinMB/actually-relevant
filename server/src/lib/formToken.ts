import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('formToken')

if (!config.subscribe.formTokenSecret) {
  // Fail loud at startup: an empty key makes every form token forgeable, so the
  // bot gate would fail open. Set FORM_TOKEN_SECRET (or JWT_SECRET).
  log.warn('form token secret is empty — the subscribe bot gate is insecure')
}

/**
 * Anti-bot form token for the public subscribe form.
 *
 * The token is a stateless, HMAC-signed `{ ts, nonce }` payload issued when the
 * form is rendered (GET /api/subscribe/token) and validated on submit. It proves
 * the submitter fetched a token from our origin (blocking scripts that POST
 * directly to the API) and enforces a minimum fill time (tripping instant bots).
 *
 * Intentionally stateless: there is NO consumed-nonce store, so a token can in
 * principle be replayed within its lifetime. That is acceptable for a deterrent —
 * replay is bounded by `formTokenMaxAgeMs` and the per-IP rate limits, and a
 * stateless token stays correct across multiple server instances (an in-memory
 * single-use cache would not).
 */

function sign(payload: string): string {
  return createHmac('sha256', config.subscribe.formTokenSecret).update(payload).digest('base64url')
}

/** Issue a fresh signed form token stamped with the current time. */
export function issueFormToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ ts: Date.now(), nonce: randomBytes(8).toString('hex') }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/**
 * Verify a form token. Returns `{ ok: true }` only when the signature is valid
 * and the token's age is within `[minFormFillMs, formTokenMaxAgeMs]`.
 */
export function verifyFormToken(token: string | undefined | null): { ok: boolean } {
  if (!token || typeof token !== 'string') return { ok: false }

  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false }
  const [payload, sig] = parts

  // Compare the decoded HMAC bytes in constant time.
  const expected = sign(payload)
  const sigBuf = Buffer.from(sig, 'base64url')
  const expBuf = Buffer.from(expected, 'base64url')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false }
  }

  let parsed: { ts?: unknown; nonce?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false }
  }

  if (typeof parsed.ts !== 'number') return { ok: false }
  const age = Date.now() - parsed.ts
  if (age < config.subscribe.minFormFillMs) return { ok: false }
  if (age > config.subscribe.formTokenMaxAgeMs) return { ok: false }

  return { ok: true }
}
