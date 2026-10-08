/**
 * Restore Plunk contacts that are in a backup but missing from Plunk now.
 *
 * Takes a file written by backup-plunk-contacts.ts and compares it with the
 * current Plunk contacts by lowercased email. Contacts that still exist are
 * never changed, whatever their status now; only missing ones are recreated.
 *
 * Preview by default: read-only, lists the missing contacts (count, addresses,
 * the subscribed status each had). Apply recreates each one through the same
 * POST /contacts the app uses (createContact) with its email, subscribed status
 * and custom data, 200 ms apart, and prints a summary.
 *
 * A recreated contact is a new Plunk contact: it gets a new id and a new
 * creation date. Its event history and campaign stats do not come back. Custom
 * data values that are not a string, number or boolean are left out (counted
 * in the output).
 *
 * Run it on the owner's machine, where the backup file is. It needs only the
 * Plunk secret key, no database. In PowerShell:
 *
 *   $env:PLUNK_SECRET_KEY="sk_..."
 *   npm run restore:plunk-contacts --prefix server -- --file=../DOCS/2026-10-08_plunk-contacts-backup.json
 *   npm run restore:plunk-contacts:apply --prefix server -- --file=../DOCS/2026-10-08_plunk-contacts-backup.json
 *   Remove-Item Env:PLUNK_SECRET_KEY
 *
 * A relative --file is resolved against the server folder (npm --prefix runs
 * there). NOTE: requires the Plunk account to be ACTIVE.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { completenessProblems, fetchAllContacts, type ContactsPage, type RawContact } from './backup-plunk-contacts.js'

const CREATE_DELAY_MS = 200

export interface RestoreArgs {
  apply: boolean
  file: string
}

/** Parse CLI flags. Throws on anything unknown, and without --file. */
export function parseRestoreArgs(argv: string[]): RestoreArgs {
  let apply = false
  let file: string | null = null
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length).trim()
      if (!file) throw new Error('--file needs a path')
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!file) throw new Error('--file=<path to the backup JSON> is required')
  return { apply, file }
}

/** Read the contacts out of a parsed backup file; throws if it is not one. */
export function contactsFromBackup(parsed: unknown): RawContact[] {
  const b = parsed as { contacts?: unknown; count?: unknown } | null
  if (!b || typeof b !== 'object' || !Array.isArray(b.contacts)) {
    throw new Error('not a Plunk contact backup: no "contacts" array')
  }
  if (typeof b.count === 'number' && b.count !== b.contacts.length) {
    throw new Error(`backup says ${b.count} contacts but holds ${b.contacts.length}`)
  }
  return b.contacts as RawContact[]
}

export interface MissingContact {
  email: string
  subscribed: boolean
  data: Record<string, string | number | boolean>
  /** Custom data keys left out because their value was not a string, number or boolean. */
  droppedDataKeys: string[]
}

const normalize = (email: unknown): string | null =>
  typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null

/**
 * Contacts in the backup whose lowercased email is not among the current ones.
 * Each email once (first occurrence); backup entries without an email are skipped.
 * Only `true` (or the string "true", or 1, as the admin's subscriber list reads it)
 * restores as subscribed; anything else, a missing flag included, restores as
 * unsubscribed, the safe side.
 */
export function findMissingContacts(backup: RawContact[], current: RawContact[]): MissingContact[] {
  const present = new Set<string>()
  for (const c of current) {
    const e = normalize(c.email)
    if (e) present.add(e)
  }
  const seen = new Set<string>()
  const missing: MissingContact[] = []
  for (const c of backup) {
    const e = normalize(c.email)
    if (!e || present.has(e) || seen.has(e)) continue
    seen.add(e)
    const data: Record<string, string | number | boolean> = {}
    const droppedDataKeys: string[] = []
    if (c.data && typeof c.data === 'object' && !Array.isArray(c.data)) {
      for (const [k, v] of Object.entries(c.data as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') data[k] = v
        else droppedDataKeys.push(k)
      }
    }
    missing.push({ email: (c.email as string).trim(), subscribed: c.subscribed === true || c.subscribed === 'true' || c.subscribed === 1, data, droppedDataKeys })
  }
  return missing
}

export interface CreateOpts {
  email: string
  subscribed: boolean
  data?: Record<string, string | number | boolean>
}

export interface RestoreResult {
  created: number
  failed: number
}

/**
 * Recreate the missing contacts. Preview (apply false) returns at once without
 * calling `create`. Failures are counted and logged; the run continues.
 */
export async function restoreContacts(
  missing: MissingContact[],
  opts: { apply: boolean; create: (c: CreateOpts) => Promise<unknown>; delayMs?: number; log?: (line: string) => void },
): Promise<RestoreResult> {
  if (!opts.apply) return { created: 0, failed: 0 }
  const log = opts.log ?? ((line: string) => console.log(line))
  let created = 0
  let failed = 0
  for (const m of missing) {
    try {
      await opts.create({
        email: m.email,
        subscribed: m.subscribed,
        ...(Object.keys(m.data).length > 0 ? { data: m.data } : {}),
      })
      created++
      if (created % 50 === 0) log(`  recreated ${created}/${missing.length}...`)
    } catch (err) {
      failed++
      log(`  failed to recreate ${m.email}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
  }
  return { created, failed }
}

async function main() {
  const args = parseRestoreArgs(process.argv.slice(2))
  const filePath = path.resolve(process.cwd(), args.file)
  const backup = contactsFromBackup(JSON.parse(fs.readFileSync(filePath, 'utf8')))

  const { config } = await import('../config.js')
  if (!config.plunk.secretKey) throw new Error('PLUNK_SECRET_KEY is not set')
  const plunk = await import('../services/plunk.js')

  console.log(`Plunk contact restore — mode: ${args.apply ? 'APPLY (will recreate)' : 'PREVIEW (no changes)'}`)
  console.log(`Backup: ${filePath} (${backup.length} contacts)`)

  const fetched = await fetchAllContacts(
    (cursor, limit) => plunk.listContacts(cursor, limit) as unknown as Promise<ContactsPage>,
  )
  const current = fetched.contacts
  console.log(`Current Plunk contacts: ${current.length}`)
  // A contact the listing missed would be "recreated" through POST /contacts, which may
  // overwrite it with the backup's (older) subscribed status. Never apply on such a listing.
  const listingProblems = completenessProblems(fetched)
  for (const p of listingProblems) console.error(`WARNING: ${p}`)
  if (listingProblems.length > 0 && args.apply) {
    throw new Error('the current Plunk listing looks incomplete; refusing to recreate contacts. Re-run the preview later.')
  }

  const missing = findMissingContacts(backup, current)
  const subscribed = missing.filter((m) => m.subscribed).length
  console.log(`\nIn the backup but missing now: ${missing.length} (${subscribed} were subscribed, ${missing.length - subscribed} unsubscribed)`)
  for (const m of missing) {
    console.log(`  ${args.apply ? 'RECREATE' : 'would recreate'}: ${m.email} (${m.subscribed ? 'subscribed' : 'unsubscribed'})`)
  }
  const dropped = missing.filter((m) => m.droppedDataKeys.length > 0).length
  if (dropped > 0) console.log(`\n${dropped} of them carry custom data that is not a string, number or boolean; those keys are left out.`)

  if (!args.apply) {
    console.log('\nPreview complete. Re-run with restore:plunk-contacts:apply to recreate these contacts (new id and creation date).')
    return
  }

  const result = await restoreContacts(missing, { apply: true, create: plunk.createContact, delayMs: CREATE_DELAY_MS })
  console.log(`\nDone. Recreated: ${result.created}, Failed: ${result.failed}. Contacts that still existed were not touched.`)
  if (result.failed > 0) process.exitCode = 1
}

// Only run when executed directly (so importing the file for tests has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
