/**
 * A fact's structured fields (its figure, unit, scope, place, date, credit and validity): story
 * context's structure step and extraction return them (`schemas/storyContext.ts`), and a research
 * pass's coverage extraction too (`coverageExtractionSchema`, `schemas/research.ts`). Their own module,
 * so both schemas import them without importing each other; with how a text field the model returned
 * is read (`fieldText`), which both the structuring and the checks that show the fields use.
 */
import { z } from 'zod'

/** What the model writes into a text field instead of leaving it empty (measured 2026-11-24: "according to none", "in unknown"). */
const FILLERS: ReadonlySet<string> = new Set([
  'none',
  'unknown',
  'n/a',
  'null',
  'not specified',
  'unspecified',
  'not stated',
  'not given',
  'not applicable',
  'not available',
  '-',
  '–',
  '—',
])

/** A text field as written, trimmed; empty when the whole field is a filler ("None", "n/a.", never "None of the provinces"). */
export function fieldText(value: string): string {
  const text = value.trim()
  return FILLERS.has(text.toLowerCase().replace(/\.$/, '')) ? '' : text
}

export const APPROX = ['exact', 'about', 'at_least', 'under'] as const
export type Approx = (typeof APPROX)[number]

export const CREDITED_KINDS = ['official', 'research', 'news', 'other'] as const
export type CreditedKind = (typeof CREDITED_KINDS)[number]

export const VALIDITY = ['fixed', 'slow', 'fast'] as const
export type Validity = (typeof VALIDITY)[number]

/** The structured fields of one fact, as the structure step returns them for research's facts and the extraction for its own. */
export const structuredFactFields = {
  value: z
    .number()
    .nullable()
    .describe(
      'The figure the fact states, as a plain number in its unit: 12.5 million people is 12500000, 63% is 63, $1.2 billion is 1200000000. The low end of a range. Null for a fact without a figure.',
    ),
  valueHigh: z.number().nullable().describe('The high end of a range ("5,000 to 5,400 dead" gives 5400). Null otherwise.'),
  unit: z
    .string()
    .describe('What one of the value is, short and in English: "people", "hectares", "%", "USD", "GW", "°C". Empty string for a fact without a figure.'),
  approx: z
    .enum(APPROX)
    .describe(
      'How the source qualifies the figure. about: "nearly", "some", "around", "an estimated". at_least: "more than", "over", "at least". under: "fewer than", "up to", "below". exact otherwise, and for a fact without a figure.',
    ),
  provisional: z
    .boolean()
    .describe('True when the source gives the figure or claim as preliminary, projected, planned, or an estimate still to be confirmed. False otherwise.'),
  counted: z
    .string()
    .describe(
      'For a fact with a figure: what the figure counts or measures, with its scope, as a short noun phrase ("area burned in Indonesia", "people under hazardous smoke in Southeast Asia"). Empty string for a fact without a figure.',
    ),
  place: z.string().describe('The country, region or city the fact is about, as the source names it in English. Empty string when it names none.'),
  asOf: z
    .string()
    .describe(
      'The date the fact describes, which is not the date the source was published: "YYYY-MM-DD", "YYYY-MM" or "YYYY", only as precise as the source says ("in 2015" gives "2015"). Empty string when the source dates the fact only by its own publication.',
    ),
  credited: z
    .string()
    .describe(
      'Who the source credits the fact to, by name ("Indonesia\'s disaster agency", "the World Health Organization"). Empty string when the source states it on its own authority.',
    ),
  creditedKind: z
    .enum([...CREDITED_KINDS, 'none'])
    .describe(
      'The kind of body credited. official: a government, agency, court or international organization. research: a university, research institute or scientific study. news: a news outlet or agency. other: a company, charity or anyone else. none when nobody is credited.',
    ),
  validity: z
    .enum(VALIDITY)
    .describe(
      'How long the fact stays true. fixed: a past event or a figure for a closed period, which never changes ("2.6 million hectares burned in 2015"). slow: a state that changes over months or years (a population, a share, a long trend, a law in force). fast: a count, status or decision that changes within days or weeks (cases, a death toll still rising, an approval, a ceasefire).',
    ),
}

export type StructuredFact = z.infer<z.ZodObject<typeof structuredFactFields>>
