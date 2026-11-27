/**
 * Which rows a windowed eval copy holds (`.context/database-migrations.md`, "A Stories-Only Copy for
 * Cloud Evals"), worked out inside the export's snapshot with SELECTs only: the stories the pipeline
 * first saw in the window (`date_crawled`), closed over what the evals need and over every foreign key,
 * until nothing more joins. Each table's rows then follow its rule in `tables.ts` (`rowFilter`). The
 * session is read-only, so the ids travel as array parameters (`= ANY`), never in a temporary table.
 */
import { Prisma } from '@prisma/client'
import type { Db } from '../eval/readOnlyDb.js'
import { ident } from './database.js'
import type { ForeignKey } from './references.js'
import type { ExportedTable, OwnerTable, RowRule } from './tables.js'

export interface Selection {
  since: Date
  /** The ids the copy holds of each owner table. */
  ids: Record<OwnerTable, string[]>
  /** The stories first seen in the window, before the closure added the older ones. */
  inWindow: number
}

type Owned = Exclude<RowRule, 'all' | { since: string }>
const owned = (rule: RowRule): Owned | null => (rule === 'all' || 'since' in rule ? null : rule)

const ids = (values: Iterable<string>): Prisma.Sql => Prisma.sql`${[...values]}::text[]`

/** The condition a table's rows meet in the copy, as SQL on the alias `t`; null for every row. */
export function rowFilter(t: ExportedTable, s: Pick<Selection, 'since' | 'ids'>): Prisma.Sql | null {
  if (t.rows === 'all') return null
  if ('since' in t.rows) return Prisma.sql`t.${ident(t.rows.since)} >= ${s.since}`
  const own = Prisma.sql`t.${ident(t.rows.column)} = ANY(${ids(s.ids[t.rows.in])})`
  if (!t.rows.orStory) return own
  return Prisma.sql`(${own} OR (t.${ident(t.rows.column)} IS NULL AND t.${ident(t.rows.orStory)} = ANY(${ids(s.ids.stories)})))`
}

/**
 * What the evals need beyond the foreign keys, each the reverse of one: every overview a story of the
 * copy has an entry in (its whole timeline then follows, through the entries' stories), and every
 * member of a cluster of the copy (the dedup eval compares a story with its cluster).
 */
const MEMBERSHIPS: readonly { adds: OwnerTable; table: string; sql: (s: Selection['ids']) => Prisma.Sql }[] = [
  {
    adds: 'overviews',
    table: 'overview_entries',
    sql: s => Prisma.sql`SELECT DISTINCT overview_id AS id FROM overview_entries WHERE story_id = ANY(${ids(s.stories)})`,
  },
  { adds: 'stories', table: 'stories', sql: s => Prisma.sql`SELECT id FROM stories WHERE cluster_id = ANY(${ids(s.story_clusters)})` },
]

/**
 * The owners of the rows a foreign key's values in the copy point at, so that they join it: a
 * story-owned row brings its story, a cluster or overview itself, a decision its overview (or with
 * none, its story). Null when there is nothing to close over: the target table has no owner (it
 * holds every row, or the rows its window dates), or the key is the column the table is selected by
 * and names the owner table itself. What stays outside is the guard's (`references.ts`).
 */
function closure(fk: ForeignKey, byTable: ReadonlyMap<string, ExportedTable>, s: Selection): { sql: Prisma.Sql; rule: Owned } | null {
  const from = byTable.get(fk.table)
  const to = byTable.get(fk.target)
  const rule = to && owned(to.rows)
  if (!from || !rule) return null
  const own = owned(from.rows)
  if (own && own.column === fk.column && own.in === rule.in && rule.column === fk.targetColumn) return null
  const where = rowFilter(from, s)
  const story = rule.orStory ? Prisma.sql`, u.${ident(rule.orStory)} AS story` : Prisma.empty
  return {
    rule,
    sql: Prisma.sql`SELECT DISTINCT u.${ident(rule.column)} AS id${story} FROM ${ident(fk.target)} u
      WHERE u.${ident(fk.targetColumn)} IN (SELECT t.${ident(fk.column)} FROM ${ident(fk.table)} t ${where ? Prisma.sql`WHERE ${where}` : Prisma.empty})`,
  }
}

/** The copy's ids, from the stories first seen since `since`, closed over `tables`' rules and `keys`. */
export async function selectRows(db: Db, tables: readonly ExportedTable[], keys: readonly ForeignKey[], since: Date): Promise<Selection> {
  const byTable = new Map(tables.map(t => [t.table, t]))
  const seed = await db.$queryRaw<{ id: string }[]>`SELECT id FROM stories WHERE date_crawled >= ${since}`
  const sets: Record<OwnerTable, Set<string>> = { stories: new Set(seed.map(r => r.id)), story_clusters: new Set(), overviews: new Set() }
  const current = (): Selection => ({
    since,
    inWindow: seed.length,
    ids: { stories: [...sets.stories], story_clusters: [...sets.story_clusters], overviews: [...sets.overviews] },
  })
  /** 1 when the id joins the copy, 0 when it holds it already or there is none. */
  const add = (owner: OwnerTable, id: string | null | undefined): number => {
    if (id === null || id === undefined || sets[owner].has(id)) return 0
    sets[owner].add(id)
    return 1
  }
  let joined: number
  do {
    joined = 0
    for (const m of MEMBERSHIPS) {
      if (!byTable.has(m.table)) continue
      for (const r of await db.$queryRaw<{ id: string | null }[]>(m.sql(current().ids))) joined += add(m.adds, r.id)
    }
    for (const fk of keys) {
      const c = closure(fk, byTable, current())
      if (!c) continue
      for (const r of await db.$queryRaw<{ id: string | null; story?: string | null }[]>(c.sql)) {
        joined += r.id !== null ? add(c.rule.in, r.id) : add('stories', r.story)
      }
    }
  } while (joined > 0)
  return current()
}
