import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { recordNotice, listNotices, markNoticesSeen, markNoticeSeen, countUnseenNotices, MAX_NOTICE_MESSAGE_LENGTH } =
  await import('./adminNotices.js')
const { config } = await import('../config.js')

type RawCall = [TemplateStringsArray, ...unknown[]]

/** The n-th raw statement, its Prisma.sql fragments joined: SQL text with ? placeholders, and its bound values. */
function statement(mock: typeof mockPrisma.$executeRaw, n: number): { sql: string; values: unknown[] } {
  const [strings, ...values] = mock.mock.calls[n] as RawCall
  const query = Prisma.sql(strings, ...(values as Prisma.Sql[]))
  return { sql: query.sql.replace(/\s+/g, ' '), values: query.values }
}

const input = {
  source: 'jobs' as const,
  severity: 'warning' as const,
  title: 'Job crawl_feeds failed',
  message: 'connection timeout',
  link: '/admin/jobs',
  dedupeKey: 'job-failure:crawl_feeds',
}

describe('recordNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockResolvedValue(1)
  })

  it('folds a repeat of the key into its row: count up, new occurrence time and message, unseen again', async () => {
    await expect(recordNotice(input)).resolves.toBe(true)
    const { sql, values } = statement(mockPrisma.$executeRaw, 0)
    expect(sql).toContain('ON CONFLICT ("dedupe_key") DO UPDATE SET')
    expect(sql).toContain('"count" = "admin_notices"."count" + 1')
    expect(sql).toContain('"last_occurred_at" = (now() AT TIME ZONE \'UTC\')')
    expect(sql).toContain('"message" = EXCLUDED."message"')
    expect(sql).toContain('"severity" = EXCLUDED."severity"')
    expect(sql).toContain('"seen_at" = NULL')
    expect(values).toEqual(expect.arrayContaining(['jobs', 'warning', 'job-failure:crawl_feeds', 'connection timeout', '/admin/jobs']))
  })

  it('inserts a notice without a key as a row of its own (a null key never conflicts)', async () => {
    await recordNotice({ ...input, dedupeKey: undefined, link: undefined })
    const { values } = statement(mockPrisma.$executeRaw, 0)
    expect(values.filter(v => v === null)).toHaveLength(2)
  })

  it('with reopen: false skips a repeat entirely, so a seen row stays seen', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(0)
    await expect(recordNotice(input, { reopen: false })).resolves.toBe(false)
    const { sql } = statement(mockPrisma.$executeRaw, 0)
    expect(sql).toContain('ON CONFLICT ("dedupe_key") DO NOTHING')
    expect(sql).not.toContain('DO UPDATE')
  })

  it('refuses an unknown source or severity and writes nothing', async () => {
    await expect(recordNotice({ ...input, source: 'chat' as never })).rejects.toThrow(/source/)
    await expect(recordNotice({ ...input, severity: 'urgent' as never })).rejects.toThrow(/severity/)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('truncates the message to the maximum length', async () => {
    await recordNotice({ ...input, message: 'x'.repeat(MAX_NOTICE_MESSAGE_LENGTH + 500) })
    const { values } = statement(mockPrisma.$executeRaw, 0)
    const message = values.find(v => typeof v === 'string' && v.startsWith('xxx')) as string
    expect(message).toHaveLength(MAX_NOTICE_MESSAGE_LENGTH)
  })

  it('then prunes only seen notices older than the retention', async () => {
    await recordNotice(input)
    const { sql, values } = statement(mockPrisma.$executeRaw, 1)
    expect(sql).toContain('DELETE FROM "admin_notices"')
    expect(sql).toContain('"seen_at" IS NOT NULL')
    expect(sql).toContain('"last_occurred_at" < (now() AT TIME ZONE \'UTC\') - make_interval(days =>')
    expect(values).toContain(config.notices.retentionDays)
  })
})

describe('reading and marking notices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockResolvedValue(3)
  })

  it('markNoticesSeen with a source touches only unseen notices of that source', async () => {
    await expect(markNoticesSeen('plunk')).resolves.toBe(3)
    const { sql, values } = statement(mockPrisma.$executeRaw, 0)
    expect(sql).toContain('WHERE "seen_at" IS NULL AND "source" = ?')
    expect(values).toContain('plunk')
  })

  it('markNoticesSeen without a source touches every unseen notice', async () => {
    await markNoticesSeen()
    const { sql } = statement(mockPrisma.$executeRaw, 0)
    expect(sql).not.toContain('"source" =')
  })

  it('markNoticeSeen returns null for an unknown id', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([])
    await expect(markNoticeSeen('nope')).resolves.toBeNull()
  })

  it('listNotices filters by source and unseen, newest first, and pages by offset', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 30, unseen: 4 }])
    await expect(listNotices({ source: 'podcast', unseenOnly: true }, 2, 25)).resolves.toEqual({ items: [], total: 30, unseenCount: 4 })
    const { sql, values } = statement(mockPrisma.$queryRaw, 0)
    expect(sql).toContain('WHERE "source" = ? AND "seen_at" IS NULL')
    expect(sql).toContain('ORDER BY "last_occurred_at" DESC')
    expect(values).toEqual(['podcast', 25, 25])
  })

  it('countUnseenNotices reads zeros from an empty table', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ unseen: 0, unseenCritical: 0 }])
    await expect(countUnseenNotices()).resolves.toEqual({ unseen: 0, unseenCritical: 0 })
  })
})
