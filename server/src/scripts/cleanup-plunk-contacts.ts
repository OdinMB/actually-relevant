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
 * Dry-run by default — pass --apply to actually delete.
 *
 *   npm run cleanup:plunk-contacts --prefix server          # dry run (lists what would go)
 *   npm run cleanup:plunk-contacts:apply --prefix server    # deletes
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

const APPLY = process.argv.includes('--apply')
const PAGE_SIZE = 100
const DELETE_DELAY_MS = 200
const PURGE_MIN_AGE_DAYS = 14

/**
 * A contact is purgeable if it is explicitly not subscribed, its email never
 * confirmed locally, AND it was created before `olderThan` (the age cutoff).
 * This protects confirmed subscribers and confirmed-then-unsubscribed users,
 * and never deletes a recent signup that simply hasn't confirmed yet, while
 * removing aged never-confirmed (bot) contacts. A missing or unparseable
 * createdAt is treated as "too new to judge" and kept.
 */
export function shouldPurgeContact(
  contact: { email: string; subscribed: boolean; createdAt?: string },
  confirmedEmails: Set<string>,
  olderThan: Date,
): boolean {
  if (contact.subscribed !== false) return false
  if (confirmedEmails.has(contact.email.toLowerCase())) return false
  if (!contact.createdAt) return false
  const created = new Date(contact.createdAt)
  if (Number.isNaN(created.getTime())) return false
  return created < olderThan
}

async function main() {
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

  // Page through all Plunk contacts and collect the purgeable ones.
  const purgeable: { id: string; email: string }[] = []
  let cursor: string | undefined
  let scanned = 0

  while (true) {
    const page = await plunk.listContacts(cursor, PAGE_SIZE)
    for (const c of page.items) {
      scanned++
      if (shouldPurgeContact(c, confirmedEmails, cutoff)) {
        purgeable.push({ id: c.id, email: c.email })
      }
    }
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }

  console.log(`Scanned ${scanned} contacts; ${purgeable.length} purgeable (unsubscribed + never confirmed locally + older than ${PURGE_MIN_AGE_DAYS} days).`)

  for (const c of purgeable.slice(0, 20)) {
    console.log(`  ${APPLY ? 'DELETE' : 'would delete'}: ${c.email} (${c.id})`)
  }
  if (purgeable.length > 20) console.log(`  ... and ${purgeable.length - 20} more`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply (cleanup:plunk-contacts:apply) to delete these contacts.')
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
