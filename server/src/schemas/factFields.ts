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
      'The figure the fact states, as a plain number in its unit: 12.5 million people is 12500000, 63% is 63, $1.2 billion is 1200000000. The low end of a range. Null for a fact without a figure. ' +
        'Null too when the source gives no number for it: a vague amount ("hundreds", "dozens", "several"), an ordinal ("the second phase", "a third term"), a calendar year, a date or a time.',
    ),
  valueHigh: z
    .number()
    .nullable()
    .describe(
      'The high end of a range the source gives as one ("5,000 to 5,400 dead" gives 5400). Otherwise the same number as value: a part of a total ("14 of more than 60 libraries") is one number, never a range.',
    ),
  unit: z
    .string()
    .describe(
      'What one of the value is, short and in English: "people", "hectares", "%", "USD", "GW", "°C". Empty string for a fact without a figure, and so for a calendar year, a date, an ordinal ("the seventh lap") or a vague amount ("dozens"), which are never a figure. A rate keeps its period: "tonnes per day", "USD per year".',
    ),
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
      'For a fact with a figure: what the figure counts or measures, with its scope, as a short noun phrase ("area burned in Indonesia", "people under hazardous smoke in Southeast Asia"). Empty string for a fact without a figure, as for a calendar year, a date, an ordinal or a vague amount. It names the one thing the value counts, never a second figure.',
    ),
  place: z
    .string()
    .describe(
      'The country, region or city the fact is about, as its supporting sentence or statement names it, in English and no wider: "southern Norway" stays "southern Norway", never "Norway". Empty string when neither names one, even where the rest of the source does.',
    ),
  asOf: z
    .string()
    .describe(
      'The day, month or year at which the fact\'s figure or state stood, or on which its event or statement took place, as its supporting sentence or statement dates it: "YYYY-MM-DD", "YYYY-MM" or "YYYY", only as precise as the source says ("4,300 homes without power as of July 9" gives the day, "burned in 2015" gives "2015"). ' +
        'A weekday, "today" or "yesterday" is the calendar day it names, counted from the source\'s publication date: "today" is that date itself. ' +
        'A claim, forecast or warning takes the date it was made where the sentence gives that date ("officials said in May 2025 that the dam would be finished by 2030" gives "2025-05"). ' +
        'Empty string when the source dates the fact only by its own publication, and whenever the only date at hand is something else: the start of a period ("since August", "since 1995", "from September to November"), the year of an earlier event the fact follows ("after the 2019 floods"), a date still in the future (the date a forecast is for, a deadline, a scheduled meeting), or the date of another thing the sentence mentions (when a law was adopted, in a fact about what the law requires).',
    ),
  credited: z
    .string()
    .describe(
      'The person or body the fact\'s supporting sentence or statement says this information comes from, by the name they give: who reported, said, counted or estimated it ("Indonesia\'s disaster agency", "the World Health Organization"). ' +
        'Never who acts in the fact, owns the thing described or adopted it: "the regulator fined the airline" credits nobody, "the regulator said it had fined the airline" credits the regulator. ' +
        'In a sentence with several claims, only the body credited with this one. Empty string when the source states it in its own voice, and when neither the sentence nor the statement credits anyone, even where the rest of the source does.',
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
