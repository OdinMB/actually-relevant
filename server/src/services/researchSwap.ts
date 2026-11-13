/**
 * Which story columns a researched version replaces, and the values an apply writes there and a
 * revert restores (`.context/story-research.md`, "Applying a run"). Pure: `researchApply.ts` writes,
 * and the admin edit's lock (`storyWrites.ts`) reads the same list.
 *
 * The rating and its calculation are not among them: a story keeps its own rating whatever the
 * research's re-evaluation gave (owner decision 2026-11-12), and the draft's rating stays in the run
 * for evaluation.
 */
import { z } from 'zod'
import { writeSchema } from '../schemas/research.js'

/**
 * The parts of a run's draft an apply reads, checked when it is applied: a run's stored result is
 * not parsed again on read, and a draft stored by an older version of the write step may lack one.
 * A draft from before 2026-11-13, its paragraphs lists of cited sentences, fails it too: it was
 * neither written nor checked for our own words, so it is refused as the older format.
 */
export const appliedDraftSchema = writeSchema.pick({
  titleLabel: true,
  title: true,
  story: true,
  summary: true,
  whyThisMatters: true,
  caveats: true,
  quote: true,
  quoteAttribution: true,
  quoteSourceId: true,
  marketingBlurb: true,
})
export type AppliedDraft = z.infer<typeof appliedDraftSchema>

const text = z.string().nullable()

/**
 * What `stories.pre_research` holds: every swapped column's value before the first apply. Its keys
 * are the swapped columns, `relevanceSummary` among them, which research writes none of. A snapshot
 * taken while applies still swapped the rating also holds `relevance` and `relevanceCalculation`;
 * reading it drops them, so a revert leaves the rating alone.
 */
const snapshotSchema = z.object({
  title: text,
  titleLabel: text,
  summary: text,
  quote: text,
  quoteAttribution: text,
  marketingBlurb: text,
  relevanceReasons: text,
  relevanceSummary: text,
  antifactors: text,
})

/** The values of the swapped columns, as an apply writes them or a snapshot holds them. */
export type SwappedValues = z.infer<typeof snapshotSchema>
export type SwappedField = keyof SwappedValues

/** The story columns an applied research run writes, and an admin edit may not change while it is applied. */
export const SWAPPED_FIELDS: readonly SwappedField[] = snapshotSchema.keyof().options

/** A Prisma `select` of the swapped columns. */
export const SWAPPED_SELECT = Object.fromEntries(SWAPPED_FIELDS.map(field => [field, true])) as Record<SwappedField, true>

const orNull = (value: string) => value || null

/** Bullets as the assessment writes them: one Markdown bullet per line. */
const bullets = (items: { text: string }[]) => orNull(items.map(item => `- ${item.text}`).join('\n'))

/** The swapped columns as a run's draft writes them; `relevanceSummary` null, so its readers fall back to the researched text. */
export function researchedValues(draft: AppliedDraft): SwappedValues {
  return {
    title: orNull(draft.title),
    titleLabel: orNull(draft.titleLabel),
    summary: orNull(draft.summary),
    quote: orNull(draft.quote),
    quoteAttribution: orNull(draft.quoteAttribution),
    marketingBlurb: orNull(draft.marketingBlurb),
    relevanceReasons: bullets(draft.whyThisMatters),
    relevanceSummary: null,
    antifactors: bullets(draft.caveats),
  }
}

/** The swapped columns of a story row, for the snapshot. */
export function snapshotOf(story: SwappedValues): SwappedValues {
  return Object.fromEntries(SWAPPED_FIELDS.map(field => [field, story[field]])) as SwappedValues
}

/** A stored snapshot read back; null when it is not a whole snapshot. */
export function restoredValues(stored: unknown): SwappedValues | null {
  const parsed = snapshotSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}

/** The swapped columns an edit changes: present in it with a value other than the current one. */
export function swappedEdits(edit: Partial<Record<string, unknown>>, current: SwappedValues): SwappedField[] {
  return SWAPPED_FIELDS.filter(field => edit[field] !== undefined && edit[field] !== current[field])
}
