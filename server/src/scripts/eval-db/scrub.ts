/**
 * The scrub the eval copy applies on the way out (`tables.ts` says which columns): an editor's user
 * id, or any value that is not one of automation's markers, never leaves the machine. The markers
 * stay, because code branches on them (`recenteredBy === 'editor'`, `detachedBy === 'review'`), and
 * the placeholder is `editor`, the marker an editor's action already writes where it names no one.
 */
import type { ExportedTable, ScrubRule } from './tables.js'

export type Row = Record<string, unknown>

/** The values an actor column holds that name no person. */
export const SYSTEM_ACTORS: ReadonlySet<string> = new Set(['pipeline', 'review', 'recenter', 'burst', 'editor'])
export const ACTOR_PLACEHOLDER = 'editor'

/** The keys under which a stored JSON value (an overview decision's change set) names who acted. */
const ACTOR_KEYS: ReadonlySet<string> = new Set([
  'actor',
  'undoneBy',
  'undone_by',
  'detachedBy',
  'detached_by',
  'frozenBy',
  'frozen_by',
  'recenteredBy',
  'recentered_by',
  'joinedBy',
  'joined_by',
])

/** A column or row the classification does not name: the copy refuses it rather than carry it unscrubbed. */
export class UnclassifiedColumns extends Error {}

/** A system marker or null as it is; anything else the placeholder. */
export const scrubActor = (value: unknown): unknown => (value === null || (typeof value === 'string' && SYSTEM_ACTORS.has(value)) ? value : ACTOR_PLACEHOLDER)

/** The value with every actor key's value scrubbed, at any depth. */
export function scrubActorsInJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubActorsInJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ACTOR_KEYS.has(k) ? scrubActor(v) : scrubActorsInJson(v)]))
}

const RULES: Record<ScrubRule, (value: unknown) => unknown> = { actor: scrubActor, actorsInJson: scrubActorsInJson }

/**
 * The row as the copy carries it: kept columns as they are, scrubbed ones by their rule. `tally`
 * counts, per `table.column`, the rows whose value the scrub changed. A column the table's
 * classification does not name is refused.
 */
export function scrubRow(t: ExportedTable, row: Row, tally: Map<string, number>): Row {
  const out: Row = {}
  for (const [column, value] of Object.entries(row)) {
    const rule = t.scrub[column]
    if (rule === undefined) {
      if (!t.keep.includes(column)) throw new UnclassifiedColumns(`${t.table}.${column} is not classified in scripts/eval-db/tables.ts`)
      out[column] = value
      continue
    }
    const scrubbed = RULES[rule](value)
    if (JSON.stringify(scrubbed) !== JSON.stringify(value)) tally.set(`${t.table}.${column}`, (tally.get(`${t.table}.${column}`) ?? 0) + 1)
    out[column] = scrubbed
  }
  return out
}

/**
 * Holds the source database's columns against the classification before anything is written: a
 * column it does not name refuses the export, naming every one. A table or a classified column the
 * database lacks (one migrated to an older schema) is only noted.
 */
export function checkSourceColumns(
  tables: readonly ExportedTable[],
  source: ReadonlyMap<string, readonly string[]>,
): { absentTables: string[]; absentColumns: string[] } {
  const unclassified: string[] = []
  const absentTables: string[] = []
  const absentColumns: string[] = []
  for (const t of tables) {
    const columns = source.get(t.table)
    if (!columns || columns.length === 0) {
      absentTables.push(t.table)
      continue
    }
    const classified = [...t.keep, ...Object.keys(t.scrub)]
    unclassified.push(...columns.filter(c => !classified.includes(c)).map(c => `${t.table}.${c}`))
    absentColumns.push(...classified.filter(c => !columns.includes(c)).map(c => `${t.table}.${c}`))
  }
  if (unclassified.length > 0) {
    throw new UnclassifiedColumns(
      `the database has columns the copy does not classify: ${unclassified.join(', ')}; classify them in scripts/eval-db/tables.ts first`,
    )
  }
  return { absentTables, absentColumns }
}
