/**
 * Structured outputs of the draft research prompts (`prompts/research.ts`). Format guidance lives in
 * the `.describe()`s (`.context/prompting.md`, "Schema carries format guidance"); eval:research
 * sends them under `versionedSchemaName`, so editing a description is never answered from its old cache.
 */
import { z } from 'zod'
import { EMOTION_TAG_DEFINITIONS } from '../prompts/shared.js'
import { EMOTION_TAGS } from './llm.js'

export const SOURCE_KINDS = ['news-report', 'analysis', 'opinion', 'press-release', 'official-body', 'other'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const queriesSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z
          .string()
          .describe(
            'A news search query of 4-10 words naming the main actors, the action and the place of the development, as a headline would. No quotation marks, operators or dates.',
          ),
        language: z.string().describe('ISO 639-1 code of the language the query is written in, e.g. "en" or "de".'),
      }),
    )
    .describe('The queries in the order asked for: English first.'),
})

const factSchema = z.object({
  statement: z
    .string()
    .describe(
      'One fact in one plain English sentence, true to the source: a figure keeps its unit, its scope and its period, and a claim keeps who makes it. ' +
        'A neutral restatement in your own order and phrasing, never a translation or a rewording of the supporting sentence.',
    ),
  supportingSentence: z.string().describe('The sentence of the source text that states the fact, copied character for character in its original language.'),
  measures: z
    .string()
    .describe(
      'For a fact with a figure: what the figure counts or measures, with its scope and period (e.g. "rooftop solar capacity added in Pakistan, 2024-2025"). Empty string for a fact without a figure.',
    ),
})

export const extractionSchema = z.object({
  usable: z
    .boolean()
    .describe(
      'False when the text states no fact about any development: a paywall or login notice, a cookie, error or index page, a list of links or headlines. True otherwise.',
    ),
  relation: z
    .enum(['same-development', 'background', 'off-topic'])
    .describe(
      'same-development: reports the development of <STORY> itself. background: an earlier development of the same story, or context that explains it. off-topic: anything else, including a different development that only shares the topic.',
    ),
  kind: z
    .enum(SOURCE_KINDS)
    .describe(
      'news-report: reporting by a news outlet or agency. analysis: an explanatory or analytical piece. opinion: an editorial, column or commentary. ' +
        "press-release: an organization's own announcement, or a copy of one. official-body: a government, court, international organization or research body publishing its own findings. other: anything else.",
    ),
  outlet: z
    .string()
    .describe(
      "Name of the outlet that publishes the page at <URL>, as its text or address shows it, in the outlet's own spelling (e.g. 'CleanTechnica' for cleantechnica.com). " +
        'Never a news agency or another outlet the page credits. Empty string when neither the text nor the address shows a name.',
    ),
  country: z.string().describe('Country where the outlet is based, as an English country name; "unknown" when neither the text nor the URL shows it.'),
  facts: z
    .array(factSchema)
    .describe(
      'At most 8 facts about the development of <STORY> or background that explains it, most important first. Empty when the source is unusable or off-topic.',
    ),
  voices: z
    .array(
      z.object({
        name: z.string().describe('Full name of the person or organization.'),
        role: z.string().describe('Their role or title, e.g. "prime minister of Pakistan"; empty string when the source gives none.'),
        stance: z.string().describe('Their position on the development, in one short English sentence.'),
        quote: z
          .string()
          .describe('Their words exactly as the source quotes them, in the original language; empty string when the source only paraphrases them.'),
      }),
    )
    .describe('At most 4 named people or organizations the source quotes or paraphrases on the development.'),
})

export const earlierSchema = z.object({
  stories: z
    .array(
      z.object({
        number: z.number().int().describe('The candidate number from <EARLIER_STORIES>.'),
        relation: z
          .enum(['earlier-development', 'background', 'unrelated'])
          .describe(
            'earlier-development: an earlier development of the same story as <STORY>. background: context a reader of <STORY> needs to understand it. unrelated: anything else, including a story that only shares a topic, country or actor.',
          ),
        facts: z
          .array(
            z.object({
              statement: z.string().describe('One fact in one plain English sentence, with the date it refers to when the text gives one.'),
              supportingSentence: z.string().describe("The sentence of the candidate's text that states the fact, copied character for character."),
            }),
          )
          .describe('Up to 3 facts from the candidate that <STORY> needs as context. Empty for an unrelated candidate.'),
      }),
    )
    .describe('One entry per candidate in <EARLIER_STORIES>.'),
})

const citedParagraph = z.object({
  text: z.string().describe('One paragraph of 2-4 short sentences in plain text, no Markdown, no fact ids, no quotation marks.'),
  factIds: z.array(z.string()).describe('Ids of every fact in <FACTS> the paragraph states, e.g. ["S1F2", "S3F1"].'),
})

const citedBullet = z.object({
  text: z.string().describe('The bullet in plain text, 1-2 sentences, no Markdown, no leading dash, no fact ids, no quotation marks.'),
  factIds: z.array(z.string()).describe('Ids of the facts in <FACTS> the bullet states; empty for a bullet that only judges.'),
})

export const writeSchema = z.object({
  titleLabel: z
    .string()
    .describe(
      'Ultra-short topic label (1-3 short words, sentence case). ' +
        "A tight noun phrase — no conjunctions, no 'and'. Keep words simple and short. " +
        'The label and title work as a pair: the label sets the topic, the title tells the story. ' +
        'Apart from one core subject word the title may reuse, no word or phrase should appear in both.',
    ),
  title: z
    .string()
    .describe(
      'Standalone headline, max 10 words, sentence case (capitalize first word and proper nouns only). ' +
        'Write for a smart 16-year-old — no jargon or insider terms. ' +
        'Must make sense to someone with no background, and without the label: name the subject. ' +
        "Be concrete: name the actor, action, or stakes. NEVER use the 'Label: headline' colon pattern. No quotation marks.",
    ),
  story: z.array(citedParagraph).describe('The story: 2-4 paragraphs, 150-250 words in total, each citing the facts it states.'),
  summary: z.string().describe('Plain text summary of the development, 40-70 words, for cards and feeds. No fact ids.'),
  whyThisMatters: z.array(citedBullet).describe('Exactly 3 bullets on why the development matters.'),
  caveats: z.array(citedBullet).describe('1-3 bullets on what limits the development or makes it uncertain.'),
  quote: z
    .string()
    .describe(
      "Key quote, translated to English if needed. No speaker or outlet name, no surrounding quotation marks; single quotes (' ') for any nested quotation.",
    ),
  quoteAttribution: z
    .string()
    .describe("The quoted person's full name and role (e.g. 'Maria Helena Semedo, FAO Deputy Director'), or the organization or outlet quoted."),
  quoteSourceId: z
    .string()
    .describe('Id of the source the quote comes from, e.g. "S2", never a quote\'s id such as "S2Q1" nor an earlier story\'s such as "E1".'),
  marketingBlurb: z
    .string()
    .describe('Plain text, 25-30 words and never more than 230 characters including spaces. Opens with the development itself, never with an outlet.'),
  emotionTag: z
    .enum(EMOTION_TAGS)
    .describe(`Emotion tag based on how the story you write affects readers, judged on that story rather than on <ARTICLE>. ${EMOTION_TAG_DEFINITIONS}`),
  relevanceCalculation: z
    .array(z.string())
    .describe(
      'Markdown bullet points showing the rating calculation steps. ' +
        'Format: "- **[Key factor]:** [rating 1-10]", ' +
        '"- **[Generic limiting factor]:** [modifier +0 to -4]", ' +
        '"- **[Other factors combined]:** [modifier +/- 0-2]".',
    ),
  rating: z.number().int().min(1).max(10).describe('Final relevance rating 1-10: the result of the relevance calculation'),
  oldNews: z.object({
    isOld: z.boolean().describe('True when the main development first happened before the date given in <OLD_NEWS>.'),
    firstHappened: z.string().describe('The date the main development first happened, YYYY-MM-DD, or "unknown".'),
  }),
  contradicted: z.object({
    isContradicted: z
      .boolean()
      .describe(
        'True when credible sources in <FACTS> disagree about the main claim of <ARTICLE> at the same time and no later report settles it, as <CONTRADICTED> defines it. False when a later report reverses, updates or settles the claim: the story gives that latest state instead.',
      ),
    factIds: z.array(z.string()).describe('Ids of the contradicting facts; empty when not contradicted.'),
  }),
})

export const factCheckSchema = z.object({
  items: z
    .array(
      z.object({
        number: z.number().int().describe('The item number from <ITEMS>.'),
        supported: z
          .boolean()
          .describe(
            'True when every factual claim of the item (each number, name, date, place and event) is stated by a fact of its evidence (its cited facts, or every fact in <POOL> for an item marked AGAINST_POOL), with the same scope and the qualifiers that fact gives; a number also when it is given in other words, rounded or in another unit. True for an item with neither cited facts nor AGAINST_POOL, unless it states one of its NUMBERS_NOT_FOUND as a fact. For the key quote: true when a quote or sentence of its QUOTED_SOURCE says it, with the speaker its ATTRIBUTION names.',
          ),
        problem: z
          .string()
          .describe(
            'When not supported: the claim its evidence does not state, or for the key quote what its source does not say, in one short sentence. Empty string otherwise.',
          ),
        key: z
          .boolean()
          .describe(
            'Only for an item labeled "Title", "Story paragraph 1", "Summary" or "Blurb" that is not supported: true when the unsupported claim is the main development itself (that it happened, who did it, or its central figure); false for a detail such as an exact date, a side figure, an attribution or a background point. False when supported, and always for every other item: a later paragraph, a bullet, a caveat and the key quote.',
          ),
        copiedSentence: z
          .string()
          .describe(
            'The id in <SOURCE_WORDING> (e.g. "S2F3", "S2Q1", "S2T") of a source sentence, quote or title whose expression any one sentence of the item reproduces (its distinctive phrasing or a sentence structure the facts do not dictate), in nearly the same words or as a close translation, in any language. Empty string when none does, when a sentence only plainly states a fact the source states, and always for the key quote.',
          ),
        followsSource: z
          .string()
          .describe(
            'The id (e.g. "S2") of the one source whose points several sentences of the item follow in that source\'s order and phrasing, while the item draws on other sources too. Empty string when none, when the item\'s cited facts all come from that one source, and always for the key quote.',
          ),
      }),
    )
    .describe('One entry per item in <ITEMS>.'),
})

/** A repair round's answer: new texts for the failing items only (`.context/story-research.md`, "Repair"). */
export const repairSchema = z.object({
  items: z
    .array(
      z.object({
        label: z.string().describe('The label of an item in <REPAIRS>, exactly as given there, e.g. "Story paragraph 2".'),
        text: z
          .string()
          .describe("The item's new text in plain text, about as long as the text it replaces: no Markdown, no leading dash, no fact ids, no quotation marks."),
        factIds: z
          .array(z.string())
          .describe(
            'Ids of every fact in <FACTS> the new text states, e.g. ["S1F2", "S3F1"]. Empty for the title, the summary, the blurb and a bullet that only judges.',
          ),
      }),
    )
    .describe('One entry per item in <REPAIRS> other than the key quote, in their order.'),
  quote: z
    .string()
    .describe(
      "When <REPAIRS> holds the key quote: the new key quote, translated to English if needed, with no speaker or outlet name and no surrounding quotation marks; single quotes (' ') for any nested quotation. Empty string otherwise.",
    ),
  quoteAttribution: z
    .string()
    .describe("With a new key quote: the quoted person's full name and role, or the organization or outlet quoted. Empty string otherwise."),
  quoteSourceId: z
    .string()
    .describe(
      'With a new key quote: id of the source it comes from, e.g. "S2", never a quote\'s id such as "S2Q1" nor an earlier story\'s such as "E1". Empty string otherwise.',
    ),
})

/** The derived fields written again from the kept story alone (`.context/story-research.md`, "Repair"). */
export const deriveSchema = writeSchema.pick({ title: true, summary: true, marketingBlurb: true })

export type Queries = z.infer<typeof queriesSchema>
export type Extraction = z.infer<typeof extractionSchema>
export type Earlier = z.infer<typeof earlierSchema>
export type Draft = z.infer<typeof writeSchema>
export type FactCheck = z.infer<typeof factCheckSchema>
export type Repair = z.infer<typeof repairSchema>
export type Derived = z.infer<typeof deriveSchema>
