import axios from 'axios'
import prisma from '../lib/prisma.js'
import * as plunk from './plunk.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('subscribers')

// Bounds for the Plunk fetch so a bot-bloated or degraded contact list can't hang
// the admin request. A single in-flight page can still overshoot the deadline by
// its own (retry-backed) timeout; the deadline simply stops the loop afterwards.
const PLUNK_PAGE_SIZE = 100
const PLUNK_MAX_PAGES = 100 // hard cap → up to ~10k contacts scanned
const PLUNK_OVERALL_TIMEOUT_MS = 10_000

export type DbStatus = 'confirmed' | 'pending'
export type PlunkStatus = 'subscribed' | 'unsubscribed'

export interface SubscriberRow {
  email: string
  dbStatus: DbStatus | null // null = no local row
  dbConfirmedAt: string | null
  dbCreatedAt: string | null
  plunkStatus: PlunkStatus | null // null = absent from Plunk, or Plunk unavailable
  plunkContactId: string | null
  mismatch: boolean // DB and Plunk disagree (only meaningful when Plunk is available)
}

export interface SubscriberReconciliation {
  db: { total: number; confirmed: number; pending: number }
  plunk: {
    available: boolean // false → the first Plunk call failed (e.g. account suspended)
    partial: boolean // true → pagination failed or timed out partway; counts are over what loaded
    truncated: boolean // true → hit the page cap
    total: number | null
    subscribed: number | null
    unsubscribed: number | null
    unsubscribedNotInDb: number | null // never-confirmed contacts, collapsed into a count
    error: string | null
  }
  mismatches: number
  rows: SubscriberRow[]
}

interface DbSubscriber {
  email: string
  confirmedAt: Date | null
  createdAt: Date
}

interface PlunkContactLite {
  email: string
  subscribed: boolean
  id: string | null
}

/**
 * Collapse multiple rows for one email (email is not unique on PendingSubscription)
 * into one, preferring a confirmed row, then the most recently created.
 */
function dedupeDbRows(rows: DbSubscriber[]): Map<string, DbSubscriber> {
  const byEmail = new Map<string, DbSubscriber>()
  for (const row of rows) {
    if (!row.email) continue
    const key = row.email.toLowerCase()
    const existing = byEmail.get(key)
    if (!existing) {
      byEmail.set(key, row)
      continue
    }
    const existingConfirmed = existing.confirmedAt != null
    const rowConfirmed = row.confirmedAt != null
    if (rowConfirmed && !existingConfirmed) {
      byEmail.set(key, row)
    } else if (rowConfirmed === existingConfirmed && row.createdAt > existing.createdAt) {
      byEmail.set(key, row)
    }
  }
  return byEmail
}

/** Sort order for the Plunk-authoritative list: subscribed, then unsubscribed, then absent. */
function plunkSortRank(status: PlunkStatus | null): number {
  if (status === 'subscribed') return 0
  if (status === 'unsubscribed') return 1
  return 2
}

/**
 * Pure reconciliation of DB subscribers against Plunk contacts, keyed by lowercased
 * email. Every DB row and every Plunk contact is listed (Plunk is the authoritative
 * overview); unsubscribed Plunk contacts with no local row are also tallied in
 * `plunkCounts.unsubscribedNotInDb`. Rows are sorted subscribed-first, then
 * unsubscribed, then absent-from-Plunk. When `plunkAvailable` is false the Plunk
 * side is treated as unknown (no per-row status, no mismatches).
 */
export function reconcile(
  dbSubscribers: DbSubscriber[],
  plunkContacts: PlunkContactLite[],
  plunkAvailable: boolean,
): {
  rows: SubscriberRow[]
  db: { total: number; confirmed: number; pending: number }
  plunkCounts: { total: number; subscribed: number; unsubscribed: number; unsubscribedNotInDb: number }
  mismatches: number
} {
  const dbByEmail = dedupeDbRows(dbSubscribers)
  let dbConfirmed = 0
  for (const s of dbByEmail.values()) if (s.confirmedAt) dbConfirmed++
  const db = { total: dbByEmail.size, confirmed: dbConfirmed, pending: dbByEmail.size - dbConfirmed }

  const plunkByEmail = new Map<string, PlunkContactLite>()
  for (const c of plunkContacts) {
    if (c.email) plunkByEmail.set(c.email.toLowerCase(), c)
  }
  let subscribed = 0
  for (const c of plunkByEmail.values()) if (c.subscribed) subscribed++
  const plunkCounts = {
    total: plunkByEmail.size,
    subscribed,
    unsubscribed: plunkByEmail.size - subscribed,
    unsubscribedNotInDb: 0,
  }

  const rows: SubscriberRow[] = []
  let mismatches = 0

  // DB rows are always shown.
  for (const [key, s] of dbByEmail) {
    const dbStatus: DbStatus = s.confirmedAt ? 'confirmed' : 'pending'
    const contact = plunkAvailable ? plunkByEmail.get(key) : undefined
    const plunkStatus: PlunkStatus | null = contact ? (contact.subscribed ? 'subscribed' : 'unsubscribed') : null
    const mismatch = plunkAvailable && (dbStatus === 'confirmed') !== (plunkStatus === 'subscribed')
    if (mismatch) mismatches++
    rows.push({
      email: s.email,
      dbStatus,
      dbConfirmedAt: s.confirmedAt ? s.confirmedAt.toISOString() : null,
      dbCreatedAt: s.createdAt.toISOString(),
      plunkStatus,
      plunkContactId: contact?.id ?? null,
      mismatch,
    })
  }

  // Plunk-only contacts (no local row) are all listed — Plunk is the
  // authoritative overview. A subscribed contact with no local row is real
  // drift; an unsubscribed one (never-confirmed) is expected, but still tallied.
  if (plunkAvailable) {
    for (const [key, contact] of plunkByEmail) {
      if (dbByEmail.has(key)) continue
      if (!contact.subscribed) plunkCounts.unsubscribedNotInDb++
      const mismatch = contact.subscribed
      if (mismatch) mismatches++
      rows.push({
        email: contact.email,
        dbStatus: null,
        dbConfirmedAt: null,
        dbCreatedAt: null,
        plunkStatus: contact.subscribed ? 'subscribed' : 'unsubscribed',
        plunkContactId: contact.id,
        mismatch,
      })
    }
  }

  // Plunk-authoritative order: subscribed first, then unsubscribed, then rows
  // absent from Plunk; within a group, drift first, then email.
  rows.sort((a, b) => {
    const rank = plunkSortRank(a.plunkStatus) - plunkSortRank(b.plunkStatus)
    if (rank !== 0) return rank
    if (a.mismatch !== b.mismatch) return a.mismatch ? -1 : 1
    return a.email.localeCompare(b.email)
  })

  return { rows, db, plunkCounts, mismatches }
}

interface PlunkFetch {
  contacts: PlunkContactLite[]
  available: boolean
  partial: boolean
  truncated: boolean
  error: string | null
}

/** Coerce Plunk's (unverified-shape) `subscribed` field to a boolean. */
function coerceSubscribed(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function plunkErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { code?: string; error?: string } | undefined
    if (data?.code) return data.code
    if (data?.error) return data.error
    if (err.response?.status) return `HTTP ${err.response.status}`
  }
  return err instanceof Error ? err.message : 'unknown error'
}

/** Page through every Plunk contact, bounded by a page cap and an overall deadline. */
async function fetchAllPlunkContacts(): Promise<PlunkFetch> {
  const contacts: PlunkContactLite[] = []
  const deadline = Date.now() + PLUNK_OVERALL_TIMEOUT_MS
  let cursor: string | undefined
  let pages = 0
  let firstCall = true
  let partial = false
  let truncated = false

  while (true) {
    if (Date.now() > deadline) {
      partial = true
      break
    }

    let page: { items?: unknown; contacts?: unknown; hasMore?: boolean; nextCursor?: string | null }
    try {
      page = await plunk.listContacts(cursor, PLUNK_PAGE_SIZE)
    } catch (err) {
      if (firstCall) {
        log.warn({ err }, 'failed to list Plunk contacts')
        return { contacts: [], available: false, partial: false, truncated: false, error: plunkErrorMessage(err) }
      }
      log.warn({ err }, 'Plunk contact pagination failed partway; returning partial set')
      partial = true
      break
    }
    firstCall = false

    // listContacts is declared to return { items }, but the live shape is unverified
    // (it may return { contacts }). Normalize defensively before iterating.
    const items: unknown = Array.isArray(page?.items)
      ? page.items
      : Array.isArray(page?.contacts)
        ? page.contacts
        : []
    for (const raw of items as unknown[]) {
      const c = raw as { email?: unknown; subscribed?: unknown; id?: unknown }
      if (typeof c?.email === 'string' && c.email) {
        contacts.push({ email: c.email, subscribed: coerceSubscribed(c.subscribed), id: typeof c.id === 'string' ? c.id : null })
      }
    }

    pages++
    if (pages >= PLUNK_MAX_PAGES) {
      truncated = true
      break
    }
    if (!page?.hasMore || !page?.nextCursor) break
    if (page.nextCursor === cursor) {
      // A repeated cursor would loop forever; stop and flag the data as partial.
      log.warn({ cursor }, 'Plunk returned an unchanged pagination cursor; stopping to avoid a loop')
      partial = true
      break
    }
    cursor = page.nextCursor
  }

  return { contacts, available: true, partial, truncated, error: null }
}

/** Read DB subscribers + Plunk contacts and reconcile them for the admin Subscribers page. */
export async function getSubscriberReconciliation(): Promise<SubscriberReconciliation> {
  const dbRows = await prisma.pendingSubscription.findMany({
    select: { email: true, confirmedAt: true, createdAt: true },
  })

  const fetched = await fetchAllPlunkContacts()
  const { rows, db, plunkCounts, mismatches } = reconcile(dbRows, fetched.contacts, fetched.available)

  return {
    db,
    plunk: {
      available: fetched.available,
      partial: fetched.partial,
      truncated: fetched.truncated,
      total: fetched.available ? plunkCounts.total : null,
      subscribed: fetched.available ? plunkCounts.subscribed : null,
      unsubscribed: fetched.available ? plunkCounts.unsubscribed : null,
      unsubscribedNotInDb: fetched.available ? plunkCounts.unsubscribedNotInDb : null,
      error: fetched.error,
    },
    mismatches,
    rows,
  }
}
