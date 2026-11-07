import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('simple-analytics')

/**
 * How the server identifies itself in each event. Simple Analytics counts an event whose `ua` names
 * a bot, spider, crawler or agent, or is an HTTP library's default, as a robot's and leaves it out.
 */
export const SERVER_USER_AGENT = 'ActuallyRelevantServer/1.0 (+https://actuallyrelevant.news/)'

/** A Simple Analytics event: a name of letters, digits and underscores, and flat metadata without empty values. */
export interface AnalyticsEvent {
  event: string
  metadata: Record<string, string | number | boolean>
}

const HOUR_MS = 60 * 60 * 1000

/** This process's current hour: events sent, and whether it has warned yet. */
const hour = { start: 0, sent: 0, failureWarned: false, capWarned: false }

function currentHour(now: number): typeof hour {
  if (now - hour.start >= HOUR_MS) Object.assign(hour, { start: now, sent: 0, failureWarned: false, capWarned: false })
  return hour
}

/** The first failure of an hour is a warning, the rest go to debug, so an outage writes one line an hour. */
function logFailure(current: typeof hour, details: Record<string, unknown>): void {
  if (current.failureWarned) {
    log.debug(details, 'usage event not sent')
    return
  }
  current.failureWarned = true
  log.warn(details, 'usage event not sent; further failures this hour are logged at debug')
}

/**
 * Send one event to Simple Analytics' server-side endpoint
 * (https://docs.simpleanalytics.com/events/server-side). Never throws and never retries, unlike other
 * outside calls (`withRetry()`): a lost count is acceptable, and a retry would keep the request's
 * work alive for seconds after its response. Drops the event once the hour's cap is reached.
 */
export async function sendAnalyticsEvent({ event, metadata }: AnalyticsEvent): Promise<void> {
  const current = currentHour(Date.now())
  if (current.sent >= config.simpleAnalytics.maxEventsPerHour) {
    if (!current.capWarned) {
      current.capWarned = true
      log.warn({ cap: config.simpleAnalytics.maxEventsPerHour }, 'hourly cap of usage events reached; the rest of this hour is not counted')
    }
    return
  }
  current.sent++

  try {
    const response = await fetch(config.simpleAnalytics.eventsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': SERVER_USER_AGENT },
      body: JSON.stringify({ type: 'event', hostname: config.simpleAnalytics.hostname, event, ua: SERVER_USER_AGENT, metadata }),
      signal: AbortSignal.timeout(config.simpleAnalytics.timeoutMs),
    })
    await response.body?.cancel()
    if (!response.ok) logFailure(current, { event, status: response.status })
  } catch (err) {
    logFailure(current, { event, err })
  }
}

/** Test-only: start a fresh hour. */
export function _resetAnalyticsState(): void {
  Object.assign(hour, { start: 0, sent: 0, failureWarned: false, capWarned: false })
}
