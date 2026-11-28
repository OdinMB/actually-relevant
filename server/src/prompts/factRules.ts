/**
 * What the prompts that extract or structure a fact share about it (2026-11-25): how far its
 * statement may go, what its as-of date and its credit are, that a figure keeps its scope, where an
 * extraction reads the fields from (2026-11-28), and how the source's date is shown to a prompt that
 * asks for an as-of. One wording each, for research's
 * extraction (`prompts/research.ts`) and story context's structure call and extraction
 * (`prompts/storyContext.ts`); the fields' own descriptions are in `schemas/factFields.ts`.
 *
 * Every example in these rules and in those descriptions is invented and stays invented: a fact from
 * the eval's keys, either half, is never a prompt example, or the eval stops being a test of the rule
 * (`.context/prompting.md`).
 */
import { publishedDay } from '../services/researchChecks.js'

/** How far a fact's statement may go, and whose day a date in it is: for both extractions. */
export const STATEMENT_LIMITS = `- A statement goes exactly as far as the source. A count "since" a date keeps that start; a finding stays a finding, an estimate an estimate, a request, plan or forecast is never stated as done; things that happened at the same time are not said to be coordinated; the product, law or group the source names is named.
  Bad: 'The ministry said the reform would cut emissions by 40%.' for a source in which the ministry 'will ask parliament to consider' the reform. Good: 'The ministry said it would ask parliament to consider a reform it expects to cut emissions by 40%.'
  Bad: 'Floods have displaced 30,000 people.' for 'displaced 30,000 people since the dam failed on June 3'. Good: 'Floods have displaced 30,000 people since the dam failed on June 3.'
- The day someone said something is not the day it happened: 'the agency said on Thursday that the pipeline had been hit overnight' gives 'The agency said on Thursday that the pipeline had been hit overnight', never 'The pipeline was hit on Thursday'.`

/** A figure's scope: for a pass's extraction and the structure call. */
export const FIGURE_SCOPE_RULE = 'A figure keeps exactly what it counts: its scope, its place and its period, as the source gives them.'

/**
 * Where an extraction reads a fact's structured fields from (2026-11-28): the fact's support and its
 * statement, never the rest of the page. The fact check reads the support and the source's date and
 * nothing else, and judges every field of the record as a claim, so a place, date or credit taken from
 * elsewhere on the page rejected the whole fact (`.context/eval-baselines.md`, "Research facts' figure
 * fields, 2026-11-28"). For a pass's extraction and story context's extraction; the structure call,
 * which is shown only the support and the statement, says the same in its own words.
 */
export const FIELDS_FROM_FACT =
  "Every structured field comes from the fact's supporting sentence and its statement alone: a place, date or credit that neither of them states is never a field, even where the rest of the source gives it, and that field stays empty. Never add knowledge of your own."

/**
 * What a fact's as-of date is and when it stays empty: for a pass's extraction, the structure call
 * and story context's extraction. The `asOf` description says the same at length.
 */
export const AS_OF_RULE =
  'The as-of date is the day the fact\'s figure or state stood, or the day its event or statement took place, never the date its source was published, and only as precise as the fact says: a figure "for 2015" is "2015". The start of a period, the year of an earlier event, a future date and the date of another thing in the sentence are never the as-of date: the period stays in the statement and the field stays empty.'

/** Whom a fact credits: for a pass's extraction and the structure call. The `credited` description says the same at length. */
export const CREDIT_RULE =
  'The credit is who the source says the information comes from, never who acts in it. A fact the source tells in its own voice credits nobody.'

/**
 * A source's publication date as a prompt that asks for a fact's as-of date shows it: its day with
 * the weekday, "2026-11-12 (Thursday)", for any date `publishedDay` reads. The `asOf` description has
 * a weekday or "yesterday" in a source counted from this date, and the extraction runs with little
 * reasoning or none (`config.research.extractionEffort`), so it is given the weekday instead of
 * working it out. A date that cannot be read is shown as given, and no date as "unknown".
 */
export function publishedWithWeekday(date: string | null): string {
  const day = publishedDay(date)
  if (!day) return date?.trim() || 'unknown'
  return `${day} (${new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`
}
