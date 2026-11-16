/**
 * Structured outputs of the story context prompts (`prompts/storyContext.ts`) and the stored box
 * shape (`context_boxes.sentences` and `.visual`). Format guidance lives in the `.describe()`s
 * (`.context/prompting.md`, "Schema carries format guidance"); each schema is part of its step's
 * prompt version (`CONTEXT_PROMPT_VERSIONS`), so a changed description changes the version.
 * The fact and box checks reuse research's `factCheckSchema` unchanged.
 */
import { z } from 'zod'
import { SOURCE_KINDS } from './research.js'

/** The checklist a story's context is built from (.context/story-context.md, "Slots"). */
export const CONTEXT_SLOTS = ['compared', 'why_now', 'build_up', 'who_affected', 'response', 'next', 'key_term'] as const
export type ContextSlot = (typeof CONTEXT_SLOTS)[number]

/** A stored box's type: a slot, or the figures box. */
export const BOX_TYPES = [...CONTEXT_SLOTS, 'figures'] as const
export type BoxType = (typeof BOX_TYPES)[number]

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

export const structureSchema = z.object({
  facts: z
    .array(z.object({ id: z.string().describe('The id of the fact in <FACTS>, e.g. "S2F3".'), ...structuredFactFields }))
    .describe('One entry for every fact in <FACTS>, in its order.'),
})

export const gapListSchema = z.object({
  slots: z
    .array(
      z.object({
        slot: z.enum(CONTEXT_SLOTS),
        needed: z.boolean().describe('True when a reader of this story needs it to understand the development; "response" is always needed.'),
        covered: z
          .enum(['yes', 'partly', 'no'])
          .describe(
            'Whether the facts in <FACTS> marked current, or the story itself, answer it: yes, partly or no. Expired facts cover nothing that is still changing.',
          ),
      }),
    )
    .describe('One entry for each slot of <CHECKLIST>, in its order.'),
  responseInStory: z
    .string()
    .describe(
      'When <STORY> itself reports what is being done about the problem (a new policy, a programme under way, a solution tried): its sentence that reports it, copied exactly. Empty string otherwise.',
    ),
  searches: z
    .array(
      z.object({
        slot: z.enum(CONTEXT_SLOTS),
        wanted: z.string().describe('What the search should find, in one line ("how the 2026 burned area compares with the 2015 record").'),
        query: z.string().describe('A web search query of 4-10 words, as a person would type it. No quotation marks, operators or dates.'),
        recent: z.boolean().describe('True when only data from the 30 days before the story can answer it (a current count or status). False otherwise.'),
      }),
    )
    .describe('At most 3 searches, most important first, each for a needed slot the facts do not cover. Empty when nothing needed is missing.'),
})

export const contextExtractionSchema = z.object({
  usable: z
    .boolean()
    .describe('False when the text states no fact: a paywall or login notice, a cookie, error or index page, a list of links or headlines. True otherwise.'),
  kind: z
    .enum(SOURCE_KINDS)
    .describe(
      'news-report: reporting by a news outlet or agency. analysis: an explanatory or analytical piece. opinion: an editorial, column or commentary. ' +
        "press-release: an organization's own announcement, or a copy of one. official-body: a government, court, international organization or research body publishing its own findings. other: anything else.",
    ),
  outlet: z
    .string()
    .describe(
      'Name of the outlet or body that publishes the page at <URL>, in its own spelling. Empty string when neither the text nor the address shows a name.',
    ),
  facts: z
    .array(
      z.object({
        statement: z
          .string()
          .describe(
            'One fact in one plain English sentence, true to the source: a figure keeps its unit, its scope and its period, and a claim keeps who makes it. Your own order and phrasing, never a translation of the supporting sentence.',
          ),
        supportingSentence: z
          .string()
          .describe('The sentence of the source text that states the fact, copied character for character in its original language.'),
        slot: z.enum(CONTEXT_SLOTS).describe('The slot of <WANTED> the fact answers.'),
        ...structuredFactFields,
      }),
    )
    .describe('At most 5 facts that answer an item of <WANTED>, most useful first. Empty when the source answers none or is unusable.'),
})

const citedSentence = z.object({
  text: z.string().describe('One sentence in your own words, plain text, no Markdown and no fact ids in the text.'),
  factIds: z.array(z.string()).describe('The ids of the facts in <FACTS> that state everything the sentence claims.'),
})

const tileSpec = z.object({
  label: z.string().describe('What the number counts, with its place and period, in at most 8 words ("people under hazardous smoke, Southeast Asia").'),
  factIds: z.array(z.string()).describe('The facts that give this number: one, or several when sources give it for the same thing.'),
})

const pointSpec = z.object({
  label: z.string().describe('The point\'s label on the chart: a year, a date or a place ("2015", "Riau").'),
  factId: z.string().describe('The one fact that gives the value of this point.'),
})

export const boxesSchema = z.object({
  figures: z
    .object({
      heading: z.string().describe('At most 8 words.'),
      teaser: z.string().describe("The phone's one-line note: at most 8 words."),
      tiles: z.array(tileSpec).describe('1-4 big-number tiles, each from current facts.'),
    })
    .nullable()
    .describe('The "In numbers" box: the story\'s key figures as tiles. Null when fewer than one current figure is worth a tile.'),
  boxes: z
    .array(
      z.object({
        slot: z.enum(CONTEXT_SLOTS),
        heading: z.string().describe('At most 8 words.'),
        teaser: z.string().describe("The phone's one-line note under its paragraph or point: at most 8 words."),
        place: z.string().describe('The id of the story paragraph ("P2") or Why This Matters point ("W1") the box adds most to, or "section".'),
        sentences: z.array(citedSentence).describe('0-3 sentences.'),
        visual: z.object({
          kind: z.enum(['none', 'tiles', 'bars', 'line']),
          tiles: z.array(tileSpec).describe('For tiles: 1-4 tiles. Empty otherwise.'),
          measure: z.string().describe('For bars and line: what every point measures, with its scope ("area burned in Indonesia"). Empty string otherwise.'),
          unit: z.string().describe('For bars and line: the one unit of every point ("hectares"). Empty string otherwise.'),
          points: z.array(pointSpec).describe('For bars: 2 or more points. For a line: 3 or more points, each at a different date. Empty otherwise.'),
          apart: z
            .object({
              measure: z.string(),
              unit: z.string(),
              points: z.array(pointSpec),
            })
            .nullable()
            .describe('For bars: points of a different measure shown beside the comparison, never in it. Null otherwise.'),
        }),
      }),
    )
    .describe('At most 6 context boxes, each answering one slot, most useful first.'),
})

export type StructureAnswer = z.infer<typeof structureSchema>
export type GapList = z.infer<typeof gapListSchema>
export type ContextExtraction = z.infer<typeof contextExtractionSchema>
export type BoxesAnswer = z.infer<typeof boxesSchema>
export type WrittenBox = BoxesAnswer['boxes'][number]

// ---------------------------------------------------------------------------
// The stored box shape: sentences and visuals cite their run's facts by ref
// ---------------------------------------------------------------------------

export const storedSentencesSchema = z.array(z.object({ text: z.string(), factIds: z.array(z.string()) }))
export type StoredSentence = z.infer<typeof storedSentencesSchema>[number]

const storedPoint = z.object({ label: z.string(), factId: z.string() })
const storedTile = z.object({ label: z.string(), factIds: z.array(z.string()) })

export const storedTilesSchema = z.object({ kind: z.literal('tiles'), tiles: z.array(storedTile) })

export const storedChartSchema = z.object({
  kind: z.enum(['bars', 'line']),
  measure: z.string(),
  unit: z.string(),
  points: z.array(storedPoint),
  apart: z.object({ measure: z.string(), unit: z.string(), points: z.array(storedPoint) }).nullable(),
})

/** `context_boxes.visual`: a validated tiles, bars or line spec, citing fact refs. */
export const storedVisualSchema = z.union([storedTilesSchema, storedChartSchema])

export type StoredTiles = z.infer<typeof storedTilesSchema>
export type StoredChart = z.infer<typeof storedChartSchema>
export type StoredVisual = z.infer<typeof storedVisualSchema>
export type StoredTile = StoredTiles['tiles'][number]
export type StoredPoint = StoredChart['points'][number]

// ---------------------------------------------------------------------------
// The admin's requests (routes/admin/storyContext.ts)
// ---------------------------------------------------------------------------

export const contextHiddenSchema = z.object({ hidden: z.boolean() }).strict()

export const contextBoxUpdateSchema = z
  .object({
    hidden: z.boolean().optional(),
    place: z
      .string()
      .regex(/^(?:[PW][1-9]\d*|section)$/, 'P<n>, W<n> or section')
      .optional(),
  })
  .strict()
  .refine(b => b.hidden !== undefined || b.place !== undefined, 'Give hidden, place or both')
