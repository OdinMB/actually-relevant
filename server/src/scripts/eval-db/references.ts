/**
 * The eval copy's foreign keys (`.context/database-migrations.md`, "A Stories-Only Copy for Cloud
 * Evals"): read from the database being copied, so the copy follows every key it has, and the guard
 * that holds each row on its way out to them: every reference the copy carries points at a row the
 * copy holds. `selection.ts` closes a window's rows over these keys; the guard catches what no
 * closure can reach (a run or pass whose story is gone) and writes it as null where the column
 * allows, or refuses the export.
 */
import type { SelectDb } from '../eval/readOnlyDb.js'
import type { Row } from './scrub.js'

export interface ForeignKey {
  table: string
  column: string
  /** The table it points at, and the column there (its key). */
  target: string
  targetColumn: string
  nullable: boolean
}

/** A reference the copy cannot carry: a required one pointing outside it. */
export class DanglingReference extends Error {}

/** The single-column foreign keys of `tables`, from the database's own catalog. Refuses a key of several columns, which the guard cannot hold. */
export async function foreignKeys(db: SelectDb, tables: readonly string[]): Promise<ForeignKey[]> {
  const rows = await db.$queryRaw<(ForeignKey & { columns: number })[]>`
    SELECT src.relname::text AS "table", sa.attname::text AS "column", dst.relname::text AS target,
           da.attname::text AS "targetColumn", NOT sa.attnotnull AS nullable, cardinality(c.conkey)::int AS columns
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class dst ON dst.oid = c.confrelid
    JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = c.conkey[1]
    JOIN pg_attribute da ON da.attrelid = c.confrelid AND da.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND src.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
      AND src.relname = ANY(${[...tables]}::text[])
    ORDER BY 1, 2`
  const wide = rows.filter(r => r.columns !== 1)
  if (wide.length > 0) throw new Error(`the copy holds single-column foreign keys only: ${wide.map(r => `${r.table}.${r.column}`).join(', ')}`)
  return rows.map(({ columns: _columns, ...fk }) => fk)
}

/**
 * Holds rows, in load order, to the foreign keys: a reference to an earlier table is checked as its
 * row comes; one to its own table or a later one (a deferred column) once every row is in (`finish`).
 * A reference to a row outside the copy is written as null where the column allows it (counted in
 * `nulled`, per `table.column`) and refuses the export where it does not.
 */
export class ReferenceGuard {
  readonly nulled = new Map<string, number>()
  private readonly from = new Map<string, ForeignKey[]>()
  /** Per `table.column` some key points at: the values the copy holds. */
  private readonly held = new Map<string, Set<string>>()
  private readonly pending: { fk: ForeignKey; value: string }[] = []

  constructor(
    keys: readonly ForeignKey[],
    private readonly order: readonly string[],
  ) {
    for (const fk of keys) {
      this.from.set(fk.table, [...(this.from.get(fk.table) ?? []), fk])
      this.held.set(`${fk.target}.${fk.targetColumn}`, new Set())
    }
  }

  /** The row as the copy carries it. */
  admit(table: string, row: Row): Row {
    const own = this.order.indexOf(table)
    let out = row
    for (const fk of this.from.get(table) ?? []) {
      const value = row[fk.column]
      if (value === null || value === undefined) continue
      const target = this.order.indexOf(fk.target)
      if (target >= own) {
        this.pending.push({ fk, value: String(value) })
        continue
      }
      if (this.holds(fk, String(value))) continue
      if (!fk.nullable) throw new DanglingReference(`${table}.${fk.column} points at a row of ${fk.target} the copy does not hold, and cannot be null`)
      out = { ...out, [fk.column]: null }
      this.nulled.set(`${table}.${fk.column}`, (this.nulled.get(`${table}.${fk.column}`) ?? 0) + 1)
    }
    for (const [key, values] of this.held) {
      const [of, column] = key.split('.') as [string, string]
      if (of === table && out[column] !== null && out[column] !== undefined) values.add(String(out[column]))
    }
    return out
  }

  /** Refuses the copy if a reference checked at the end points outside it. */
  finish(): void {
    const outside = new Map<string, number>()
    for (const { fk, value } of this.pending) {
      if (!this.holds(fk, value)) outside.set(`${fk.table}.${fk.column}`, (outside.get(`${fk.table}.${fk.column}`) ?? 0) + 1)
    }
    if (outside.size > 0) {
      throw new DanglingReference(`the copy has references to rows it does not hold: ${[...outside].map(([column, n]) => `${column} (${n})`).join(', ')}`)
    }
  }

  private holds(fk: ForeignKey, value: string): boolean {
    return this.held.get(`${fk.target}.${fk.targetColumn}`)?.has(value) ?? false
  }
}
