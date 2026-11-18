/**
 * Structured outputs of the overview linking prompts (`prompts/overviews.ts`; `.context/overviews.md`,
 * "How a story is linked"): the link confirmation per candidate, with the shared cause, place and end
 * quoting both sides and the story's role; the founding draft (charter, title, both stories' roles);
 * and the founding check, blind to the draft's reasons. Format guidance lives in the `.describe()`s
 * (`.context/prompting.md`, "Schema carries format guidance"); each schema is part of its prompt's
 * version (`OVERVIEW_PROMPT_VERSIONS`).
 */
import { z } from 'zod'
import { ENTRY_ROLES, ROLE_KINDS } from '../services/overviewTypes.js'

const quotePair = (what: string) =>
  z
    .object({
      story: z.string().describe(`The words of <STORY> that state ${what}, copied exactly from its title, label or summary. Empty when it states none.`),
      other: z
        .string()
        .describe(
          `The words of the candidate that state ${what}, copied exactly: from an overview's TITLE, IN or END_EVENT (never its OUT entries), or from a story's title, label or summary. Empty when it states none.`,
        ),
    })
    .describe(`Where both sides state ${what}.`)

const roleKind = z.enum(ROLE_KINDS).nullable().describe('For a turning point, the one kind that fits best, as <ROLES> defines them; null for a routine story.')

const role = z.enum(ENTRY_ROLES).describe('turning_point or routine, as <ROLES> defines them.')

export const linkSchema = z.object({
  candidates: z
    .array(
      z.object({
        id: z.string().describe('The id of a candidate in <OVERVIEWS> or <STORIES>, exactly as given there, e.g. "O1" or "F2".'),
        belongs: z
          .enum(['yes', 'no', 'unsure'])
          .describe(
            'yes: the story and the candidate are the same development, as <SAME_DEVELOPMENT> defines it. no: they are not. unsure: the texts do not settle it.',
          ),
        cause: quotePair('the same cause: the event, outbreak, conflict, decision or process both are about'),
        place: quotePair('the same place or the same parties'),
        end: quotePair('what would end both: the outcome whose arrival closes the development'),
        reportsEndEvent: z
          .boolean()
          .describe("For an overview: whether the story reports that its charter's END_EVENT has happened. Always false for a story candidate."),
        confidence: z.number().describe('Your probability, from 0 to 1, that the story belongs to the candidate.'),
      }),
    )
    .describe('One entry per candidate in <OVERVIEWS> and <STORIES>, in their order.'),
  role,
  roleKind,
})

export type LinkAnswer = z.infer<typeof linkSchema>
export type LinkCandidateAnswer = LinkAnswer['candidates'][number]

export const foundSchema = z.object({
  title: z
    .string()
    .describe(
      'The development in a few words, as a reader would name it, e.g. "Ebola outbreak in eastern DR Congo": no date unless it names the development, no period at the end.',
    ),
  charter: z.object({
    in: z.string().describe('One or two sentences: what the development is, where, since when, and what kinds of stories belong to it.'),
    out: z.array(z.string()).describe('Each neighboring development or theme that must stay separate, as a short phrase.'),
    endEvent: z
      .string()
      .describe('The one concrete, observable event that would end the development, as <END_EVENT> asks. Empty only when no such event can be named.'),
  }),
  roles: z
    .object({ a: z.object({ role, roleKind }), b: z.object({ role, roleKind }) })
    .describe("Each story's role in the development: A is <STORY_A>, B is <STORY_B>."),
})

export type FoundAnswer = z.infer<typeof foundSchema>

const fits = z.object({
  fits: z
    .enum(['yes', 'no'])
    .describe('yes: the story belongs to the development <CHARTER> describes, and to none of what its OUT list keeps separate. no: otherwise.'),
  reason: z.string().describe('One sentence: why.'),
})

export const foundCheckSchema = z.object({
  a: fits.describe('<STORY_A> against the charter.'),
  b: fits.describe('<STORY_B> against the charter.'),
  endEventConcrete: z
    .enum(['yes', 'no'])
    .describe(
      "yes: the charter's END_EVENT is a concrete, observable event a news report could say has happened. no: it is vague, a trend, or never observable.",
    ),
})

export type FoundCheckAnswer = z.infer<typeof foundCheckSchema>
