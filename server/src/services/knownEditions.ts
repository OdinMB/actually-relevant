/**
 * Which newsletter edition each subscriber is known to be on here, without asking Plunk (ADR-0052,
 * `.context/subscription.md`, "Editions"): what the closed-editions guard reads (`editionAudience`).
 * Plunk holds the edition, its contact field `edition`, and the two writes that set it each leave a
 * trace here: confirming a signup its `pending_subscriptions` row (edition, Plunk contact id, confirm
 * time), and the footer switch one `edition_switches` row per contact, its latest switch. A contact's
 * latest known edition is the newer of the two. Wherever the record cannot tell, it errs toward
 * Actually Uplifting, so the guard refuses rather than send the full issue to someone on it: a tie,
 * a confirmed Uplifting signup whose contact id never came back, and (`editionSwitch.ts`) a switch to
 * Actually Uplifting recorded before Plunk is written. Unsubscribes are not seen: a reader who left
 * while on Actually Uplifting still counts.
 */
import type { NewsletterEdition, Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'

/** Record a contact's switch, keeping its latest only. The id is Plunk's; no address is stored. */
export async function recordSwitch(plunkContactId: string, edition: NewsletterEdition): Promise<void> {
  const switchedAt = new Date()
  await prisma.editionSwitch.upsert({
    where: { plunkContactId },
    create: { plunkContactId, edition, switchedAt },
    update: { edition, switchedAt },
  })
}

/** Whether any subscriber's latest known edition is Actually Uplifting, as the module comment reads it. */
export async function anyoneOnUplifting(db: Prisma.TransactionClient = prisma): Promise<boolean> {
  const [result] = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pending_subscriptions
      WHERE confirmed_at IS NOT NULL AND plunk_contact_id IS NULL AND edition = 'uplifting'
    ) OR EXISTS (
      SELECT 1 FROM (
        SELECT DISTINCT ON (contact_id) edition
        FROM (
          SELECT plunk_contact_id AS contact_id, edition, confirmed_at AS known_at
          FROM pending_subscriptions
          WHERE confirmed_at IS NOT NULL AND plunk_contact_id IS NOT NULL
          UNION ALL
          SELECT plunk_contact_id, edition, switched_at FROM edition_switches
        ) known
        ORDER BY contact_id, known_at DESC, edition = 'uplifting' DESC
      ) latest
      WHERE edition = 'uplifting'
    ) AS found`
  return result?.found === true
}
