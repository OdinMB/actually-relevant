/** Where the harness sits in the repository, and how it loads the client's own packages. */
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const harnessDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = path.resolve(harnessDir, '../..')
export const clientDir = path.join(repoRoot, 'client')

/**
 * Imports a package the client already depends on (Vite, Puppeteer, TypeScript), from
 * client/node_modules: the harness adds no dependency of its own.
 */
export async function importFromClient(specifier) {
  const require = createRequire(path.join(clientDir, 'package.json'))
  let resolved
  try {
    resolved = require.resolve(specifier)
  } catch {
    throw new Error(`${specifier} is not installed in client/node_modules; install the client's dependencies first (npm ci --prefix client --ignore-scripts)`)
  }
  return import(pathToFileURL(resolved).href)
}
