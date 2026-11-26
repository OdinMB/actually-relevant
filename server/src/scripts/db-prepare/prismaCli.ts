/**
 * Runs the project's own Prisma CLI (`server/node_modules/prisma`) with this Node, never a registry
 * download through npx (`.context/database-migrations.md`, "Critical Rules"). db:prepare and the eval
 * copy's import run `migrate deploy` through it.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PRISMA_CLI = path.join(SERVER_DIR, 'node_modules/prisma/build/index.js')

/** `prisma <args>` in `server/`, with `env` (whose DATABASE_URL names the database); its output, stdout and stderr together. */
export function runPrisma(args: string[], env: NodeJS.ProcessEnv = process.env): { ok: boolean; output: string } {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { cwd: SERVER_DIR, encoding: 'utf8', env })
  if (result.error) return { ok: false, output: String(result.error) }
  return { ok: result.status === 0, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
}
