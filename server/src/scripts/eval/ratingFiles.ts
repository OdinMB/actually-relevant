/**
 * The rating deliverable on disk (`rating-sets.json`, `rating-key.json`).
 *
 * The owner may already be rating from these files with a local tool, which
 * keeps its own `ratings.json` that nothing here reads or writes. So an
 * existing deliverable is never rewritten wholesale: eval:models writes one
 * only when none exists, and a regenerated set is swapped in with every other
 * set left byte for byte as it was.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRatingDeliverable, buildRatingSet, replaceRatingSet, slugOfSetId, validateRatingDeliverable,
  type ExcludedDraft, type RatingKey, type RatingSetsFile,
} from './ratingSets.js'
import type { RatingItemDraft, RatingSetSlug } from './types.js'

export const SETS_FILE = 'rating-sets.json'
export const KEY_FILE = 'rating-key.json'

/** The harness's own file format; round-tripping through it is byte-exact. */
const serialize = (value: unknown) => JSON.stringify(value, null, 2)

export interface DeliverableSummary {
  sets: { id: string; items: number }[]
  excluded: ExcludedDraft[]
  validationErrors: string[]
  /** False when a deliverable already existed and was left as it was. */
  written: boolean
}

function validateOnDisk(out: string): string[] {
  return validateRatingDeliverable(JSON.parse(readFileSync(join(out, SETS_FILE), 'utf8')), JSON.parse(readFileSync(join(out, KEY_FILE), 'utf8')))
}

/** Write the whole deliverable, unless one already exists in `out`. */
export function writeRatingDeliverable(out: string, drafts: RatingItemDraft[]): DeliverableSummary {
  const { sets, key, excluded } = buildRatingDeliverable(drafts)
  const summary = { sets: sets.sets.map(s => ({ id: s.id, items: s.items.length })), excluded }
  if (existsSync(join(out, SETS_FILE)) || existsSync(join(out, KEY_FILE))) return { ...summary, validationErrors: [], written: false }
  writeFileSync(join(out, SETS_FILE), serialize(sets))
  writeFileSync(join(out, KEY_FILE), serialize(key))
  return { ...summary, validationErrors: validateOnDisk(out), written: true }
}

/**
 * Regenerate the `slug` set of an existing deliverable as `version`. Refuses,
 * leaving both files untouched, when they are not exactly in the harness's
 * format (re-serializing could then change other sets' bytes) or when no draft
 * survives blinding (the old set would be lost for nothing). After writing,
 * every other set is compared with its previous self.
 */
export function replaceRatingSetFiles(
  out: string,
  slug: RatingSetSlug,
  version: number,
  drafts: RatingItemDraft[],
): { set: { id: string; items: number }; excluded: ExcludedDraft[]; validationErrors: string[] } {
  const setsText = readFileSync(join(out, SETS_FILE), 'utf8')
  const keyText = readFileSync(join(out, KEY_FILE), 'utf8')
  const file = JSON.parse(setsText) as RatingSetsFile
  const key = JSON.parse(keyText) as RatingKey
  if (serialize(file) !== setsText || serialize(key) !== keyText) {
    throw new Error(`${SETS_FILE} or ${KEY_FILE} is not in the harness's own format (edited by hand or by another tool?); refusing to rewrite it`)
  }
  const built = buildRatingSet(drafts, slug, version)
  if (!built.set) throw new Error(`no ${slug} item survived blinding; the deliverable is unchanged`)
  const next = replaceRatingSet(file, key, slug, { set: built.set, key: built.key })
  writeFileSync(join(out, SETS_FILE), serialize(next.file))
  writeFileSync(join(out, KEY_FILE), serialize(next.key))

  const written = JSON.parse(readFileSync(join(out, SETS_FILE), 'utf8')) as RatingSetsFile
  const changed = file.sets
    .filter(s => slugOfSetId(s.id) !== slug)
    .filter(s => serialize(written.sets.find(w => w.id === s.id) ?? null) !== serialize(s))
    .map(s => `${s.id} changed while replacing the ${slug} set`)
  return { set: { id: built.set.id, items: built.set.items.length }, excluded: built.excluded, validationErrors: [...validateOnDisk(out), ...changed] }
}
