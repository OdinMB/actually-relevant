/**
 * The admin session's token lifecycle: the in-memory access token, the
 * cookie-based refresh, and the signal that the session ended mid-use.
 */

const REFRESH_URL = `${import.meta.env.VITE_API_URL || ''}/api/auth/refresh`

/** Waits before retrying a refresh that failed for a transient reason (5xx, network). */
const REFRESH_RETRY_DELAYS_MS = [1000, 3000]

export type RefreshOutcome =
  | { status: 'ok'; accessToken: string }
  /** The refresh cookie was rejected or is missing: the person must log in again. */
  | { status: 'unauthorized' }
  /** The server could not answer (5xx, network, rate limit): the session is undecided. */
  | { status: 'unavailable' }

// In-memory access token (not localStorage — XSS-safe)
let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

// Preserve access token across Vite HMR (dev only, tree-shaken in production)
if (import.meta.hot) {
  if (import.meta.hot.data?.accessToken) {
    accessToken = import.meta.hot.data.accessToken
  }
  import.meta.hot.dispose((data) => {
    data.accessToken = accessToken
  })
}

type Attempt = RefreshOutcome | { status: 'transient' }

async function attemptRefresh(): Promise<Attempt> {
  try {
    const res = await fetch(REFRESH_URL, { method: 'POST', credentials: 'include' })
    if (res.ok) {
      const data = (await res.json()) as { accessToken: string }
      return { status: 'ok', accessToken: data.accessToken }
    }
    if (res.status === 429) return { status: 'unavailable' }
    if (res.status >= 500) return { status: 'transient' }
    return { status: 'unauthorized' }
  } catch {
    return { status: 'transient' }
  }
}

async function refreshWithRetry(): Promise<RefreshOutcome> {
  let attempt = await attemptRefresh()
  for (const delay of REFRESH_RETRY_DELAYS_MS) {
    if (attempt.status !== 'transient') break
    await new Promise(resolve => setTimeout(resolve, delay))
    attempt = await attemptRefresh()
  }
  return attempt.status === 'transient' ? { status: 'unavailable' } : attempt
}

let refreshInFlight: Promise<RefreshOutcome> | null = null

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refreshWithRetry()
    .then(outcome => {
      if (outcome.status === 'ok') accessToken = outcome.accessToken
      if (outcome.status === 'unauthorized') accessToken = null
      return outcome
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

const sessionExpiredListeners = new Set<() => void>()

/** Subscribe to the session ending mid-use (a refresh rejected after a 401). Returns the unsubscribe. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener)
  return () => {
    sessionExpiredListeners.delete(listener)
  }
}

export function notifySessionExpired() {
  sessionExpiredListeners.forEach(listener => listener())
}
