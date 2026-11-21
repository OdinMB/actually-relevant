import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join, relative, dirname } from 'path'
import { fileURLToPath } from 'url'

/**
 * Windows and macOS find files without regard to case, and an import names no extension: on Windows,
 * `./OverviewTimeline` loaded a pure `overviewTimeline.ts` sitting beside the component
 * `OverviewTimeline.tsx`, and the page rendered nothing. Linux, and so CI, never saw it. No two source
 * files in one folder may share a name once case and the module extension are dropped.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ROOTS = ['client/src', 'server/src', 'server/prisma', 'shared', 'scripts']
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage'])
const MODULE_EXTENSION = /\.(?:d\.ts|tsx?|mts|cts|jsx?|mjs|cjs|json)$/i

function clashes(dir: string, found: string[][]): string[][] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const byKey = new Map<string, string[]>()
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) clashes(join(dir, entry.name), found)
      continue
    }
    const key = entry.name.replace(MODULE_EXTENSION, '').toLowerCase()
    byKey.set(key, [...(byKey.get(key) ?? []), entry.name])
  }
  for (const names of byKey.values()) {
    // `a.ts` beside `a.test.ts` differ in more than case; only names that differ in case or module extension alone clash
    const spellings = new Set(names.map(name => name.replace(MODULE_EXTENSION, '')))
    if (spellings.size > 1) found.push(names.map(name => relative(REPO_ROOT, join(dir, name)).replace(/\\/g, '/')))
  }
  return found
}

describe('source file names', () => {
  it('never differ from a neighbour in case alone, which Windows resolves to the wrong file', () => {
    expect(ROOTS.flatMap(root => clashes(join(REPO_ROOT, root), []))).toEqual([])
  })
})
