/**
 * Structured outputs of the story context prompts (`prompts/storyContext.ts`) and the stored box
 * shape (`context_boxes.sentences` and `.visual`). Format guidance lives in the `.describe()`s
 * (`.context/prompting.md`, "Schema carries format guidance"); each schema is part of its step's
 * prompt version (`CONTEXT_PROMPT_VERSIONS`), so a changed description changes the version.
 * The fact and box checks reuse research's `factCheckSchema` unchanged.
 */
import { z } from 'zod'
import { structuredFactFields } from './factFields.js'
import { SOURCE_KINDS } from './research.js'

/** The checklist a story's context is built from (.context/story-context.md, "Slots"). */
export const CONTEXT_SLOTS = ['compared', 'why_now', 'build_up', 'who_affected', 'response', 'next', 'key_term'] as const
export type ContextSlot = (typeof CONTEXT_SLOTS)[number]

/** The slots the gap list's general searches serve: `response` has its own two (`responseSearches`). */
export const SEARCH_SLOTS = ['compared', 'why_now', 'build_up', 'who_affected', 'next', 'key_term'] as const satisfies readonly Exclude<
  ContextSlot,
  'response'
>[]

/**
 * Whether a stored box's type is a slot. The database's `ContextBoxType` still holds `figures`, the
 * In numbers box written until 2026-11-17, for its stored rows; those are never read back.
 */
export const isContextSlot = (type: string): type is ContextSlot => (CONTEXT_SLOTS as readonly string[]).includes(type)

// The structured fields live in their own module, which research's coverage extraction shares
export { APPROX, CREDITED_KINDS, VALIDITY, structuredFactFields, type Approx, type CreditedKind, type StructuredFact, type Validity } from './factFields.js'

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
  responseSearches: z
    .object({
      action: z
        .string()
        .describe(
          'A web search query of 4-10 words for who is responding to this problem and what is being done about it, as a person would type it. No quotation marks, operators or dates. Empty string when "response" is covered or the story reports it.',
        ),
      elsewhere: z
        .string()
        .describe(
          'A web search query of 4-10 words for what has worked against the same problem in other places or at other times, as a person would type it. No quotation marks, operators or dates. Empty string when "response" is covered or the story reports it.',
        ),
    })
    .describe('The two searches for "response", from two angles.'),
  searches: z
    .array(
      z.object({
        slot: z.enum(SEARCH_SLOTS),
        wanted: z.string().describe('What the search should find, in one line ("how the 2026 burned area compares with the 2015 record").'),
        query: z.string().describe('A web search query of 4-10 words, as a person would type it. No quotation marks, operators or dates.'),
        recent: z.boolean().describe('True when only data from the 30 days before the story can answer it (a current count or status). False otherwise.'),
      }),
    )
    .describe(
      'At most 3 searches for the slots other than "response", most important first, each for a needed slot the facts do not cover. Empty when nothing needed is missing.',
    ),
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
  label: z
    .string()
    .describe(
      'What the number counts that the box\'s heading does not say, with its place, in at most 8 words ("people under hazardous smoke, Southeast Asia"). A period only when it differs from the date of the box\'s newest fact, which the card shows. Empty string for the one tile of a box whose heading already says what it counts.',
    ),
  factIds: z.array(z.string()).describe('The facts that give this number: one, or several when sources give it for the same thing.'),
})

const pointSpec = z.object({
  label: z.string().describe('The point\'s label on the chart: a year, a date or a place ("2015", "Riau").'),
  factId: z.string().describe('The one fact that gives the value of this point.'),
})

export const boxesSchema = z.object({
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
          tiles: z.array(tileSpec).describe("For tiles: 1-4 tiles, each a current figure that answers the box's slot. Empty otherwise."),
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
