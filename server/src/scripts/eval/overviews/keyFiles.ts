/**
 * The committed keys on disk: every `*.json` in `keys/` (answer keys, one per development, named
 * after its id; `keySchema.ts`) and in `gapKeys/` (gap keys, one per one-off story, named after its
 * slug; `gapKeySchema.ts`), each read and checked with its schema and cross-field rules. Shared by
 * the `keys` and `gap-keys` steps and by `keys.test.ts` and `gapKeys.test.ts`, which hold every
 * committed key to its format with no database.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGapKey, type GapKey } from './gapKeySchema.js'
import { parseKey, type AnswerKey } from './keySchema.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const KEYS_DIR = join(HERE, 'keys')
export const GAP_KEYS_DIR = join(HERE, 'gapKeys')

export interface KeyFileOf<K> {
  file: string
  /** Null when the file is not JSON or fails the schema. */
  key: K | null
  errors: string[]
}

export type KeyFile = KeyFileOf<AnswerKey>
export type GapKeyFile = KeyFileOf<GapKey>

/** The key files' names, sorted; none for a folder not there yet. */
export function keyFileNames(dir: string = KEYS_DIR): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
}

interface KeyFormat<K> {
  parse(json: unknown): { key: K | null; errors: string[] }
  /** What the file must be named after, e.g. "id". */
  nameField: string
  nameOf(key: K): string
}

function readOne<K>(path: string, format: KeyFormat<K>): KeyFileOf<K> {
  const file = basename(path)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    return { file, key: null, errors: [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  const { key, errors } = format.parse(json)
  const name = key ? format.nameOf(key) : null
  const misnamed = name !== null && file !== `${name}.json` ? [`the file is named ${file}, not after its ${format.nameField} ${name}`] : []
  return { file, key, errors: [...misnamed, ...errors] }
}

const ANSWER_KEYS: KeyFormat<AnswerKey> = { parse: parseKey, nameField: 'id', nameOf: k => k.id }
const GAP_KEYS: KeyFormat<GapKey> = { parse: parseGapKey, nameField: 'slug', nameOf: k => k.slug }

export const readKeyFile = (path: string): KeyFile => readOne(path, ANSWER_KEYS)

export function readKeyFiles(dir: string = KEYS_DIR): KeyFile[] {
  return keyFileNames(dir).map(name => readKeyFile(join(dir, name)))
}

export function readGapKeyFiles(dir: string = GAP_KEYS_DIR): GapKeyFile[] {
  return keyFileNames(dir).map(name => readOne(join(dir, name), GAP_KEYS))
}
