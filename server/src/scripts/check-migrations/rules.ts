/**
 * The rules `npm run check:migrations` applies to migration SQL (.context/database-migrations.md,
 * "Migration check"). Pure functions over a migration's text; `index.ts` decides which files.
 *
 * The matching is textual, per statement, with comments stripped: a drop hidden in a DO block or
 * an EXECUTE string is not caught, and a string literal that happens to read like one is.
 */

/** An index Prisma cannot represent, so every generated migration proposes dropping it. */
export interface UnmodeledIndex {
  name: string
  /** The table it is on. */
  table: string
  /** Its access method, when not the default. */
  using?: string
}

/**
 * The pgvector HNSW index on `story_embeddings`. Created in 20261102120000_story_embeddings_table,
 * which also dropped its predecessor `stories_embedding_idx` together with the column it covered (ADR-0051).
 */
export const EMBEDDING_INDEX = 'story_embeddings_embedding_idx'

export const UNMODELED_INDEXES: readonly UnmodeledIndex[] = [
  { name: EMBEDDING_INDEX, table: 'story_embeddings', using: 'hnsw' },
  // At most one current article version per story, a partial unique index (20261117230407_research_passes; ADR-0067)
  { name: 'article_versions_one_current', table: 'article_versions' },
]

/** The line a destructive migration carries once someone has reviewed it, with a reason. */
export const DESTRUCTIVE_MARKER = /^[ \t]*--[ \t]*reviewed-destructive:[ \t]*\S/m

export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

export function statements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map(s => s.trim())
    .filter(s => s !== '')
}

const namesIndex = (index: UnmodeledIndex) => new RegExp(`(^|[^a-z0-9_$])${index.name}([^a-z0-9_$]|$)`, 'i')

/**
 * Drops are matched alone or in a list, quoted or not, schema-qualified or not, and in any
 * case (deliberately conservative: a quoted mixed-case name is a different index to Postgres).
 * An implicit drop through DROP COLUMN "embedding" / DROP TABLE "story_embeddings" is not caught here;
 * in a new migration the destructive rule below catches it.
 */
function dropsIndex(s: string, index: UnmodeledIndex): boolean {
  return /^drop\s+index\b/i.test(s) && namesIndex(index).test(s)
}

const onTable = (index: UnmodeledIndex) => new RegExp(`^\\s*(only\\s+)?("?public"?\\.)?"?${index.table}"?\\s*[\\s(]`, 'i')

/** An index of that name on its table, with its access method. */
function createsIndexStatement(s: string, index: UnmodeledIndex): boolean {
  const [head = '', ...rest] = s.split(/\bon\b/i)
  return (
    /^create\s+(unique\s+)?index\b/i.test(s) &&
    namesIndex(index).test(head) &&
    onTable(index).test(rest.join('on')) &&
    (!index.using || new RegExp(`\\busing\\s+${index.using}\\b`, 'i').test(s))
  )
}

/** True when the index ends the migration dropped: dropped, and not created again afterwards. */
export function losesIndex(sql: string, index: UnmodeledIndex): boolean {
  const all = statements(sql)
  let lastDrop = -1
  all.forEach((s, i) => {
    if (dropsIndex(s, index)) lastDrop = i
  })
  return lastDrop !== -1 && !all.slice(lastDrop + 1).some(s => createsIndexStatement(s, index))
}

const EMBEDDING = UNMODELED_INDEXES[0]!

export const losesEmbeddingIndex = (sql: string): boolean => losesIndex(sql, EMBEDDING)

export function createsEmbeddingIndex(sql: string): boolean {
  return statements(sql).some(s => createsIndexStatement(s, EMBEDDING))
}

const DESTRUCTIVE: { kind: string; test: (s: string) => boolean }[] = [
  { kind: 'DROP TABLE', test: s => /^drop\s+table\b/i.test(s) },
  { kind: 'TRUNCATE', test: s => /^truncate\b/i.test(s) },
  // DROP COLUMN, DROP CONSTRAINT, DROP DEFAULT, DROP NOT NULL, ... on any ALTER
  { kind: 'ALTER ... DROP', test: s => /^alter\b/i.test(s) && /\bdrop\b/i.test(s) },
]

/** The destructive statements in a migration, each named by its kind and first line. */
export function destructiveStatements(sql: string): string[] {
  return statements(sql).flatMap(s => {
    const rule = DESTRUCTIVE.find(r => r.test(s))
    return rule ? [`${rule.kind}: ${s.split('\n', 1)[0]!.trim()}`] : []
  })
}

export function isReviewedDestructive(sql: string): boolean {
  return DESTRUCTIVE_MARKER.test(sql)
}

export interface Migration {
  name: string
  sql: string
}

/**
 * Every problem in the migrations: the embedding index in any of them, and unreviewed
 * destructive statements in the ones this branch adds.
 */
export function findProblems(all: Migration[], added: Set<string>): string[] {
  const problems: string[] = []
  for (const m of all) {
    for (const index of UNMODELED_INDEXES) {
      if (losesIndex(m.sql, index)) problems.push(`${m.name}: drops "${index.name}" without re-creating it; delete that line`)
    }
    if (!added.has(m.name) || isReviewedDestructive(m.sql)) continue
    for (const found of destructiveStatements(m.sql)) {
      problems.push(`${m.name}: ${found} (add "-- reviewed-destructive: <reason>" once reviewed)`)
    }
  }
  return problems
}
