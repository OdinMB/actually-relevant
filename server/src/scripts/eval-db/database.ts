/**
 * The SQL the eval copy's export and import share: a quoted name, the columns of tables, and the
 * newest migration a database has applied.
 */
import { Prisma } from '@prisma/client'
import type { SelectDb } from '../eval/readOnlyDb.js'

/** A table or column name as SQL, quoted. Only names from `tables.ts` or the database's own catalog reach it. */
export const ident = (name: string): Prisma.Sql => Prisma.raw(`"${name.replace(/"/g, '""')}"`)

/** Each of `tables`' columns in the current schema, in their order; a table the database lacks is absent. */
export async function tableColumns(db: SelectDb, tables: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name::text AS table_name, column_name::text AS column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ANY(${[...tables]}::text[])
    ORDER BY table_name, ordinal_position`
  const out = new Map<string, string[]>()
  for (const r of rows) out.set(r.table_name, [...(out.get(r.table_name) ?? []), r.column_name])
  return out
}

/** The newest migration the database has applied, or null for none. */
export async function newestMigration(db: SelectDb): Promise<string | null> {
  const rows = await db.$queryRaw<{ name: string }[]>`
    SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`
  return rows[0]?.name ?? null
}
