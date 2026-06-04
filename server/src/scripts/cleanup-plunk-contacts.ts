/**
 * Clean up bot / never-confirmed contacts from Plunk.
 *
 * The OLD signup flow created a Plunk contact (subscribed:false) for every
 * submission — including the bot flood that polluted the list and likely
 * contributed to the account suspension. This script removes Plunk contacts
 * that are NOT subscribed AND have no confirmed local PendingSubscription, i.e.
 * the never-confirmed pollution. Confirmed subscribers (subscribed:true) and
 * anyone who ever confirmed locally (even if later unsubscribed) are never
 * touched.
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

/**
 * A contact is purgeable if it is explicitly not subscribed AND its email never
 * confirmed locally. This protects confirmed subscribers and confirmed-then-
 * unsubscribed users, while removing never-confirmed (bot) contacts.
 */
export function shouldPurgeContact(
  contact: { email: string; subscribed: boolean },
  confirmedEmails: Set<string>,
): boolean {
  if (contact.subscribed !== false) return false
  return !confirmedEmails.has(contact.email.toLowerCase())
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

  // Page through all Plunk contacts and collect the purgeable ones.
  const purgeable: { id: string; email: string }[] = []
  let cursor: string | undefined
  let scanned = 0

  while (true) {
    const page = await plunk.listContacts(cursor, PAGE_SIZE)
    for (const c of page.items) {
      scanned++
      if (shouldPurgeContact(c, confirmedEmails)) {
        purgeable.push({ id: c.id, email: c.email })
      }
    }
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }

  console.log(`Scanned ${scanned} contacts; ${purgeable.length} purgeable (unsubscribed + never confirmed locally).`)

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
