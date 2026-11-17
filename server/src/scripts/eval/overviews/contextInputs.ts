/**
 * The story inputs the `gap-draft` and `context` steps read: production's `loadContextInput` per
 * story (its text and places, its newest research run with facts, the reusable facts of the earlier
 * stories research linked), through the read-only session, cached by slug in
 * `.cache/context-inputs.json`. The cache keeps the prompts, and with them the call cache's keys,
 * stable while the database changes; a slug it does not hold is loaded and added, and
 * `--refresh-fixtures` loads every slug again. A story with no input (not published, or no research
 * run whose sources hold facts) is cached as null.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loadContextInput } from '../../../services/storyContextInput.js'
import type { ContextInput } from '../../../services/storyContextPipeline.js'
import type { SelectDb } from '../readOnlyDb.js'

export const CONTEXT_INPUTS_VERSION = 1

export interface ContextInputCache {
  version: typeof CONTEXT_INPUTS_VERSION
  /** When a slug was last loaded into the file. */
  updatedAt: string
  inputs: Record<string, ContextInput | null>
}

/** Each slug's input, null for a story with none; an unknown slug is null too. */
export async function loadInputsBySlug(db: SelectDb, slugs: string[]): Promise<Map<string, ContextInput | null>> {
  const rows = slugs.length === 0 ? [] : await db.$queryRaw<{ id: string; slug: string }[]>`SELECT s.id, s.slug FROM stories s WHERE s.slug = ANY(${slugs})`
  const idOf = new Map(rows.map(r => [r.slug, r.id]))
  const out = new Map<string, ContextInput | null>()
  for (const slug of slugs) {
    const id = idOf.get(slug)
    out.set(slug, id ? await loadContextInput(db, id) : null)
  }
  return out
}

function readCache(file: string): ContextInputCache | null {
  if (!existsSync(file)) return null
  const cached = JSON.parse(readFileSync(file, 'utf8')) as Partial<ContextInputCache>
  return cached.version === CONTEXT_INPUTS_VERSION && cached.inputs ? (cached as ContextInputCache) : null
}

export interface InputsOptions {
  file: string
  /** Load every slug again (`--refresh-fixtures`). */
  refresh: boolean
  /** Loads the slugs the cache does not hold: the read-only session's `loadInputsBySlug`. */
  load(slugs: string[]): Promise<Map<string, ContextInput | null>>
  now?: Date
}

/** The inputs of `slugs`, from the cache where it holds them; the rest are loaded and written back. */
export async function contextInputsFor(
  slugs: string[],
  o: InputsOptions,
): Promise<{ inputs: Map<string, ContextInput | null>; loaded: number; updatedAt: string | null }> {
  const cache = o.refresh ? null : readCache(o.file)
  const held = cache?.inputs ?? {}
  const missing = slugs.filter(s => !Object.hasOwn(held, s))
  let updatedAt = cache?.updatedAt ?? null
  const all = { ...held }
  if (missing.length > 0) {
    const loaded = await o.load(missing)
    for (const slug of missing) all[slug] = loaded.get(slug) ?? null
    updatedAt = (o.now ?? new Date()).toISOString()
    const next: ContextInputCache = { version: CONTEXT_INPUTS_VERSION, updatedAt, inputs: all }
    writeFileSync(o.file, JSON.stringify(next, null, 1))
  }
  return { inputs: new Map(slugs.map(s => [s, all[s] ?? null])), loaded: missing.length, updatedAt }
}
