/**
 * Fails when a migration would harm the production database on the next deploy
 * (.context/database-migrations.md, "Migration check"):
 *
 * - any migration that drops `stories_embedding_idx` without re-creating it, and
 * - a migration this branch adds that holds DROP TABLE, TRUNCATE or an ALTER ... DROP
 *   (DROP COLUMN and the rest), unless it carries `-- reviewed-destructive: <reason>`.
 *
 *   npm run check:migrations --prefix server                     # against origin/main
 *   npm run check:migrations --prefix server -- --base <git-ref>
 *
 * "Added" means added since the merge base with the base ref, counting uncommitted and
 * untracked files. A base ref git cannot resolve fails the check rather than passing it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findProblems, type Migration } from './rules.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MIGRATIONS = 'prisma/migrations'
const PREFIX = '[check:migrations]'

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: SERVER_DIR, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`${PREFIX} git ${args.join(' ')} failed:\n${(result.stderr || result.stdout || '').trim()}`)
    process.exit(1)
  }
  return result.stdout
}

function baseRef(argv: string[]): string {
  const at = argv.indexOf('--base')
  if (at === -1) return 'origin/main'
  const ref = argv[at + 1]
  if (!ref) {
    console.error(`${PREFIX} --base needs a git ref`)
    process.exit(1)
  }
  return ref
}

/** Migration folder names under prisma/migrations among the given server-relative paths. */
function migrationNames(paths: string): Set<string> {
  const names = new Set<string>()
  for (const line of paths.split('\n')) {
    const match = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(line.trim())
    if (match) names.add(match[1])
  }
  return names
}

function main() {
  const base = baseRef(process.argv.slice(2))
  const mergeBase = git(['merge-base', base, 'HEAD']).trim()
  const added = migrationNames(
    git(['diff', '--relative', '--name-only', '--diff-filter=AR', mergeBase, '--', MIGRATIONS]) +
      git(['ls-files', '--others', '--exclude-standard', '--', MIGRATIONS]),
  )

  const dir = path.join(SERVER_DIR, MIGRATIONS)
  const all: Migration[] = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => ({ name: d.name, sql: readFileSync(path.join(dir, d.name, 'migration.sql'), 'utf8') }))

  const problems = findProblems(all, added)
  const scope = `${all.length} migrations, ${added.size} added since ${base} (${mergeBase.slice(0, 8)})`
  if (problems.length > 0) {
    console.error(`${PREFIX} ${problems.length} problem(s) in ${scope}:`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`${PREFIX} ok: ${scope}`)
}

main()
