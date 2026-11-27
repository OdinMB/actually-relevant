/**
 * The eval copy's classification held against `prisma/schema.prisma` (`.context/database-migrations.md`,
 * "A Stories-Only Copy for Cloud Evals"): a table or column the schema gains fails here until
 * `tables.ts` names it, so a new column holding personal data cannot reach the copy unseen.
 */
import { describe, it, expect } from 'vitest'
import { parsePrismaSchema, readPrismaSchema } from '../../test/prismaSchema.js'
import { EXCLUDED_TABLES, EXPORTED_TABLES } from './tables.js'

const schema = readPrismaSchema()
const schemaTable = (name: string) => {
  const t = schema.find(s => s.table === name)
  if (!t) throw new Error(`no table ${name} in the schema`)
  return t
}
const exported = EXPORTED_TABLES.map(t => t.table)

/** The owner's never list (2026-11-26): these stay out of the copy, whatever else changes. */
const NEVER = [
  'users',
  'refresh_tokens',
  'pending_subscriptions',
  'feedback',
  'admin_notices',
  'newsletter_sends',
  'newsletters',
  'podcasts',
  'podcast_audio_chunks',
  'podcast_tts_usage',
  'podcast_missed_week_alerts',
  'job_runs',
  'job_month_spend',
  'spend_warnings',
  'bluesky_posts',
  'mastodon_posts',
  'edition_switches',
]

describe('the eval copy against the schema', () => {
  it('names every table of the schema once, as exported or left out', () => {
    const named = [...exported, ...Object.keys(EXCLUDED_TABLES)]
    expect([...named].sort()).toEqual(schema.map(t => t.table).sort())
    expect(new Set(named).size).toBe(named.length)
  })

  it("keeps the owner's never list out", () => {
    for (const table of NEVER) {
      expect(exported, table).not.toContain(table)
      expect(Object.keys(EXCLUDED_TABLES), table).toContain(table)
    }
  })

  it('classifies every column of every exported table, each once, and no column the table lacks', () => {
    for (const t of EXPORTED_TABLES) {
      const classified = [...t.keep, ...Object.keys(t.scrub)]
      expect([...classified].sort(), t.table).toEqual(
        schemaTable(t.table)
          .columns.map(c => c.name)
          .sort(),
      )
      expect(new Set(classified).size, t.table).toBe(classified.length)
    }
  })

  it('scrubs every column whose name says it can name a person', () => {
    /** Columns whose name reads like a person's but holds none, each checked against the code. */
    const NAMES_NO_PERSON: Record<string, string> = { 'pool_facts.contradicted_by': 'the refs of the newer facts that contradict it' }
    for (const t of EXPORTED_TABLES) {
      const personal = schemaTable(t.table)
        .columns.map(c => c.name)
        .filter(n => /_by$|^actor$|email|^user_?id$/.test(n) && !(`${t.table}.${n}` in NAMES_NO_PERSON))
      for (const column of personal) expect(t.keep, `${t.table}.${column}`).not.toContain(column)
    }
  })

  it('loads each table after the tables its foreign keys name, deferring only nullable columns that close a cycle', () => {
    EXPORTED_TABLES.forEach((t, i) => {
      const s = schemaTable(t.table)
      const forward = s.foreignKeys.filter(fk => {
        expect(EXCLUDED_TABLES, `${t.table} → ${fk.table}`).not.toHaveProperty(fk.table)
        return exported.indexOf(fk.table) >= i
      })
      expect([...t.deferred].sort(), t.table).toEqual(forward.flatMap(fk => fk.columns).sort())
      for (const column of t.deferred) expect(s.columns.find(c => c.name === column)?.optional, `${t.table}.${column}`).toBe(true)
    })
  })

  it("selects each windowed table's rows by its owner: a story, cluster or overview, through a foreign key to it", () => {
    const ruleOf = (table: string) => EXPORTED_TABLES.find(t => t.table === table)?.rows
    for (const t of EXPORTED_TABLES) {
      const s = schemaTable(t.table)
      const { rows } = t
      if (rows === 'all') continue
      if ('since' in rows) {
        expect(s.columns.find(c => c.name === rows.since)?.type, t.table).toBe('DateTime')
        continue
      }
      // The owner table holds the ids the copy selects, and selects itself by its key
      const owner = EXPORTED_TABLES.find(o => o.table === rows.in)
      expect(owner, t.table).toBeDefined()
      expect(ruleOf(rows.in), t.table).toEqual({ in: rows.in, column: owner!.key })
      if (t.table !== rows.in) expect(s.foreignKeys, t.table).toContainEqual({ columns: [rows.column], table: rows.in })
      if (rows.orStory) expect(s.foreignKeys, t.table).toContainEqual({ columns: [rows.orStory], table: 'stories' })
    }
  })

  it('holds every row only of tables that point at no story, cluster or overview', () => {
    const owners = ['stories', 'story_clusters', 'overviews']
    for (const t of EXPORTED_TABLES) {
      if (t.rows !== 'all') continue
      expect(
        schemaTable(t.table).foreignKeys.filter(fk => owners.includes(fk.table)),
        t.table,
      ).toEqual([])
    }
  })

  it('reads each exported table by one text key', () => {
    for (const t of EXPORTED_TABLES) {
      const key = schemaTable(t.table).columns.find(c => c.name === t.key)
      expect(key?.type, t.table).toBe('String')
      expect(key?.optional || key?.list, t.table).toBe(false)
    }
  })

  it('the schema reader sees mapped columns, unsupported types and foreign keys, and no relation field as a column', () => {
    const [parent, child] = parsePrismaSchema(`
model Parent {
  id    String  @id
  kids  Child[]
  @@map("parents")
}

model Child {
  id        String  @id // an inline comment
  parentId  String? @map("parent_id")
  parent    Parent? @relation(fields: [parentId], references: [id])
  vector    Unsupported("vector(3)")
  tags      String[] @default([])
  url       String  @default("https://example.org//x")
}
`)
    expect(parent).toEqual({
      model: 'Parent',
      table: 'parents',
      columns: [{ name: 'id', field: 'id', type: 'String', optional: false, list: false }],
      foreignKeys: [],
    })
    expect(child!.table).toBe('Child')
    expect(child!.columns.map(c => [c.name, c.type, c.optional, c.list])).toEqual([
      ['id', 'String', false, false],
      ['parent_id', 'String', true, false],
      ['vector', 'Unsupported("vector(3)")', false, false],
      ['tags', 'String', false, true],
      ['url', 'String', false, false],
    ])
    expect(child!.foreignKeys).toEqual([{ columns: ['parent_id'], table: 'parents' }])
  })
})
