/**
 * Each subscriber's latest known edition against PostgreSQL (`knownEditions.ts`): what the
 * closed-editions guard reads, from confirmed signups and footer switches, the newer per contact.
 */
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import type { NewsletterEdition } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'

const { anyoneOnUplifting, recordSwitch } = await import('./knownEditions.js')

const at = (iso: string) => new Date(iso)

function signup(edition: NewsletterEdition, opts: { contactId?: string | null; confirmedAt?: Date | null } = {}) {
  return prisma.pendingSubscription.create({
    data: {
      email: 'reader@example.com',
      token: randomUUID(),
      edition,
      plunkContactId: opts.contactId === undefined ? 'contact-1' : opts.contactId,
      confirmedAt: opts.confirmedAt === undefined ? at('2026-11-01T10:00:00Z') : opts.confirmedAt,
      expiresAt: at('2026-12-01T00:00:00Z'),
    },
  })
}

const switched = (edition: NewsletterEdition, switchedAt: Date, plunkContactId = 'contact-1') =>
  prisma.editionSwitch.create({ data: { plunkContactId, edition, switchedAt } })

describeDb('known editions', () => {
  useTestDatabase()

  describe('anyoneOnUplifting', () => {
    it('is false with nobody on record, and with only full-edition readers', async () => {
      expect(await anyoneOnUplifting()).toBe(false)
      await signup('full')
      await switched('full', at('2026-11-02T10:00:00Z'), 'contact-2')
      expect(await anyoneOnUplifting()).toBe(false)
    })

    it('counts a confirmed signup for Actually Uplifting, not an unconfirmed one', async () => {
      await signup('uplifting', { confirmedAt: null })
      expect(await anyoneOnUplifting()).toBe(false)
      await signup('uplifting', { contactId: 'contact-2' })
      expect(await anyoneOnUplifting()).toBe(true)
    })

    it('counts a confirmed Actually Uplifting signup whose Plunk contact id never came back, since Plunk may have applied it', async () => {
      await signup('uplifting', { contactId: null })
      await switched('full', at('2026-11-05T10:00:00Z'))
      expect(await anyoneOnUplifting()).toBe(true)
    })

    it('reads a footer switch made after the signup over the signup, both ways', async () => {
      await signup('uplifting')
      await switched('full', at('2026-11-02T10:00:00Z'))
      expect(await anyoneOnUplifting()).toBe(false)

      await signup('full', { contactId: 'contact-2' })
      await switched('uplifting', at('2026-11-02T10:00:00Z'), 'contact-2')
      expect(await anyoneOnUplifting()).toBe(true)
    })

    it("reads a returning reader's newer signup over an earlier switch and an earlier signup", async () => {
      await signup('uplifting', { confirmedAt: at('2026-10-01T10:00:00Z') })
      await switched('uplifting', at('2026-10-05T10:00:00Z'))
      await signup('full', { confirmedAt: at('2026-11-01T10:00:00Z') })
      expect(await anyoneOnUplifting()).toBe(false)
    })

    it('reads a tie as Actually Uplifting', async () => {
      await signup('full', { confirmedAt: at('2026-11-01T10:00:00Z') })
      await switched('uplifting', at('2026-11-01T10:00:00Z'))
      expect(await anyoneOnUplifting()).toBe(true)
    })
  })

  describe('recordSwitch', () => {
    it('keeps one row per contact, its latest switch, and never an address', async () => {
      await recordSwitch('contact-1', 'uplifting')
      await recordSwitch('contact-1', 'full')

      const rows = await prisma.editionSwitch.findMany()
      expect(rows).toEqual([{ plunkContactId: 'contact-1', edition: 'full', switchedAt: expect.any(Date) }])
    })
  })
})
