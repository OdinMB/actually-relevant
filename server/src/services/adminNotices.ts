/**
 * The `admin_notices` table (ADR-0028, `.context/admin-notices.md`): every owner alert, shown in the
 * admin with an unseen badge. Recording folds a repeat of a dedupe key into its one row and reopens
 * it (or, insert-only, skips it), and prunes old seen rows; the rest lists, counts and marks seen.
 *
 * Raw SQL throughout: the dedupe rule is one `INSERT … ON CONFLICT` statement, so two processes
 * cannot create two rows for one key, and the other queries share its column list.
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'

export const NOTICE_SOURCES = ['jobs', 'newsletter', 'podcast', 'subscriptions', 'plunk'] as const
export type NoticeSource = (typeof NOTICE_SOURCES)[number]

export const NOTICE_SEVERITIES = ['critical', 'warning', 'info'] as const
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number]

/** Job errors can carry Prisma meta; a notice keeps at most this much of a message. */
export const MAX_NOTICE_MESSAGE_LENGTH = 2000

export interface NoticeInput {
  source: NoticeSource
  severity: NoticeSeverity
  title: string
  message: string
  /** A relative admin path such as `/admin/podcasts/<id>`. */
  link?: string | null
  /** A repeat of the key updates its one row instead of adding another. */
  dedupeKey?: string | null
}

export interface AdminNotice {
  id: string
  source: NoticeSource
  severity: NoticeSeverity
  title: string
  message: string
  link: string | null
  dedupeKey: string | null
  count: number
  firstOccurredAt: Date
  lastOccurredAt: Date
  seenAt: Date | null
}

export interface RecordOptions {
  /**
   * true (default): a repeat of the key raises its count and makes it unseen again.
   * false: a repeat changes nothing, for events that are recorded once and never reopened.
   */
  reopen?: boolean
}

export function isNoticeSource(value: unknown): value is NoticeSource {
  return typeof value === 'string' && (NOTICE_SOURCES as readonly string[]).includes(value)
}

export function isNoticeSeverity(value: unknown): value is NoticeSeverity {
  return typeof value === 'string' && (NOTICE_SEVERITIES as readonly string[]).includes(value)
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_NOTICE_MESSAGE_LENGTH) return message
  return `${message.slice(0, MAX_NOTICE_MESSAGE_LENGTH - 1)}…`
}

const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`

const COLUMNS = Prisma.sql`
  "id", "source", "severity", "title", "message", "link",
  "dedupe_key" AS "dedupeKey", "count",
  "first_occurred_at" AS "firstOccurredAt", "last_occurred_at" AS "lastOccurredAt", "seen_at" AS "seenAt"`

/**
 * Record a notice and prune old seen ones. Returns whether a row was written: false only for an
 * insert-only repeat (`reopen: false`) that was skipped. Throws for an unknown source or severity.
 */
export async function recordNotice(input: NoticeInput, { reopen = true }: RecordOptions = {}): Promise<boolean> {
  if (!isNoticeSource(input.source)) throw new Error(`unknown notice source: ${String(input.source)}`)
  if (!isNoticeSeverity(input.severity)) throw new Error(`unknown notice severity: ${String(input.severity)}`)

  const message = truncateMessage(input.message)
  const link = input.link ?? null
  const dedupeKey = input.dedupeKey ?? null
  const onConflict = reopen
    ? Prisma.sql`DO UPDATE SET
        "count" = "admin_notices"."count" + 1,
        "last_occurred_at" = ${NOW_UTC},
        "severity" = EXCLUDED."severity",
        "title" = EXCLUDED."title",
        "message" = EXCLUDED."message",
        "link" = EXCLUDED."link",
        "seen_at" = NULL`
    : Prisma.sql`DO NOTHING`

  const written = await prisma.$executeRaw`
    INSERT INTO "admin_notices" ("id", "source", "severity", "title", "message", "link", "dedupe_key",
                                 "count", "first_occurred_at", "last_occurred_at")
    VALUES (gen_random_uuid()::text, ${input.source}, ${input.severity}, ${input.title}, ${message}, ${link},
            ${dedupeKey}, 1, ${NOW_UTC}, ${NOW_UTC})
    ON CONFLICT ("dedupe_key") ${onConflict}`

  await pruneSeenNotices()
  return written > 0
}

/** Delete seen notices last seen to occur longer ago than the retention; unseen ones are kept. */
async function pruneSeenNotices(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "admin_notices"
    WHERE "seen_at" IS NOT NULL
      AND "last_occurred_at" < ${NOW_UTC} - make_interval(days => ${config.notices.retentionDays}::int)`
}

export interface NoticeFilter {
  source?: NoticeSource
  unseenOnly?: boolean
}

function whereClause({ source, unseenOnly }: NoticeFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = []
  if (source) conditions.push(Prisma.sql`"source" = ${source}`)
  if (unseenOnly) conditions.push(Prisma.sql`"seen_at" IS NULL`)
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
}

/** One page of notices, newest occurrence first, with the total and the unseen count under the source filter. */
export async function listNotices(
  filter: NoticeFilter,
  page: number,
  limit: number,
): Promise<{ items: AdminNotice[]; total: number; unseenCount: number }> {
  const offset = (page - 1) * limit
  const [items, totals] = await Promise.all([
    prisma.$queryRaw<AdminNotice[]>`
      SELECT ${COLUMNS} FROM "admin_notices" ${whereClause(filter)}
      ORDER BY "last_occurred_at" DESC, "id"
      LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: number; unseen: number }[]>`
      SELECT COUNT(*)::int AS "total", COUNT(*) FILTER (WHERE "seen_at" IS NULL)::int AS "unseen"
      FROM "admin_notices" ${whereClause(filter)}`,
  ])
  return { items, total: totals[0]?.total ?? 0, unseenCount: totals[0]?.unseen ?? 0 }
}

/** The badge: unseen notices, and how many of them are critical. */
export async function countUnseenNotices(): Promise<{ unseen: number; unseenCritical: number }> {
  const rows = await prisma.$queryRaw<{ unseen: number; unseenCritical: number }[]>`
    SELECT COUNT(*)::int AS "unseen", COUNT(*) FILTER (WHERE "severity" = 'critical')::int AS "unseenCritical"
    FROM "admin_notices" WHERE "seen_at" IS NULL`
  return { unseen: rows[0]?.unseen ?? 0, unseenCritical: rows[0]?.unseenCritical ?? 0 }
}

/** Mark one notice seen (kept as first seen if it already was); null for an unknown id. */
export async function markNoticeSeen(id: string): Promise<AdminNotice | null> {
  const rows = await prisma.$queryRaw<AdminNotice[]>`
    UPDATE "admin_notices" SET "seen_at" = COALESCE("seen_at", ${NOW_UTC})
    WHERE "id" = ${id}
    RETURNING ${COLUMNS}`
  return rows[0] ?? null
}

/** Mark every unseen notice seen, or only those of one source; returns how many changed. */
export async function markNoticesSeen(source?: NoticeSource): Promise<number> {
  const sourceCondition = source ? Prisma.sql`AND "source" = ${source}` : Prisma.empty
  return prisma.$executeRaw`
    UPDATE "admin_notices" SET "seen_at" = ${NOW_UTC}
    WHERE "seen_at" IS NULL ${sourceCondition}`
}
