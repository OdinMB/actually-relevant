/**
 * Prepare the local development database before the dev server starts:
 * apply committed migrations (`prisma migrate deploy`) and regenerate the
 * Prisma client when the schema changed since the last generate.
 *
 *   npm run db:prepare --prefix server     # standalone
 *   npm run dev --prefix server            # runs this first, as predev
 *
 * Only ever touches a database on this machine: if DATABASE_URL's host is not
 * local, it prints a warning and exits 0 without migrating. SKIP_DB_PREPARE=1
 * skips it entirely. A failed migration or generate exits non-zero, which stops
 * the dev server from starting. See .context/database-migrations.md.
 */
import dotenv from 'dotenv'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { decidePreparation } from './gate.js'
import { classifyGenerateFailure, classifyMigrateFailure, summarizeMigrateSuccess } from './prismaOutput.js'
import { needsGenerate, schemaHash } from './schemaStamp.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PRISMA_CLI = path.join(SERVER_DIR, 'node_modules/prisma/build/index.js')
const SCHEMA_FILE = path.join(SERVER_DIR, 'prisma/schema.prisma')
const CLIENT_DIR = path.join(SERVER_DIR, 'node_modules/.prisma/client')
const STAMP_FILE = path.join(CLIENT_DIR, '.db-prepare-schema.sha256')

const PREFIX = '[db:prepare]'
const say = (message: string) => console.log(`${PREFIX} ${message}`)
const warn = (message: string) => console.warn(`${PREFIX} ${message}`)
const fail = (message: string, output?: string): never => {
  console.error(`${PREFIX} ${message}`)
  if (output) console.error(lastLines(output, 15))
  process.exit(1)
}

function lastLines(text: string, count: number): string {
  return text.trim().split(/\r?\n/).slice(-count).join('\n')
}

function runPrisma(args: string[]): { ok: boolean; output: string } {
  // The project's own CLI, run with this Node: never a registry download via npx.
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) return { ok: false, output: String(result.error) }
  return { ok: result.status === 0, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
}

function migrate(): void {
  const { ok, output } = runPrisma(['migrate', 'deploy'])
  if (!ok) {
    const hints: Record<ReturnType<typeof classifyMigrateFailure>, string> = {
      unreachable: 'Cannot reach the database. Is the Docker container running? Start it with `docker compose up -d`.',
      'failed-migration': 'A migration failed. Fix it, then see "Troubleshooting" in .context/database-migrations.md.',
      other: '`prisma migrate deploy` failed.',
    }
    fail(`${hints[classifyMigrateFailure(output)]} Prisma said:`, output)
  }
  const { applied } = summarizeMigrateSuccess(output)
  say(applied.length === 0 ? 'migrations up to date' : `applied ${applied.length} migration(s): ${applied.join(', ')}`)
}

function generateIfSchemaChanged(): void {
  const schema = readFileSync(SCHEMA_FILE, 'utf8')
  const stamp = existsSync(STAMP_FILE) ? readFileSync(STAMP_FILE, 'utf8') : null
  const clientPresent = existsSync(path.join(CLIENT_DIR, 'index.js'))
  if (!needsGenerate({ schema, stamp, clientPresent })) {
    say('Prisma client up to date')
    return
  }

  say(
    stamp === null
      ? 'no record of the last generate, regenerating the Prisma client'
      : 'schema changed since the last generate, regenerating the Prisma client',
  )
  const { ok, output } = runPrisma(['generate'])
  if (!ok) {
    if (classifyGenerateFailure(output) === 'locked') {
      fail(
        'Cannot replace the Prisma client: another process holds its files, usually a server that is still running. Stop it and retry.',
      )
    }
    fail('`prisma generate` failed. Prisma said:', output)
  }
  writeFileSync(STAMP_FILE, `${schemaHash(schema)}\n`)
  say('Prisma client regenerated')
}

function main(): void {
  // The same .env that prisma.config.ts loads; values already in the environment win.
  dotenv.config({ path: path.join(SERVER_DIR, '.env'), quiet: true })

  const preparation = decidePreparation(process.env)
  switch (preparation.action) {
    case 'skip-requested':
      say('skipped (SKIP_DB_PREPARE is set)')
      return
    case 'skip-missing':
      warn('DATABASE_URL is not set; skipped migrations and client generation.')
      return
    case 'skip-remote':
      warn(
        `database host "${preparation.host}" is not local; skipped automatic migrations and client generation.`,
      )
      return
    case 'run':
      migrate()
      generateIfSchemaChanged()
  }
}

// Only run when executed directly (so importing the file has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
