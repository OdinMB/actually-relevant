/**
 * The development keys' halves (`.context/model-eval.md`, "Overview evals"; plan decision D-OV6): a
 * committed list, not a slug hash, so the judged half holds Ebola, as the roadmap requires, and each
 * half holds developments of several kinds. The linking evals replay a half's developments together,
 * so a story of one may join another's overview. Prompts are tuned on `tune`; the gate is read on
 * `judge`. A third list holds the label keys, in neither half. A new key goes into one of the three
 * lists in the change that commits it (`developmentHalves.test.ts` fails until it does). Pure.
 */
import type { Half } from './contextScore.js'
import { mergeDuplicates, type DuplicateGroup } from './duplicates.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'

export const DEVELOPMENT_HALVES: Readonly<Record<Half, readonly string[]>> = {
  judge: ['ebola-drc-2026', 'el-nino-2026', 'lebanon-war-2026', 'pandemic-agreement-pabs', 'colorado-river-rules'],
  tune: ['hormuz-shipping-2026', 'iran-war-2026', 'autonomous-weapons-talks', 'sudan-el-fasher', 'h5n1-australia'],
}

/**
 * The label keys (ADR-0073): small developments in neither half, never tuned on, replayed as a half
 * or scored, and read by no step but the linking evals. Each only says what its stories are: two of
 * them found a development rightly, and an overview mostly of them stands for it, not for a judged one.
 */
export const LABEL_DEVELOPMENTS: readonly string[] = ['un-pandemic-declaration-2026', 'us-ocean-observatories-cuts-2026']

/** Whether a development key is a label key (`LABEL_DEVELOPMENTS`). */
export const isLabelDevelopment = (id: string): boolean => LABEL_DEVELOPMENTS.includes(id)

/** The half a development key is in, by its id; null for a key in neither list. */
export function developmentHalf(id: string): Half | null {
  if (DEVELOPMENT_HALVES.judge.includes(id)) return 'judge'
  if (DEVELOPMENT_HALVES.tune.includes(id)) return 'tune'
  return null
}

/** Whether a development key is in `half` (`all` takes every listed key). */
export const inDevelopmentHalf = (id: string, half: Half | 'all'): boolean => {
  const of = developmentHalf(id)
  return of !== null && (half === 'all' || of === half)
}

/**
 * The well-formed keys of `half`, and the others (every other well-formed key, the label keys always
 * among them): the half's are replayed and scored. The others are never scored: they say whether a
 * founding pair are two entries of one development the half does not score, which development an
 * overview stands for (`linkKeys`), and, in a judged linking run, which stories are replayed as
 * background (`backgroundOf`). Both with the duplicate groups merged (`mergeDuplicates`, ADR-0076), so
 * every step that reads them sees the stories production would have had: a dropped story is never
 * asked of the database, replayed or anyone's neighbour.
 */
export function keysOfHalf(files: readonly KeyFile[], half: Half | 'all', groups: readonly DuplicateGroup[] = []): { keys: AnswerKey[]; others: AnswerKey[] } {
  const valid = mergeDuplicates(
    files.flatMap(f => (f.key && f.errors.length === 0 ? [f.key] : [])),
    groups,
  )
  return { keys: valid.filter(k => inDevelopmentHalf(k.id, half)), others: valid.filter(k => !inDevelopmentHalf(k.id, half)) }
}
