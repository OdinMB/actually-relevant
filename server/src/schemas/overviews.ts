/**
 * Structured outputs of the overview prompts (`prompts/overviews.ts`; `.context/overviews.md`): the
 * link confirmation per candidate, with the shared cause and place (and the end, when both state one)
 * quoting both sides and the story's role; the founding draft (charter, title, both stories' roles);
 * the founding check, blind to the draft's reasons; "Where this stands" and "What's being done", each
 * sentence citing facts; and a review's verdict per entry with the charter it may only narrow. Format
 * guidance lives in the `.describe()`s
 * (`.context/prompting.md`, "Schema carries format guidance"); each schema is part of its prompt's
 * version (`OVERVIEW_PROMPT_VERSIONS`).
 */
import { z } from 'zod'
import { ENTRY_ROLES, ROLE_KINDS } from '../services/overviewTypes.js'

const quotePair = (what: string, none = '') =>
  z
    .object({
      story: z.string().describe(`The words of <STORY> that state ${what}, copied exactly from its title, label or summary. Empty when it states none.${none}`),
      other: z
        .string()
        .describe(
          `The words of the candidate that state ${what}, copied exactly: from an overview's TITLE, IN or END_EVENT (never its OUT entries or an END_EVENT of none), or from a story's title, label or summary. Empty when it states none.${none}`,
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
        end: quotePair(
          'how both would end: the same outcome would end the one and the other',
          ' Optional: fill both sides only when both state it, else leave both empty, and always for an overview whose END_EVENT is none. An empty end never stands in the way of yes.',
        ),
        reportsEndEvent: z
          .boolean()
          .describe(
            "For an overview: whether the story reports that its charter's END_EVENT has happened. Always false for a story candidate and for an overview whose END_EVENT is none.",
          ),
        scope: z
          .enum(['inside', 'wider', 'unrelated'])
          .describe(
            'For an overview, as <SCOPE> defines it: inside (what its IN covers, the same as belongs yes), wider (the same broader development, outside its IN), unrelated (shares only place, vocabulary or theme). For a story candidate: inside when belongs is yes, unrelated otherwise.',
          ),
        centerMoved: z
          .boolean()
          .describe(
            'For an overview: whether the story itself reports that this development has become part of, or a response to, a larger development, as <SCOPE> asks. Always false for a story candidate.',
          ),
        signalQuote: z
          .string()
          .describe(
            'When scope is wider or centerMoved is true: the words of <STORY> that show it, copied exactly from its title, label or summary. Empty otherwise.',
          ),
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
      'The development in a few words, as a reader would name it, e.g. "Ebola outbreak in eastern DR Congo": no date unless it names the development, no period at the end. Empty when the stories show no development, as <DEVELOPMENT> says.',
    ),
  charter: z.object({
    in: z
      .string()
      .describe(
        'One or two sentences: what the development is, where, since when, and what kinds of stories belong to it. Empty when the stories show no development, as <DEVELOPMENT> says.',
      ),
    out: z.array(z.string()).describe('Each neighboring development or theme that must stay separate, as a short phrase.'),
    endEvent: z.string().describe('The one concrete, observable event that would end the development, as <END_EVENT> asks. Empty when it has none.'),
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
    .enum(['yes', 'no', 'none'])
    .describe(
      "yes: the charter's END_EVENT is a concrete, observable event a news report could say has happened. no: it is vague, a trend, or never observable. none: the charter's END_EVENT is none.",
    ),
})

export type FoundCheckAnswer = z.infer<typeof foundCheckSchema>

const citedLine = (what: string) =>
  z.object({
    text: z.string().describe(`${what} One sentence in your own words, American spelling.`),
    factIds: z
      .array(z.string())
      .describe('The ids of the facts in <FACTS> that state everything the sentence says, exactly as given, e.g. "S2F1". Never empty.'),
  })

export const standsSchema = z.object({
  sentences: z
    .array(citedLine('Where the development stands, as <STANDS> asks.'))
    .describe('One to four sentences, the present state first, in the order a reader should read them.'),
  doing: z
    .array(citedLine('What is being done about it, as <DOING> asks.'))
    .describe('At most two sentences on the responses under way; empty when no current fact reports one.'),
})

export type StandsAnswer = z.infer<typeof standsSchema>

export const reviewSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().describe('The id of an entry in <ENTRIES>, exactly as given, e.g. "E3".'),
        belongs: z.enum(['yes', 'no']).describe('yes: the story belongs to the development the charter describes, as <ENTRY_RULES> asks. no: it does not.'),
        reason: z.string().describe('One sentence: why, from what the story reports.'),
        role,
        roleKind,
      }),
    )
    .describe('One per entry in <ENTRIES>, in their order.'),
  charter: z
    .object({
      in: z.string().describe("The charter's IN, copied exactly as given."),
      out: z.array(z.string()).describe("The charter's OUT entries as given, each kept, with any you add after them as <CHARTER_RULES> allows."),
      endEvent: z.string().describe("The charter's END_EVENT, copied exactly as given; empty when it is none."),
    })
    .describe('The charter, narrowed only by additions to OUT.'),
  title: z.string().describe('A corrected title only when the current one misnames the development, as <TITLE_RULES> asks; empty to keep it.'),
  clearFreeze: z.boolean().describe('Only for a frozen overview: true when every entry belongs, so automation may go on. False otherwise.'),
})

export type ReviewAnswer = z.infer<typeof reviewSchema>

const belongsUnder = (what: string) =>
  z.enum(['yes', 'no']).describe(`yes: ${what} belongs to the development the new charter describes, as <JUDGING> asks. no: it does not.`)

export const recenterSchema = z.object({
  decision: z
    .enum(['recenter', 'keep'])
    .describe('recenter: the stories show the development has a wider or moved center, as <CENTER> asks. keep: the charter still fits.'),
  title: z.string().describe('The development under its new center, as <TITLE_RULES> asks; empty for keep.'),
  charter: z
    .object({
      in: z.string().describe('The new IN, as <CENTER> asks; empty for keep.'),
      out: z.array(z.string()).describe("The charter's OUT entries as given, each kept, with any you add after them as <CENTER> allows."),
      endEvent: z.string().describe('The new END_EVENT, as <END_EVENT> asks: empty when the development has none.'),
    })
    .describe('The charter under the new center; for keep, the current one.'),
  entries: z
    .array(z.object({ id: z.string().describe('An entry id from <ENTRIES>, e.g. "E3".'), belongs: belongsUnder('the entry') }))
    .describe('One per entry in <ENTRIES>, in their order, judged under the new charter (for keep, under the current one).'),
  stories: z
    .array(
      z.object({
        id: z.string().describe('A story id from <STORIES>, e.g. "S2".'),
        belongs: belongsUnder('the story'),
        role,
        roleKind,
      }),
    )
    .describe('One per story in <STORIES>, in their order, with the role it would have in the development.'),
  reason: z.string().describe('One or two sentences: what moved the center, or why the charter still fits.'),
})

export type RecenterAnswer = z.infer<typeof recenterSchema>

const judged = (what: string) =>
  z.object({
    id: z.string().describe(`A ${what} id, exactly as given.`),
    belongs: belongsUnder(`the ${what}`),
    reason: z.string().describe('One sentence: why.'),
  })

export const recenterCheckSchema = z.object({
  entries: z.array(judged('entry')).describe('One per entry in <ENTRIES>, in their order.'),
  stories: z.array(judged('story')).describe('One per story in <STORIES>, in their order.'),
  endEventConcrete: z
    .enum(['yes', 'no', 'none'])
    .describe(
      "yes: the charter's END_EVENT is a concrete, observable event a news report could say has happened. no: it is vague, a trend, or never observable. none: the charter's END_EVENT is none.",
    ),
  neighbours: z
    .array(
      z.object({
        id: z.string().describe('A neighbor id from <NEIGHBORS>, e.g. "N1".'),
        covered: z.enum(['yes', 'no']).describe("yes: the charter's IN now takes in that development, as <NEIGHBOR_RULES> asks. no: it stays separate."),
      }),
    )
    .describe('One per neighbor in <NEIGHBORS>, in their order; empty when there is none.'),
})

export type RecenterCheckAnswer = z.infer<typeof recenterCheckSchema>
