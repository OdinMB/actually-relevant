/**
 * Unsubscribe a hand-picked list of addresses in Plunk (never deletes).
 *
 * For when Plunk's dashboard refuses to unsubscribe contacts. Reads a text file
 * with one address per line (blank lines and lines starting with # are skipped;
 * addresses are lowercased and deduped), lists every Plunk contact, and for each
 * listed address reports: currently subscribed, snoozed, already unsubscribed,
 * or not found in Plunk.
 *
 * Preview by default: strictly read-only (GET /contacts only).
 *
 * Apply changes exactly the listed contacts that are subscribed (or snoozed,
 * which Plunk would resubscribe automatically when the snooze ends) through
 * PATCH /contacts/:id with { subscribed: false } (updateContact). That is the
 * open-source API's synchronous per-contact update: it addresses the contact by
 * the id the listing returned, so it can never create a contact (POST /contacts
 * upserts by email), it clears any snooze, and it returns the updated contact,
 * which must read subscribed: false or the change counts as failed. The
 * dashboard's unsubscribe goes through a queued bulk job instead. Nothing off
 * the list is touched; nothing is deleted. 200 ms between calls. If the very
 * first change fails, it stops and prints Plunk's error instead of trying the
 * rest.
 *
 * Both modes refuse to run on a listing that looks incomplete (Plunk's total
 * differs from the contacts paged, or an id repeats), since a contact the listing
 * missed would show as "not found".
 *
 * Run it on the owner's machine from the repo root. It needs only the Plunk
 * secret key (from server/.env, or $env:PLUNK_SECRET_KEY, which dotenv does not
 * override), no database:
 *
 *   npm run unsubscribe:plunk-contacts --prefix server -- --file=../DOCS/2026-10-08_unsubscribe-list.txt
 *   npm run unsubscribe:plunk-contacts:apply --prefix server -- --file=../DOCS/2026-10-08_unsubscribe-list.txt
 *
 * A relative --file is resolved against the server folder (npm --prefix runs
 * there). The list file holds addresses (personal data): keep it in DOCS/ on
 * this machine only and delete it once done. Requires the Plunk account to be
 * ACTIVE (a suspended one answers 403 PROJECT_DISABLED).
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { completenessProblems, fetchAllContacts, type ContactsPage, type RawContact } from './backup-plunk-contacts.js'

const UPDATE_DELAY_MS = 200

export interface UnsubscribeArgs {
  apply: boolean
  file: string
}

/** Parse CLI flags. Throws on anything unknown, and without --file. */
export function parseUnsubscribeArgs(argv: string[]): UnsubscribeArgs {
  let apply = false
  let file: string | null = null
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length).trim()
      if (!file) throw new Error('--file needs a path')
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!file) throw new Error('--file=<path to the address list> is required')
  return { apply, file }
}

/**
 * Addresses from the list file: one per line, trimmed, lowercased, deduped in
 * order. Blank lines and lines starting with # are skipped. Throws on a line
 * that is not an address, so a typo or a pasted CSV row never passes silently.
 */
export function parseEmailList(text: string): string[] {
  const seen = new Set<string>()
  const emails: string[] = []
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(line)) {
      throw new Error(`line ${i + 1} is not a single email address: "${line}"`)
    }
    const email = line.toLowerCase()
    if (seen.has(email)) return
    seen.add(email)
    emails.push(email)
  })
  return emails
}

export type ContactStatus = 'subscribed' | 'snoozed' | 'unsubscribed' | 'unknown' | 'not-found'

export interface ListedAddress {
  email: string
  status: ContactStatus
  /** Plunk contact id; set when the address was found. */
  id?: string
}

/**
 * Match each listed address to the current Plunk contacts by lowercased email.
 * `snoozed` is Plunk's subscribed:false with a snoozedUntil date (resubscribed
 * automatically later); `unknown` is a found contact whose subscribed flag is
 * neither true nor false, or one without an id, and is never changed.
 * Throws when two contacts share an address, rather than guess which to change.
 */
export function classifyAddresses(emails: string[], contacts: RawContact[]): ListedAddress[] {
  const byEmail = new Map<string, RawContact>()
  for (const c of contacts) {
    if (typeof c.email !== 'string' || !c.email.trim()) continue
    const e = c.email.trim().toLowerCase()
    if (byEmail.has(e)) throw new Error(`two Plunk contacts share the address ${e}; resolve that in Plunk first`)
    byEmail.set(e, c)
  }
  return emails.map((email) => {
    const c = byEmail.get(email)
    if (!c) return { email, status: 'not-found' as const }
    const id = typeof c.id === 'string' && c.id ? c.id : undefined
    let status: ContactStatus
    if (!id) status = 'unknown'
    else if (c.subscribed === true) status = 'subscribed'
    else if (c.subscribed === false) status = c.snoozedUntil != null ? 'snoozed' : 'unsubscribed'
    else status = 'unknown'
    return id ? { email, status, id } : { email, status }
  })
}

export const needsChange = (a: ListedAddress): boolean => a.status === 'subscribed' || a.status === 'snoozed'

export interface StatusCounts {
  subscribed: number
  snoozed: number
  unsubscribed: number
  unknown: number
  notFound: number
}

export function countStatuses(listed: ListedAddress[]): StatusCounts {
  const counts: StatusCounts = { subscribed: 0, snoozed: 0, unsubscribed: 0, unknown: 0, notFound: 0 }
  for (const a of listed) {
    if (a.status === 'not-found') counts.notFound++
    else counts[a.status]++
  }
  return counts
}

/** Plunk's error as "HTTP <status>: <message>", or the error's message; never a stack. */
export function describePlunkError(err: unknown): string {
  const res = (err as { response?: { status?: unknown; data?: unknown } } | null)?.response
  if (res && typeof res.status === 'number') {
    const d = res.data as Record<string, unknown> | string | null | undefined
    let msg: string | null = null
    if (typeof d === 'string' && d.trim()) msg = d.trim().slice(0, 500)
    else if (d && typeof d === 'object') {
      const e = d.error as Record<string, unknown> | string | undefined
      if (typeof e === 'string') msg = e
      else if (e && typeof e === 'object') {
        msg = [e.code, e.message].filter((v) => typeof v === 'string' && v).join(': ') || null
      }
      if (!msg && typeof d.message === 'string') msg = d.message
      if (!msg) msg = JSON.stringify(d).slice(0, 500)
    }
    return `HTTP ${res.status}${msg ? `: ${msg}` : ''}`
  }
  return err instanceof Error ? err.message : String(err)
}

export interface ApplyResult {
  unsubscribed: number
  failed: number
  /** Changes not tried because the first one failed. */
  notAttempted: number
}

/**
 * Unsubscribe the listed contacts that need it. Preview (apply false) returns at
 * once without calling `unsubscribe`. Each returned contact must read
 * subscribed:false (and no snooze, when the field is present), or it counts as
 * failed. A failure of the very first change stops the run; later failures are
 * counted and the run continues.
 */
export async function applyUnsubscribes(
  listed: ListedAddress[],
  opts: {
    apply: boolean
    unsubscribe: (id: string) => Promise<unknown>
    delayMs?: number
    log?: (line: string) => void
  },
): Promise<ApplyResult> {
  const result: ApplyResult = { unsubscribed: 0, failed: 0, notAttempted: 0 }
  if (!opts.apply) return result
  const log = opts.log ?? ((line: string) => console.log(line))
  const todo = listed.filter((a) => needsChange(a) && a.id)
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i]
    try {
      const updated = (await opts.unsubscribe(a.id as string)) as { subscribed?: unknown; snoozedUntil?: unknown } | null
      if (!updated || typeof updated !== 'object' || updated.subscribed !== false) {
        throw new Error(`Plunk did not confirm the unsubscribe (subscribed=${String(updated?.subscribed)})`)
      }
      if (updated.snoozedUntil != null) {
        throw new Error(`Plunk kept a snooze until ${String(updated.snoozedUntil)}; the contact will be resubscribed then`)
      }
      result.unsubscribed++
      log(`  UNSUBSCRIBED: ${a.email}`)
    } catch (err) {
      result.failed++
      log(`  FAILED: ${a.email} (${a.id}): ${describePlunkError(err)}`)
      if (i === 0) {
        result.notAttempted = todo.length - 1
        if (result.notAttempted > 0) log(`  The first change failed; stopping without trying the other ${result.notAttempted}.`)
        return result
      }
    }
    if (opts.delayMs && i < todo.length - 1) await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
  }
  return result
}

const STATUS_LABEL: Record<ContactStatus, string> = {
  subscribed: 'currently subscribed',
  snoozed: 'snoozed (Plunk resubscribes it later)',
  unsubscribed: 'already unsubscribed',
  unknown: 'found, subscription status unreadable (left alone)',
  'not-found': 'not found in Plunk',
}

async function main() {
  const args = parseUnsubscribeArgs(process.argv.slice(2))
  const filePath = path.resolve(process.cwd(), args.file)
  const emails = parseEmailList(fs.readFileSync(filePath, 'utf8'))

  const { config } = await import('../config.js')
  if (!config.plunk.secretKey) throw new Error('PLUNK_SECRET_KEY is not set')
  const plunk = await import('../services/plunk.js')

  console.log(`Plunk unsubscribe — mode: ${args.apply ? 'APPLY (will unsubscribe)' : 'PREVIEW (no changes)'}`)
  console.log(`List: ${filePath} (${emails.length} addresses)`)

  const fetched = await fetchAllContacts(
    (cursor, limit) => plunk.listContacts(cursor, limit) as unknown as Promise<ContactsPage>,
  )
  console.log(`Plunk contacts listed: ${fetched.contacts.length}`)
  const problems = completenessProblems(fetched)
  if (problems.length > 0) {
    for (const p of problems) console.error(`WARNING: ${p}`)
    throw new Error('the Plunk listing looks incomplete, so "not found" cannot be trusted; refusing to continue. Re-run later.')
  }

  const listed = classifyAddresses(emails, fetched.contacts)
  console.log('')
  for (const a of listed) console.log(`  ${a.email}: ${STATUS_LABEL[a.status]}`)
  const counts = countStatuses(listed)
  const toChange = counts.subscribed + counts.snoozed
  console.log(
    `\nSubscribed: ${counts.subscribed}, Snoozed: ${counts.snoozed}, Already unsubscribed: ${counts.unsubscribed}, ` +
      `Not found: ${counts.notFound}${counts.unknown ? `, Unreadable status: ${counts.unknown}` : ''}`,
  )

  if (!args.apply) {
    console.log(`\nPreview complete; nothing changed. Apply would unsubscribe ${toChange}: npm run unsubscribe:plunk-contacts:apply --prefix server -- --file=${args.file}`)
    return
  }
  if (toChange === 0) {
    console.log('\nNothing to unsubscribe.')
    return
  }

  console.log(`\nUnsubscribing ${toChange} through PATCH /contacts/:id ...`)
  const result = await applyUnsubscribes(listed, {
    apply: true,
    unsubscribe: (id) => plunk.updateContact(id, { subscribed: false }),
    delayMs: UPDATE_DELAY_MS,
  })
  console.log(
    `\nDone. Unsubscribed: ${result.unsubscribed}, Already unsubscribed: ${counts.unsubscribed}, ` +
      `Not found: ${counts.notFound}, Failed: ${result.failed}` +
      (result.notAttempted ? `, Not attempted: ${result.notAttempted}` : '') +
      (counts.unknown ? `, Unreadable status (left alone): ${counts.unknown}` : ''),
  )
  if (result.failed > 0) process.exitCode = 1
}

// Only run when executed directly (so importing the file for tests has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', describePlunkError(err))
    process.exit(1)
  })
}
