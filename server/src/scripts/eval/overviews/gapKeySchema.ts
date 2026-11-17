/**
 * The gap-key format for `eval:overviews` (`.context/model-eval.md`, "Overview evals"): one JSON file
 * per one-off story in `gapKeys/`, saying what a careful editor would add beside the story so a
 * reader can size and place it, slot by slot of production's checklist (`CONTEXT_SLOTS`, imported so
 * a key can't drift from it). The `context` step scores story context against these keys. The Zod
 * schema holds the shape and the field rules (in its `.describe()`s, which the drafting call reads
 * too); `validateGapKey` holds the rules across fields. Pure.
 */
import { z } from 'zod'
import { CONTEXT_SLOTS } from '../../../schemas/storyContext.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const text = (description: string) => z.string().min(1).describe(description)

export const GAP_NEED_KINDS = ['figure', 'fact', 'term'] as const
export const MIN_NEEDS = 2
export const MAX_NEEDS = 8

export const gapNeedSchema = z.object({
  id: text('Short id, unique in the key, lowercase with hyphens, e.g. "record-2015".'),
  slot: z.enum(CONTEXT_SLOTS).describe('The checklist slot the need belongs to.'),
  need: text('What a reader needs, in one line, e.g. "How this year\'s burned area compares with the 2015 record season".'),
  kind: z
    .enum(GAP_NEED_KINDS)
    .describe('"figure": a number with its unit and scope; "fact": a statement without a figure; "term": a term, body or mechanism explained.'),
  importance: z
    .enum(['must', 'nice'])
    .describe('"must" when a reader cannot size or place the story without it; "nice" when it helps but the story stands without it.'),
  inStory: z.string().nullable().describe('When our published story already states it: its exact words, so a checker can find them there. Null otherwise.'),
  accepts: text(
    'What output meets the need, concrete enough for a judge to decide yes or no: the figure, its unit and scope, and that it names its source. For a response need with no source found, say so.',
  ),
  example: z
    .object({
      value: text('A value or statement that meets it, e.g. "2.6 million hectares".'),
      source: text('Who states it, e.g. "The Guardian".'),
    })
    .nullable()
    .describe('One answer a source gives, as a guide for the judge. Null when no source is known, as for a response nothing sourced reports.'),
})

export const notNeededSchema = z.object({
  slot: z.enum(CONTEXT_SLOTS).describe('A checklist slot this story does not need.'),
  why: text('One line: why a reader of this story does not need it.'),
})

export const gapKeySchema = z.object({
  schemaVersion: z.literal(1),
  slug: text("The story's slug exactly as the archive has it; also the file name (`gapKeys/<slug>.json`)."),
  title: text("The story's published title."),
  date: z.string().regex(DATE, 'must be a date written YYYY-MM-DD').describe("The story's datePublished day (UTC), written YYYY-MM-DD."),
  needs: z.array(gapNeedSchema).describe(`${MIN_NEEDS} to ${MAX_NEEDS} needs; every slot is in needs or in notNeeded, never both.`),
  notNeeded: z.array(notNeededSchema).describe('Each checklist slot the story does not need, once.'),
  notes: z.string().default('').describe('Anything a judge must know: a borderline need and why, a story correction.'),
})

export type GapKey = z.infer<typeof gapKeySchema>
export type GapNeed = GapKey['needs'][number]

const isCalendarDate = (d: string) => {
  const parsed = new Date(`${d}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d
}

/** The rules across fields; an empty list for a key that keeps them all. */
export function validateGapKey(key: GapKey): string[] {
  const errors: string[] = []
  if (!isCalendarDate(key.date)) errors.push(`date ${key.date} is not a calendar day`)
  if (key.needs.length < MIN_NEEDS || key.needs.length > MAX_NEEDS) errors.push(`${key.needs.length} needs; a key has ${MIN_NEEDS} to ${MAX_NEEDS}`)
  const ids = new Set<string>()
  for (const n of key.needs) {
    if (ids.has(n.id)) errors.push(`need ${n.id} listed twice`)
    ids.add(n.id)
    if (n.inStory !== null && n.inStory.trim() === '') errors.push(`need ${n.id}: inStory is empty; null when the story does not state it`)
  }
  if (!key.needs.some(n => n.importance === 'must')) errors.push('no need is a must')
  if (!key.needs.some(n => n.slot === 'response' && n.importance === 'must')) errors.push('the response slot is always a must need (D10)')
  const needed = new Set(key.needs.map(n => n.slot))
  const notNeeded = new Map<string, number>()
  for (const n of key.notNeeded) notNeeded.set(n.slot, (notNeeded.get(n.slot) ?? 0) + 1)
  for (const slot of CONTEXT_SLOTS) {
    const times = notNeeded.get(slot) ?? 0
    if (needed.has(slot) && times > 0) errors.push(`slot ${slot} is both needed and not needed`)
    else if (!needed.has(slot) && times === 0) errors.push(`slot ${slot} is neither needed nor not needed`)
    if (times > 1) errors.push(`slot ${slot} is not needed twice`)
  }
  return errors
}

/** The schema's errors (`path: message`), else `validateGapKey`'s; the key is null only when the schema fails. */
export function parseGapKey(json: unknown): { key: GapKey | null; errors: string[] } {
  const parsed = gapKeySchema.safeParse(json)
  if (!parsed.success) return { key: null, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }
  return { key: parsed.data, errors: validateGapKey(parsed.data) }
}
