/**
 * The committed answer keys on disk: every `*.json` in `keys/`, one per development and named after
 * its id, read and checked with the schema and `validateKey` (`keySchema.ts`). Shared by the
 * `keys` step and `keys.test.ts`, which holds every committed key to the format with no database.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKey, type AnswerKey } from './keySchema.js'

export const KEYS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'keys')

export interface KeyFile {
  file: string
  /** Null when the file is not JSON or fails the schema. */
  key: AnswerKey | null
  errors: string[]
}

/** The key files' names, sorted. */
export function keyFileNames(dir: string = KEYS_DIR): string[] {
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
}

export function readKeyFile(path: string): KeyFile {
  const file = basename(path)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    return { file, key: null, errors: [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  const { key, errors } = parseKey(json)
  const misnamed = key && file !== `${key.id}.json` ? [`the file is named ${file}, not after its id ${key.id}`] : []
  return { file, key, errors: [...misnamed, ...errors] }
}

export function readKeyFiles(dir: string = KEYS_DIR): KeyFile[] {
  return keyFileNames(dir).map(name => readKeyFile(join(dir, name)))
}
