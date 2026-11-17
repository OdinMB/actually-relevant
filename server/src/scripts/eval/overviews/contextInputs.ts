/**
 * The story inputs the `gap-draft` and `context` steps read, through the read-only session, each
 * kind cached by slug in its own file: `gap-draft`'s production `loadContextInput` per story (its
 * text and places, its newest research run with facts, the reusable facts of the earlier stories
 * research linked) in `.cache/context-inputs.json`, and `context`'s first-pass input
 * (`loadFirstPassInput`: research's story, the story's own places, the earlier stories' reusable
 * facts) in `.cache/pass-inputs.json`. The cache keeps the prompts, and with them the call cache's
 * keys, stable while the database changes; a slug it does not hold is loaded and added, and
 * `--refresh-fixtures` loads every slug again. A story with no input is cached as null.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { PassInput } from '../../../services/researchPass.js'
import { loadFirstPassInput } from '../../../services/researchPassInput.js'
import { loadContextInput } from '../../../services/storyContextInput.js'
import type { ContextInput } from '../../../services/storyContextPipeline.js'
import type { SelectDb } from '../readOnlyDb.js'

export const CONTEXT_INPUTS_VERSION = 1
export const PASS_INPUTS_VERSION = 1

export interface InputCache<T> {
  version: number
  /** When a slug was last loaded into the file. */
  updatedAt: string
  inputs: Record<string, T | null>
}

/** Each slug's input as `load` gives it for the story's id, null for a story with none; an unknown slug is null too. */
async function bySlug<T>(db: SelectDb, slugs: string[], load: (id: string, slug: string) => Promise<T | null>): Promise<Map<string, T | null>> {
  const rows = slugs.length === 0 ? [] : await db.$queryRaw<{ id: string; slug: string }[]>`SELECT s.id, s.slug FROM stories s WHERE s.slug = ANY(${slugs})`
  const idOf = new Map(rows.map(r => [r.slug, r.id]))
  const out = new Map<string, T | null>()
  for (const slug of slugs) {
    const id = idOf.get(slug)
    out.set(slug, id ? await load(id, slug) : null)
  }
  return out
}

/** Each slug's context input: none for a story not published or without a research run whose sources hold facts. */
export const loadInputsBySlug = (db: SelectDb, slugs: string[]): Promise<Map<string, ContextInput | null>> => bySlug(db, slugs, id => loadContextInput(db, id))

/** Each slug's first-pass input: none for a story research cannot run on. */
export const loadPassInputsBySlug = (db: SelectDb, slugs: string[]): Promise<Map<string, PassInput | null>> =>
  bySlug(db, slugs, (id, slug) => loadFirstPassInput(db, id, `eval-${slug}`))

function readCache<T>(file: string, version: number): InputCache<T> | null {
  if (!existsSync(file)) return null
  const cached = JSON.parse(readFileSync(file, 'utf8')) as Partial<InputCache<T>>
  return cached.version === version && cached.inputs ? (cached as InputCache<T>) : null
}

export interface InputsOptions<T> {
  file: string
  /** The cache format's version: `CONTEXT_INPUTS_VERSION` unless given. */
  version?: number
  /** Load every slug again (`--refresh-fixtures`). */
  refresh: boolean
  /** Loads the slugs the cache does not hold: the read-only session's `loadInputsBySlug` or `loadPassInputsBySlug`. */
  load(slugs: string[]): Promise<Map<string, T | null>>
  now?: Date
}

/** The inputs of `slugs`, from the cache where it holds them; the rest are loaded and written back. */
export async function contextInputsFor<T = ContextInput>(
  slugs: string[],
  o: InputsOptions<T>,
): Promise<{ inputs: Map<string, T | null>; loaded: number; updatedAt: string | null }> {
  const version = o.version ?? CONTEXT_INPUTS_VERSION
  const cache = o.refresh ? null : readCache<T>(o.file, version)
  const held = cache?.inputs ?? {}
  const missing = slugs.filter(s => !Object.hasOwn(held, s))
  let updatedAt = cache?.updatedAt ?? null
  const all = { ...held }
  if (missing.length > 0) {
    const loaded = await o.load(missing)
    for (const slug of missing) all[slug] = loaded.get(slug) ?? null
    updatedAt = (o.now ?? new Date()).toISOString()
    const next: InputCache<T> = { version, updatedAt, inputs: all }
    writeFileSync(o.file, JSON.stringify(next, null, 1))
  }
  return { inputs: new Map(slugs.map(s => [s, all[s] ?? null])), loaded: missing.length, updatedAt }
}
