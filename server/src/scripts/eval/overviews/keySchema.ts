/**
 * The answer-key format for `eval:overviews` (`.context/model-eval.md`, "Overview evals"): one JSON
 * file per past development in `keys/`, saying what a perfect ongoing-story system would have done
 * with our published stories. The Zod schema holds the shape and the format rules (in its
 * `.describe()`s, from the drafting brief's "Field rules"); `validateKey` holds the rules across
 * fields. A drafted response or end carries `reviewed: false` until a person has checked it, and
 * the steps that read it refuse while one is left (`awaitingReview`). Every later overview eval
 * scores against these keys. Pure.
 */
import { z } from 'zod'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const date = (what: string) => z.string().regex(DATE, 'must be a date written YYYY-MM-DD').describe(`${what}, written YYYY-MM-DD.`)
const text = (description: string) => z.string().min(1).describe(description)

const figureSchema = z.object({
  key: text('Short id the values name, e.g. "deaths".'),
  name: text('Display name, e.g. "Deaths".'),
  unit: text('What one counts, e.g. "people".'),
  definition: text(
    'What is counted, where, and what is not (e.g. confirmed and probable deaths, all affected countries, cumulative since the outbreak was declared).',
  ),
  cumulative: z.boolean().describe('Whether the figure only ever grows (a running total) rather than describing a moment.'),
  variants: z.array(z.string()).describe("Other ways our stories count something similar, e.g. 'confirmed deaths only', 'DR Congo only'."),
})

const valueSchema = z.object({
  figure: text('The `key` of one of the figures.'),
  value: z.number().describe('The number the story states.'),
  approx: z
    .enum(['exact', 'at_least', 'about', 'under'])
    .describe('"exact"; "at_least" ("more than", "over", "topped"); "about" ("nearly", "around", "some"); or "under".'),
  asOf: date("The date the number is true for; the story's date when the text gives none"),
  matches: z.boolean().describe("False when the number counts something narrower or different than the figure's definition."),
  countedAs: z.string().nullable().default(null).describe('When `matches` is false: what the number counts instead. Null when it matches.'),
  quote: text(
    'The exact words from our published story that state it (title, summary, relevance reasons, antifactors, research paragraphs), so a checker can find it.',
  ),
})

const statusSchema = z.object({
  subject: text('The place or party whose state changed, e.g. "Nigeria".'),
  status: text('Its new state, e.g. "first confirmed case reported".'),
  asOf: date('When the change happened'),
})

const entrySchema = z.object({
  slug: text("The story's slug exactly as the archive has it."),
  date: date("The story's datePublished day (UTC)"),
  title: text("The story's published title."),
  join: z
    .enum(['must', 'optional'])
    .describe(
      '"must" when any careful editor would file it under this development; "optional" when reasonable editors could disagree (scoring ignores optional joins, so it is for real ambiguity only).',
    ),
  role: z
    .enum(['turning_point', 'routine'])
    .describe(
      '"turning_point" when the story changes what a reader should believe about where the development stands (a first, a new country, a declaration, a decision, a reversal, a marked jump or fall, a deal, a breakdown); "routine" when it mostly updates counts or repeats the known situation.',
    ),
  kind: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'One short lowercase word for a turning point (setback, response, spread, decision, escalation, deescalation, money, science, people, milestone); null for a routine entry.',
    ),
  values: z.array(valueSchema).default([]).describe('Every number the story states for one of the figures, from our published text only.'),
  statuses: z
    .array(statusSchema)
    .default([])
    .describe(
      'Only for developments where places or parties change state (countries affected, a talks process, a ceasefire): one row per change the story reports.',
    ),
  why: text('One line: why it belongs, or for an optional join why it is borderline.'),
})

/** A drafted item counts only once a person has checked it: absent means not reviewed (`awaitingReview`). */
const reviewed = z
  .boolean()
  .default(false)
  .describe('True once a person has checked the item against its story; false (or absent) for a draft, which the steps that read it refuse.')

const responseSchema = z.object({
  date: date('When the response was reported as under way: the date of the story that reports it'),
  what: text('What is being done about the development, by whom, in one line, e.g. "WHO ring vaccination in Bunia".'),
  slug: z.string().nullable().default(null).describe('The entry that reports it; null when none of our stories does.'),
  quote: z
    .string()
    .nullable()
    .default(null)
    .describe('The exact words from that story that report it, so a checker can find them; null exactly when `slug` is null.'),
  reviewed,
})

const nearMissSchema = z.object({
  slug: text("The story's slug exactly as the archive has it."),
  date: date("The story's datePublished day (UTC)"),
  title: text("The story's published title."),
  why: text('One line: what makes it look related, and why it must not join.'),
})

export const answerKeySchema = z.object({
  schemaVersion: z
    .union([z.literal(1), z.literal(2)])
    .describe('1, or 2 for a key that lists `responses` (decision D10: what is being done about the development).'),
  id: text('The development\'s id, also the file name (`keys/<id>.json`), e.g. "ebola-drc-2026".'),
  title: text('The development in a few words, e.g. "Ebola outbreak in eastern DR Congo".'),
  charter: z.object({
    in: z.string().describe('One or two sentences: what this development is, where, since when, and what kinds of stories belong.'),
    out: z.array(z.string()).describe('Each neighboring development or theme that must stay separate, as a short phrase.'),
    endEvent: z.string().describe('The event that would end it (for a closed development, the event that did).'),
  }),
  closed: z
    .object({
      slug: z.string().nullable().default(null).describe('The story that reports the end event; null when our stories never report it.'),
      date: date('When it ended'),
      quote: z
        .string()
        .nullable()
        .default(null)
        .describe('The exact words from that story that report the end, so a checker can find them; null without a slug.'),
      reviewed,
    })
    .nullable()
    .describe(
      'Null while the development is still open on 16 November 2026. Only an end event that matches charter.endEvent closes it. When our stories never report the end but it clearly ended, the slug is null and the notes say so.',
    ),
  figures: z
    .array(figureSchema)
    .default([])
    .describe('The 1 to 3 numbers a reader would want tracked over time, and only those that at least 3 of the entries state; empty when there is none.'),
  entries: z.array(entrySchema).default([]).describe('Every story that belongs, in date order (datePublished).'),
  nearMisses: z
    .array(nearMissSchema)
    .default([])
    .describe(
      '5 to 15 stories a careless system could join but should not: same place, same agency, same vocabulary, or a neighboring development; the most tempting first.',
    ),
  responses: z
    .array(responseSchema)
    .default([])
    .describe(
      'Version 2 only: each response under way that a reader of the overview should learn of, in date order, one row for each story that reports it under way (a response three stories report is three rows), so the stands of any day can be held to the stories of that time; a row with no slug where none of our stories reports it.',
    ),
  notes: z
    .string()
    .default('')
    .describe('Anything an evaluator must know: our stories disagreeing with each other, a count that changed definition, a borderline call and why.'),
})

export type AnswerKey = z.infer<typeof answerKeySchema>

/** The fewest values a figure needs: only a number at least 3 entries state is worth tracking. */
export const MIN_VALUES_PER_FIGURE = 3

const hasText = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim() !== ''

/** The rules across fields; an empty list for a key that keeps them all. */
export function validateKey(key: AnswerKey): string[] {
  const errors: string[] = []
  const figures = new Set(key.figures.map(f => f.key))
  const valueCounts = new Map<string, number>()
  const entrySlugs = new Set<string>()
  let previous = ''
  for (const e of key.entries) {
    if (e.date < previous) errors.push(`entries not in date order at ${e.slug} (${e.date} after ${previous})`)
    previous = e.date > previous ? e.date : previous
    if (entrySlugs.has(e.slug)) errors.push(`entry ${e.slug} listed twice`)
    entrySlugs.add(e.slug)
    if (e.role === 'turning_point' && !hasText(e.kind)) errors.push(`turning point ${e.slug} has no kind`)
    if (e.role === 'routine' && hasText(e.kind)) errors.push(`routine entry ${e.slug} has a kind`)
    for (const v of e.values) {
      if (!figures.has(v.figure)) errors.push(`${e.slug}: value for unknown figure ${v.figure}`)
      valueCounts.set(v.figure, (valueCounts.get(v.figure) ?? 0) + 1)
      if (!v.matches && !hasText(v.countedAs)) errors.push(`${e.slug}: a value that does not match its figure needs countedAs`)
      if (v.matches && hasText(v.countedAs)) errors.push(`${e.slug}: countedAs is set on a value that matches its figure`)
    }
  }
  for (const f of figures) {
    const count = valueCounts.get(f) ?? 0
    if (count < MIN_VALUES_PER_FIGURE) errors.push(`figure ${f} has ${count} values, fewer than ${MIN_VALUES_PER_FIGURE}`)
  }
  for (const n of key.nearMisses) if (entrySlugs.has(n.slug)) errors.push(`${n.slug} is both an entry and a near miss`)
  if (key.closed && hasText(key.closed.slug) && !entrySlugs.has(key.closed.slug)) errors.push(`closed.slug ${key.closed.slug} is not an entry`)
  if (key.closed && hasText(key.closed.quote) && !hasText(key.closed.slug)) errors.push('closed.quote is set without closed.slug')
  errors.push(...responseErrors(key, entrySlugs))
  return errors
}

/** The drafted items of one field a person has not reviewed yet: the responses, or the end (0 or 1). */
export function unreviewed(key: AnswerKey, field: 'responses' | 'closed'): number {
  if (field === 'responses') return key.responses.filter(r => !r.reviewed).length
  return key.closed && !key.closed.reviewed ? 1 : 0
}

/**
 * Why a step that reads `field` refuses to run on these keys: drafts in it no person has reviewed
 * (`key-draft` writes them with `reviewed: false`), so a reading would rest on unchecked key data.
 * Null when nothing is left to review.
 */
export function awaitingReview(keys: readonly AnswerKey[], field: 'responses' | 'closed'): string | null {
  const open = keys.flatMap(k => {
    const n = unreviewed(k, field)
    return n > 0 ? [`${k.id}: ${n}`] : []
  })
  if (open.length === 0) return null
  const total = keys.reduce((sum, k) => sum + unreviewed(k, field), 0)
  const what = field === 'responses' ? (total === 1 ? 'drafted response is' : 'drafted responses are') : total === 1 ? 'drafted end is' : 'drafted ends are'
  return `refused: ${total} ${what} not reviewed yet (${open.join(', ')}): in each key, mark every one "reviewed": true or delete it, then run again`
}

/** `responses` only in a version 2 key, in date order, each sourced by an entry with its quote or by none. */
function responseErrors(key: AnswerKey, entrySlugs: ReadonlySet<string>): string[] {
  if (key.schemaVersion === 1) return key.responses.length > 0 ? ['responses need schemaVersion 2'] : []
  const errors: string[] = []
  let previous = ''
  for (const r of key.responses) {
    if (r.date < previous) errors.push(`responses not in date order at "${r.what}" (${r.date} after ${previous})`)
    previous = r.date > previous ? r.date : previous
    if (hasText(r.slug) && !entrySlugs.has(r.slug)) errors.push(`response "${r.what}": slug ${r.slug} is not an entry`)
    if (hasText(r.slug) !== hasText(r.quote)) errors.push(`response "${r.what}": a quote goes with a slug, and none without one`)
  }
  return errors
}

/** The schema's errors (`path: message`), else `validateKey`'s; the key is null only when the schema fails. */
export function parseKey(json: unknown): { key: AnswerKey | null; errors: string[] } {
  const parsed = answerKeySchema.safeParse(json)
  if (!parsed.success) return { key: null, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }
  return { key: parsed.data, errors: validateKey(parsed.data) }
}
