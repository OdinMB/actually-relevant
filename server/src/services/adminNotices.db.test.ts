import { describe, it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'
import { countUnseenNotices, listNotices, markNoticeSeen, markNoticesSeen, MAX_NOTICE_MESSAGE_LENGTH, recordNotice, type NoticeInput } from './adminNotices.js'

const input: NoticeInput = {
  source: 'jobs',
  severity: 'warning',
  title: 'Job crawl_feeds failed',
  message: 'connection timeout',
  link: '/admin/jobs',
  dedupeKey: 'job-failure:crawl_feeds',
}

const rows = () => prisma.adminNotice.findMany({ orderBy: { firstOccurredAt: 'asc' } })

/** A notice whose last occurrence was `days` days ago on the database clock, seen or not. */
async function oldNotice(key: string, days: number, seen: boolean) {
  await prisma.$executeRaw`
    INSERT INTO admin_notices (id, source, severity, title, message, dedupe_key, first_occurred_at, last_occurred_at, seen_at)
    VALUES (gen_random_uuid()::text, 'jobs', 'info', ${key}, 'm', ${key},
            (now() AT TIME ZONE 'UTC') - make_interval(days => ${days}::int),
            (now() AT TIME ZONE 'UTC') - make_interval(days => ${days}::int),
            CASE WHEN ${seen} THEN (now() AT TIME ZONE 'UTC') ELSE NULL END)`
}

describeDb('admin notices (PostgreSQL)', () => {
  useTestDatabase()

  describe('recordNotice', () => {
    it('folds a repeat of the key into its row: count up, latest severity and message, unseen again', async () => {
      expect(await recordNotice(input)).toBe(true)
      const [first] = await rows()
      await markNoticeSeen(first!.id)

      expect(await recordNotice({ ...input, severity: 'critical', message: 'still failing', link: null })).toBe(true)

      const after = await rows()
      expect(after).toHaveLength(1)
      expect(after[0]).toMatchObject({ id: first!.id, count: 2, severity: 'critical', message: 'still failing', link: null, seenAt: null })
      expect(after[0]!.firstOccurredAt).toEqual(first!.firstOccurredAt)
      expect(after[0]!.lastOccurredAt.getTime()).toBeGreaterThanOrEqual(first!.lastOccurredAt.getTime())
    })

    it('keeps one row for one key when two processes record it at once', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => recordNotice(input)))
      expect(results).toEqual([true, true, true, true, true])
      const after = await rows()
      expect(after).toHaveLength(1)
      expect(after[0]!.count).toBe(5)
    })

    it('inserts every notice without a key as a row of its own (a null key never conflicts)', async () => {
      await recordNotice({ ...input, dedupeKey: undefined, link: undefined })
      await recordNotice({ ...input, dedupeKey: null })
      const after = await rows()
      expect(after).toHaveLength(2)
      expect(after.map(r => r.dedupeKey)).toEqual([null, null])
      expect(after[0]!.link).toBeNull()
    })

    it('with reopen: false skips a repeat entirely, so a seen row stays seen', async () => {
      expect(await recordNotice(input, { reopen: false })).toBe(true)
      expect(await markNoticesSeen()).toBe(1)

      expect(await recordNotice({ ...input, message: 'again' }, { reopen: false })).toBe(false)

      const [row] = await rows()
      expect(row).toMatchObject({ count: 1, message: 'connection timeout' })
      expect(row!.seenAt).not.toBeNull()
    })

    it('refuses an unknown source or severity and writes nothing', async () => {
      await expect(recordNotice({ ...input, source: 'chat' as never })).rejects.toThrow(/source/)
      await expect(recordNotice({ ...input, severity: 'urgent' as never })).rejects.toThrow(/severity/)
      expect(await prisma.adminNotice.count()).toBe(0)
    })

    it('truncates the message to the maximum length', async () => {
      await recordNotice({ ...input, message: 'x'.repeat(MAX_NOTICE_MESSAGE_LENGTH + 500) })
      const [row] = await rows()
      expect(row!.message).toHaveLength(MAX_NOTICE_MESSAGE_LENGTH)
      expect(row!.message.endsWith('…')).toBe(true)
    })

    it('then prunes only seen notices last occurring longer ago than the retention', async () => {
      const days = config.notices.retentionDays
      await oldNotice('old-seen', days + 1, true)
      await oldNotice('old-unseen', days + 1, false)
      await oldNotice('recent-seen', days - 1, true)

      await recordNotice(input)

      const keys = (await rows()).map(r => r.dedupeKey).sort()
      expect(keys).toEqual(['job-failure:crawl_feeds', 'old-unseen', 'recent-seen'])
    })
  })

  describe('reading and marking notices', () => {
    async function seed() {
      await recordNotice({ ...input, dedupeKey: 'a', source: 'plunk', severity: 'critical' })
      await recordNotice({ ...input, dedupeKey: 'b', source: 'plunk' })
      await recordNotice({ ...input, dedupeKey: 'c', source: 'podcast', severity: 'critical' })
      // Back to back, two records can share a millisecond; space them a minute apart so order is a, b, c.
      await prisma.$executeRaw`
        UPDATE admin_notices
        SET first_occurred_at = (now() AT TIME ZONE 'UTC') - make_interval(mins => CASE dedupe_key WHEN 'a' THEN 3 WHEN 'b' THEN 2 ELSE 1 END),
            last_occurred_at = (now() AT TIME ZONE 'UTC') - make_interval(mins => CASE dedupe_key WHEN 'a' THEN 3 WHEN 'b' THEN 2 ELSE 1 END)`
    }

    it('markNoticesSeen with a source touches only unseen notices of that source', async () => {
      await seed()
      expect(await markNoticesSeen('plunk')).toBe(2)
      expect(await markNoticesSeen('plunk')).toBe(0)
      expect(await countUnseenNotices()).toEqual({ unseen: 1, unseenCritical: 1 })
    })

    it('markNoticesSeen without a source touches every unseen notice', async () => {
      await seed()
      expect(await markNoticesSeen()).toBe(3)
      expect(await countUnseenNotices()).toEqual({ unseen: 0, unseenCritical: 0 })
    })

    it('markNoticeSeen keeps the first seen time and returns null for an unknown id', async () => {
      await recordNotice(input)
      const [row] = await rows()
      const seen = await markNoticeSeen(row!.id)
      expect(seen).toMatchObject({ id: row!.id, dedupeKey: input.dedupeKey, count: 1 })
      expect(seen!.seenAt).toBeInstanceOf(Date)
      const again = await markNoticeSeen(row!.id)
      expect(again!.seenAt).toEqual(seen!.seenAt)
      expect(await markNoticeSeen('nope')).toBeNull()
    })

    it('listNotices filters by source and unseen, newest first, and pages by offset', async () => {
      await seed()
      await markNoticeSeen((await rows())[0]!.id)

      const plunkUnseen = await listNotices({ source: 'plunk', unseenOnly: true }, 1, 25)
      expect(plunkUnseen.items.map(n => n.dedupeKey)).toEqual(['b'])
      expect(plunkUnseen).toMatchObject({ total: 1, unseenCount: 1 })

      const all = await listNotices({}, 1, 2)
      expect(all.items.map(n => n.dedupeKey)).toEqual(['c', 'b'])
      expect(all).toMatchObject({ total: 3, unseenCount: 2 })
      expect((await listNotices({}, 2, 2)).items.map(n => n.dedupeKey)).toEqual(['a'])
    })

    it('countUnseenNotices reads zeros from an empty table', async () => {
      expect(await countUnseenNotices()).toEqual({ unseen: 0, unseenCritical: 0 })
    })
  })
})
