import axios, { type InternalAxiosRequestConfig } from 'axios'
import { config } from '../config.js'
import { withRetry, isRetryableError, isConnectionNotEstablished } from '../lib/retry.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('plunk')

const client = axios.create({
  baseURL: config.plunk.baseUrl,
  timeout: 15000,
  maxContentLength: 1 * 1024 * 1024,
  headers: { 'Content-Type': 'application/json' },
})

const authorize = (cfg: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  cfg.headers.Authorization = `Bearer ${config.plunk.secretKey}`
  return cfg
}

client.interceptors.request.use(authorize)

/**
 * Same API and auth, without the `{ success, data }` unwrap below: the activity list carries its
 * `cursor` and `hasMore` beside `data`, which the unwrap would drop. Its larger response cap is for
 * the email bodies each activity item carries.
 */
const rawClient = axios.create({
  baseURL: config.plunk.baseUrl,
  timeout: 15000,
  maxContentLength: config.plunk.activityMaxResponseBytes,
  headers: { 'Content-Type': 'application/json' },
})

rawClient.interceptors.request.use(authorize)

// Plunk "next" API wraps responses in { success, data }; unwrap automatically
client.interceptors.response.use((res) => {
  if (res.data && typeof res.data === 'object' && 'success' in res.data && 'data' in res.data) {
    res.data = res.data.data
  }
  return res
})

// --- Campaign types ---

export interface CreateCampaignOpts {
  name: string
  subject: string
  body: string
  from?: string
  fromName?: string
  audienceType: 'ALL' | 'SEGMENT' | 'FILTERED'
  segmentId?: string
}

export interface Campaign {
  id: string
  name: string
  subject: string
  type: string
  status: string
  scheduledAt: string | null
}

export interface CampaignStats {
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
}

// --- Contact types ---

export interface CreateContactOpts {
  email: string
  subscribed: boolean
  data?: Record<string, string | number | boolean>
}

export interface Contact {
  id: string
  email: string
  subscribed: boolean
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// --- Campaign methods ---

export async function createCampaign(opts: CreateCampaignOpts): Promise<Campaign> {
  return withRetry(
    async () => {
      log.info({ name: opts.name, audienceType: opts.audienceType }, 'creating campaign')
      const { data } = await client.post('/campaigns', {
        ...opts,
        from: opts.from || config.plunk.fromEmail,
        fromName: opts.fromName || config.plunk.fromName,
      })
      log.info({ campaignId: data.id }, 'campaign created')
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

export async function updateCampaign(id: string, opts: Partial<CreateCampaignOpts>): Promise<Campaign> {
  return withRetry(
    async () => {
      const { data } = await client.patch(`/campaigns/${id}`, opts)
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

export async function sendCampaign(id: string, scheduledFor?: string): Promise<void> {
  return withRetry(
    async () => {
      log.info({ campaignId: id, scheduledFor }, 'sending campaign')
      const body = scheduledFor ? { scheduledFor } : {}
      await client.post(`/campaigns/${id}/send`, body)
      log.info({ campaignId: id }, 'campaign send triggered')
    },
    { retries: 3, retryOn: isRetryableError },
  )
}


export async function getCampaignStats(id: string): Promise<CampaignStats> {
  return withRetry(
    async () => {
      const { data } = await client.get(`/campaigns/${id}/stats`)
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

export async function listCampaigns(): Promise<Campaign[]> {
  return withRetry(
    async () => {
      const { data } = await client.get('/campaigns')
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

// --- Contact methods ---

export async function createContact(opts: CreateContactOpts): Promise<Contact> {
  return withRetry(
    async () => {
      log.info({ email: opts.email, subscribed: opts.subscribed }, 'creating contact')
      const { data } = await client.post('/contacts', opts)
      log.info({ contactId: data.id }, 'contact created')
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

export async function updateContact(id: string, updates: Partial<CreateContactOpts>): Promise<Contact> {
  return withRetry(
    async () => {
      const { data } = await client.patch(`/contacts/${id}`, updates)
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

export async function getContact(id: string): Promise<Contact> {
  return withRetry(
    async () => {
      const { data } = await client.get(`/contacts/${id}`)
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

export async function deleteContact(id: string): Promise<void> {
  return withRetry(
    async () => {
      await client.delete(`/contacts/${id}`)
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

/** A `{ success, data: { ... } }` envelope's inner object; anything else as it is. */
function unwrapContactsEnvelope(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const inner = (body as { data?: unknown }).data
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
  }
  return body
}

/** True when the response carries a contact array in a shape parseContactsResponse reads. */
export function hasContactsArray(body: unknown): boolean {
  const b = unwrapContactsEnvelope(body) as { data?: unknown; items?: unknown; contacts?: unknown } | null
  return Array.isArray(b) || Array.isArray(b?.data) || Array.isArray(b?.items) || Array.isArray(b?.contacts)
}

/**
 * Normalize Plunk's list-contacts response into a typed page. The hosted "next"
 * API (next-api.useplunk.com) returns `{ data: [...], cursor, hasMore, total }`;
 * other/older surfaces return a bare array or `{ items }`/`{ contacts }`. Read
 * all of them, once nested in a `{ success, data: { ... } }` envelope, tolerating
 * missing pagination fields. Pagination fields beside a `data` array are read
 * from the same level, so an envelope `{ success, data: [...], cursor, hasMore }`
 * keeps its cursor.
 */
export function parseContactsResponse(
  rawBody: unknown,
): { items: Contact[]; nextCursor: string | null; hasMore: boolean; total: number } {
  const body = unwrapContactsEnvelope(rawBody)
  if (Array.isArray(body)) {
    return { items: body as Contact[], nextCursor: null, hasMore: false, total: body.length }
  }
  const b = (body ?? {}) as {
    data?: unknown
    items?: unknown
    contacts?: unknown
    cursor?: unknown
    nextCursor?: unknown
    hasMore?: unknown
    total?: unknown
  }
  const array = [b.data, b.items, b.contacts].find(Array.isArray)
  const items = (array ?? []) as Contact[]
  const nextCursor =
    typeof b.cursor === 'string' ? b.cursor : typeof b.nextCursor === 'string' ? b.nextCursor : null
  const hasMore = typeof b.hasMore === 'boolean' ? b.hasMore : Boolean(nextCursor)
  const total = typeof b.total === 'number' ? b.total : items.length
  return { items, nextCursor, hasMore, total }
}

export async function listContacts(cursor?: string, limit = 50): Promise<{ items: Contact[]; nextCursor: string | null; hasMore: boolean; total: number }> {
  return withRetry(
    async () => {
      const params: Record<string, string | number> = { limit }
      if (cursor) params.cursor = cursor
      // rawClient, not client: the shared client's `{ success, data }` unwrap would drop a
      // `cursor`/`hasMore` beside a `data` array and silently end paging after page one.
      const { data: body } = await rawClient.get('/contacts', { params })
      // No recognizable contact array means the Plunk shape changed: fail rather than
      // return an empty page that a backup or restore would take for "no contacts".
      if (!hasContactsArray(body)) {
        const shape = body && typeof body === 'object' ? Object.keys(body) : typeof body
        log.warn({ shape }, 'listContacts: unrecognized Plunk response shape')
        throw new Error(`listContacts: unrecognized Plunk response shape (${Array.isArray(shape) ? shape.join(', ') : shape})`)
      }
      return parseContactsResponse(body)
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

// --- Activity (spam complaints and bounces, ADR-0029) ---

export type PlunkActivityType = 'email.complaint' | 'email.bounced'

/**
 * One activity item, as Plunk's open-source `ActivityService.getActivities` returns it:
 * `{ id: "<emailId>_complaint", type, timestamp, contactEmail, contactId, metadata }`, where
 * `metadata` carries the email's subject, campaign name, source type, body and (for a bounce) the
 * SES diagnostic. Read tolerantly: the hosted API has not been checked against this shape.
 */
export interface PlunkActivity {
  id?: unknown
  type?: unknown
  timestamp?: unknown
  contactEmail?: unknown
  contactId?: unknown
  metadata?: unknown
}

export interface ActivityPage {
  items: PlunkActivity[]
  nextCursor: string | null
  hasMore: boolean
}

type ActivityBody = {
  data?: unknown
  items?: unknown
  activities?: unknown
  cursor?: unknown
  nextCursor?: unknown
  hasMore?: unknown
}

/**
 * Normalize an activity list response, read before any `{ success, data }` unwrap: a bare array,
 * or an array under `data`, `items` or `activities` with `cursor`/`nextCursor` and `hasMore` beside
 * it (once nested, as a `{ success, data: { data, cursor } }` envelope). Null when no array is found.
 */
export function parseActivityResponse(body: unknown): ActivityPage | null {
  if (Array.isArray(body)) return { items: body as PlunkActivity[], nextCursor: null, hasMore: false }
  if (!body || typeof body !== 'object') return null
  const b = body as ActivityBody
  const array = [b.data, b.items, b.activities].find(Array.isArray)
  if (!array) {
    // An envelope around the page itself
    return b.data && typeof b.data === 'object' ? parseActivityResponse(b.data) : null
  }
  const nextCursor =
    typeof b.cursor === 'string' && b.cursor ? b.cursor : typeof b.nextCursor === 'string' && b.nextCursor ? b.nextCursor : null
  const hasMore = typeof b.hasMore === 'boolean' ? b.hasMore : nextCursor !== null
  return { items: array as PlunkActivity[], nextCursor, hasMore }
}

const keysOf = (value: unknown): string[] | string =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : Array.isArray(value) ? 'array' : typeof value

export interface ListActivityOpts {
  types: PlunkActivityType[]
  startDate: Date
  cursor?: string | null
  limit: number
}

/**
 * One page of the account's activity of the given types since `startDate`. Read-only (GET), which
 * the hosted API also allows while the project is disabled. Throws when the response carries no
 * recognizable list, so a changed shape fails the job instead of passing as "nothing new".
 */
export async function listActivity(opts: ListActivityOpts): Promise<ActivityPage> {
  return withRetry(
    async () => {
      const params: Record<string, string | number> = {
        types: opts.types.join(','),
        startDate: opts.startDate.toISOString(),
        limit: opts.limit,
      }
      if (opts.cursor) params.cursor = opts.cursor
      const { data: body } = await rawClient.get('/activity', { params })
      const page = parseActivityResponse(body)
      if (!page) {
        log.warn({ shape: keysOf(body) }, 'listActivity: unrecognized Plunk response shape')
        throw new Error(`unrecognized Plunk activity response shape (keys: ${JSON.stringify(keysOf(body))})`)
      }
      // Shape check for the first live runs (ADR-0029): key names and counts only, never values.
      log.info({
        responseKeys: keysOf(body),
        itemKeys: page.items[0] ? keysOf(page.items[0]) : null,
        metadataKeys: page.items[0] ? keysOf(page.items[0].metadata) : null,
        count: page.items.length,
        hasMore: page.hasMore,
        startDate: params.startDate,
        oldestTimestamp: page.items.map(i => i.timestamp).filter((t): t is string => typeof t === 'string').sort()[0] ?? null,
      }, 'listActivity: page shape')
      return page
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

// --- Transactional ---

export interface SendTransactionalOpts {
  to: string
  subject: string
  body: string
  from?: string
  name?: string
}

/**
 * Retried only when the connection was never made: a timeout, a reset or a 5xx may
 * come after Plunk accepted the email, and a retry would then deliver it twice.
 */
export async function sendTransactional(opts: SendTransactionalOpts): Promise<void> {
  return withRetry(
    async () => {
      log.info({ to: opts.to, subject: opts.subject }, 'sending transactional email')
      await client.post('/v1/send', {
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        from: opts.from || config.plunk.fromEmail,
        name: opts.name || config.plunk.fromName,
      })
      log.info({ to: opts.to }, 'transactional email sent')
    },
    { retries: 2, retryOn: isConnectionNotEstablished },
  )
}

// --- Email verification ---

export interface EmailVerifyResult {
  valid: boolean
  domainExists: boolean
  isDisposable: boolean
}

export async function verifyEmail(email: string): Promise<EmailVerifyResult> {
  return withRetry(
    async () => {
      log.info({ email }, 'verifying email')
      const { data } = await client.post('/v1/verify', { email })
      log.info({ email, result: data }, 'email verification result')
      return data
    },
    { retries: 3, retryOn: isRetryableError },
  )
}

// --- Event tracking ---

export async function trackEvent(email: string, event: string, data?: Record<string, unknown>): Promise<void> {
  return withRetry(
    async () => {
      log.debug({ email, event }, 'tracking event')
      await client.post('/v1/track', { email, event, data })
    },
    { retries: 3, retryOn: isRetryableError },
  )
}
