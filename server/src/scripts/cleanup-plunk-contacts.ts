/**
 * Clean up bot / never-confirmed contacts from Plunk.
 *
 * Every signup creates a Plunk contact (subscribed:false) as a side effect of
 * sending the confirmation email — Plunk creates a contact for every /v1/send
 * recipient. Confirmed signups get upserted to subscribed:true; the ones that
 * never confirm (the bot flood that polluted the list and likely contributed to
 * the account suspension) linger as unsubscribed contacts. This script removes
 * Plunk contacts that are NOT subscribed, have no confirmed local
 * PendingSubscription, AND were created more than PURGE_MIN_AGE_DAYS days ago.
 * The age gate avoids deleting a brand-new signup that simply hasn't confirmed
 * yet. Confirmed subscribers (subscribed:true) and anyone who ever confirmed
 * locally (even if later unsubscribed) are never touched.
 *
 * Import guard: subscribers from the previous provider were imported straight
 * into Plunk on 15 February 2026 (01:36 Berlin), so they have no local
 * PendingSubscription. One who later unsubscribed, or was unsubscribed after a
 * complaint, would look like a bot here, and deleting the contact would erase
 * Plunk's record that they opted out. Contacts created inside a protected
 * window are therefore never purged. Default window: 2026-02-14T23:00Z to
 * 2026-02-16T00:00Z (the import day in Berlin and in UTC). Override it with
 * --protect-created=<ISO start>..<ISO end> (repeatable; any given flag replaces
 * the default, so repeat the default window if you still want it).
 *
 * Dry run by default — pass --apply to actually delete. The dry run is
 * read-only: it lists what would go, how the purgeable contacts spread over
 * creation days (to spot other import spikes), and how many contacts the
 * import guard kept.
 *
 * RUN IT FROM THE RENDER API SERVICE'S SHELL, NEVER LOCALLY. The Shell opens in
 * the server folder, so the commands there take no --prefix:
 *
 *   npm run cleanup:plunk-contacts          # dry run
 *   npm run cleanup:plunk-contacts:apply    # deletes
 *   npm run cleanup:plunk-contacts -- --protect-created=2026-02-14T23:00Z..2026-02-16T00:00Z
 *
 * It needs the production DATABASE_URL and Plunk key that are set there. Run
 * locally, the "confirmed" protection set would come from the dev database,
 * and apply would delete real subscribers' contacts from production Plunk.
 *
 * NOTE: requires the Plunk account to be ACTIVE — while it is suspended the API
 * returns 403 (PROJECT_DISABLED), so run this only after reinstatement.
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { PrismaClient } from '@prisma/client'

const PAGE_SIZE = 100
const DELETE_DELAY_MS = 200
const PURGE_MIN_AGE_DAYS = 14
const DAY_BREAKDOWN_LIMIT = 15

/** A creation-time window, half-open: start <= createdAt < end. */
export interface CreatedWindow {
  start: Date
  end: Date
}

/** The previous provider's import into Plunk: 15 Feb 2026, 01:36 Berlin. Covers that day in Berlin and in UTC. */
export const DEFAULT_PROTECTED_WINDOWS: CreatedWindow[] = [
  { start: new Date('2026-02-14T23:00:00.000Z'), end: new Date('2026-02-16T00:00:00.000Z') },
]

export interface Args {
  apply: boolean
  protectedWindows: CreatedWindow[]
}

function parseWindow(raw: string): CreatedWindow {
  const parts = raw.split('..')
  if (parts.length !== 2) throw new Error(`--protect-created expects <ISO start>..<ISO end>, got "${raw}"`)
  const [start, end] = parts.map((p) => new Date(p.trim()))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`--protect-created has an unparseable date: "${raw}"`)
  }
  if (start >= end) throw new Error(`--protect-created start must be before end: "${raw}"`)
  return { start, end }
}

/** Parse CLI flags. Throws on anything malformed or unknown, so a typo never falls back to defaults. */
export function parseArgs(argv: string[]): Args {
  let apply = false
  const windows: CreatedWindow[] = []
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true
    } else if (arg.startsWith('--protect-created=')) {
      windows.push(parseWindow(arg.slice('--protect-created='.length)))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { apply, protectedWindows: windows.length > 0 ? windows : DEFAULT_PROTECTED_WINDOWS }
}

export interface PurgeRules {
  /** Lowercased emails with a confirmed local PendingSubscription. */
  confirmedEmails: Set<string>
  /** Only contacts created before this are old enough to purge. */
  olderThan: Date
  /** Contacts created inside any of these windows are never purged (imports). */
  protectedWindows: CreatedWindow[]
}

export type ContactVerdict = 'purge' | 'subscribed' | 'confirmed' | 'no-date' | 'too-new' | 'import-window'

/**
 * Why a contact is or is not purged. A contact is purgeable only if it is
 * explicitly not subscribed, its email never confirmed locally, it was created
 * before `olderThan`, and its creation time falls in no protected window. A
 * missing or unparseable createdAt is "too new to judge" and kept. The window
 * check comes last, so 'import-window' counts exactly the contacts the import
 * guard saved from deletion.
 */
export function classifyContact(
  contact: { email: string; subscribed: boolean; createdAt?: string },
  rules: PurgeRules,
): ContactVerdict {
  if (contact.subscribed !== false) return 'subscribed'
  if (rules.confirmedEmails.has(contact.email.toLowerCase())) return 'confirmed'
  if (!contact.createdAt) return 'no-date'
  const created = new Date(contact.createdAt)
  if (Number.isNaN(created.getTime())) return 'no-date'
  if (!(created < rules.olderThan)) return 'too-new'
  if (rules.protectedWindows.some((w) => created >= w.start && created < w.end)) return 'import-window'
  return 'purge'
}

export function shouldPurgeContact(
  contact: { email: string; subscribed: boolean; createdAt?: string },
  rules: PurgeRules,
): boolean {
  return classifyContact(contact, rules) === 'purge'
}

/** Count contacts per UTC creation day, most first (ties by day), at most `limit` rows. */
export function countByCreatedDay(createdAts: string[], limit = DAY_BREAKDOWN_LIMIT): { day: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const iso of createdAts) {
    const day = new Date(iso).toISOString().slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => b.count - a.count || a.day.localeCompare(b.day))
    .slice(0, limit)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const APPLY = args.apply
  const prisma = new PrismaClient()
  const plunk = await import('../services/plunk.js')

  console.log(`Plunk contact cleanup — mode: ${APPLY ? 'APPLY (will delete)' : 'DRY RUN (no deletes)'}`)

  // Locally-confirmed emails are protected and must never be deleted.
  const confirmed = await prisma.pendingSubscription.findMany({
    where: { confirmedAt: { not: null } },
    select: { email: true },
  })
  const confirmedEmails = new Set(confirmed.map((c) => c.email.toLowerCase()))
  console.log(`Locally-confirmed emails (protected): ${confirmedEmails.size}`)

  // Only purge contacts created before this cutoff, so a brand-new signup that
  // hasn't confirmed yet is never deleted mid-flight.
  const cutoff = new Date(Date.now() - PURGE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000)
  console.log(`Age gate: only purging contacts created before ${cutoff.toISOString()} (older than ${PURGE_MIN_AGE_DAYS} days).`)
  for (const w of args.protectedWindows) {
    console.log(`Import guard: never purging contacts created ${w.start.toISOString()} .. ${w.end.toISOString()}.`)
  }

  const rules: PurgeRules = { confirmedEmails, olderThan: cutoff, protectedWindows: args.protectedWindows }

  // Page through all Plunk contacts and collect the purgeable ones.
  const purgeable: { id: string; email: string; createdAt: string }[] = []
  let importProtected = 0
  let cursor: string | undefined
  let scanned = 0

  while (true) {
    const page = await plunk.listContacts(cursor, PAGE_SIZE)
    for (const c of page.items) {
      scanned++
      const verdict = classifyContact(c, rules)
      if (verdict === 'purge') purgeable.push({ id: c.id, email: c.email, createdAt: c.createdAt as string })
      else if (verdict === 'import-window') importProtected++
    }
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }

  console.log(`Scanned ${scanned} contacts; ${purgeable.length} purgeable (unsubscribed + never confirmed locally + older than ${PURGE_MIN_AGE_DAYS} days + outside the import guard).`)
  console.log(`Kept by the import guard (would otherwise be purgeable): ${importProtected}`)

  const byDay = countByCreatedDay(purgeable.map((c) => c.createdAt))
  if (byDay.length > 0) {
    console.log(`\nPurgeable contacts by creation day (UTC), top ${DAY_BREAKDOWN_LIMIT}:`)
    for (const { day, count } of byDay) console.log(`  ${day}  ${count}`)
    console.log('')
  }

  for (const c of purgeable.slice(0, 20)) {
    console.log(`  ${APPLY ? 'DELETE' : 'would delete'}: ${c.email} (${c.id})`)
  }
  if (purgeable.length > 20) console.log(`  ... and ${purgeable.length - 20} more`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply (npm run cleanup:plunk-contacts:apply) to delete these contacts.')
    await prisma.$disconnect()
    return
  }

  let deleted = 0
  let failed = 0
  for (const c of purgeable) {
    try {
      await plunk.deleteContact(c.id)
      deleted++
      if (deleted % 50 === 0) console.log(`  deleted ${deleted}/${purgeable.length}...`)
    } catch (err) {
      failed++
      console.error(`  failed to delete ${c.email} (${c.id}):`, err instanceof Error ? err.message : err)
    }
    await new Promise((resolve) => setTimeout(resolve, DELETE_DELAY_MS))
  }

  console.log(`\nDone. Deleted: ${deleted}, Failed: ${failed}`)
  await prisma.$disconnect()
}

// Only run when executed directly (so importing the file for tests has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
