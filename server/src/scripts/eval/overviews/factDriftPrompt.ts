/**
 * The question the fact check's second strong-judge pass asks (`factDrift.ts`) of a rendered
 * module-1 fact the label pass rejected: does its rendering only name what the rest of the article
 * supplies (`context`), or does it change what its source's words state (`changed`, with the kind)?
 * Its vocabulary, output schema and prompt: the eval's own, never production's. Written under
 * `.context/prompting.md`: role, goal, XML blocks, declarative requirements, examples on both
 * sides, format guidance in the schema's `.describe()`s; every fetched text sits in escaped XML
 * behind research's untrusted-input line. `<RENDERING_FORMAT>` and the examples describe
 * `renderFact`'s format of 2026-11-24 and are drawn from that day's first paid run: they change
 * with the rendering.
 */
import { z } from 'zod'
import { tag, UNTRUSTED } from '../../../prompts/research.js'
import { escapeXml } from '../../../prompts/shared.js'

export const DRIFT_CATEGORIES = ['context', 'changed'] as const
export type DriftCategory = (typeof DRIFT_CATEGORIES)[number]
/** What a `changed` rendering changed, in the order the judge picks by: where several apply, the first. */
export const DRIFT_KINDS = ['figure', 'strength', 'period', 'scope', 'credit', 'flag', 'placeholder', 'other'] as const
export type DriftKind = (typeof DRIFT_KINDS)[number]

/** Each kind as `<CHANGED>` defines it, with its examples. */
const KIND_DEFINITIONS: Record<DriftKind, string> = {
  figure:
    'a number, unit or thing counted that SOURCE does not give: the "first three weeks" a report covers as an escalation lasting 3 weeks; a year or a date recorded as a quantity ("2,027 year", "105 date")',
  strength:
    'what SOURCE proposes, plans, forecasts, requests or says may happen, stated as fact or as in force: "would divide half the cuts" under a proposal as a 50% share; "will be asked to consider continuing" as "is to be asked to continue"',
  period:
    'a date or period SOURCE states, dropped or altered: "has killed 634 people since March 2" as 634 people killed; "averaged 1.5°C above normal from May through July" as an anomaly of 1.5°C; a rise "in one week of April" as a rise; "since August" as "as of August 2026"; or an "as of" date made of a date SOURCE gives for something else: "scheduled to meet from 6 to 17 July" as "as of July 2026", "after an El Niño hit in 2015" as "as of 2015"',
  scope:
    'a condition, group or limit SOURCE states, dropped or widened: an average "during El Niño years" as the average; a fall "if there is a strong El Niño" as a fall; "in recent days, an average of about 150 rockets per day" as about 150 rockets per day; animals "vaccinated with Ervebo" as vaccinated animals',
  credit:
    'a named body or person credited where SOURCE credits no one, or someone else: "Under the proposal, California, Nevada and Arizona would divide half the cuts" as "according to US Bureau of Reclamation"; a quoted remark that names no speaker, credited to a named person',
  flag: '"(estimate)" or "(provisional)" on what SOURCE states plainly, with no estimate, forecast or doubt in it: "will be reevaluated every two years" as 2 years (estimate)',
  placeholder: 'a detail that holds a filler instead of a value: "according to none", "in unknown". A filler is never a credit',
  other:
    'any other claim SOURCE does not make or states differently ("a disputed imbalance" as "the disputed allocation plan"), or a name that conflicts with what SOURCE_TITLE, STORY_TITLE and STATEMENT say the article is about',
}

export const driftJudgeSchema = z.object({
  facts: z
    .array(
      z.object({
        number: z.number().int().describe('The number of the fact in <FACTS>.'),
        category: z.enum(DRIFT_CATEGORIES).describe('context as <CONTEXT> defines it, changed as <CHANGED> does.'),
        kind: z.enum(DRIFT_KINDS).nullable().describe('For changed: the kind of change, by its name in <CHANGED>. Null for context.'),
        reason: z
          .string()
          .describe(
            'One short sentence. For changed: what RENDERING drops, alters or adds, with the words of SOURCE it concerns. For context: what RENDERING names that SOURCE leaves out.',
          ),
      }),
    )
    .describe('One entry for every fact in <FACTS>, in its order.'),
})

export type DriftJudgeAnswer = z.infer<typeof driftJudgeSchema>

/** A fact the fact check's label pass rejected, as the judge is shown it. */
export interface DriftJudgeFact {
  /** The source article's own headline, as research stored it; null when it has none. */
  sourceTitle: string | null
  /** The title of our story the source was read for. */
  storyTitle: string
  /** The source's sentence, or for a search fact the passage around it, verbatim. */
  source: string
  /** The source's date as research stored it; null when unknown. */
  date: string | null
  /** The fact as production's `renderFact` shows it. */
  rendering: string
  /** Research's own statement of the fact; null where the rendering already holds it. */
  statement: string | null
}

const factXml = (f: DriftJudgeFact, number: number) =>
  [
    `<FACT number="${number}" published="${escapeXml(f.date ?? 'unknown')}">`,
    ...(f.sourceTitle === null ? [] : [tag('SOURCE_TITLE', f.sourceTitle)]),
    tag('STORY_TITLE', f.storyTitle),
    tag('SOURCE', f.source),
    tag('RENDERING', f.rendering),
    ...(f.statement === null ? [] : [tag('STATEMENT', f.statement)]),
    '</FACT>',
  ].join('\n')

/**
 * Sorts each fact the label pass rejected: its rendering only names what the rest of the article
 * supplies (`context`), or it changes what the source's words state (`changed`, with the kind).
 * Cache: off (a plain string: one pass a run, a call per ten rejected facts). House order: role,
 * goal, the format, both answers' definitions and the requirements, then the facts.
 */
export function buildDriftJudgePrompt(facts: DriftJudgeFact[]): string {
  return `<ROLE>
You are a standards editor at a news desk. You audit how a research step recorded facts from news articles, against the words of the article each fact was taken from.
</ROLE>

<GOAL>
A first check found each RENDERING in <FACTS> not fully supported by its SOURCE, the one sentence or short passage of the article it was taken from. For each fact, say which of two things happened: RENDERING only names what the rest of the article supplies (context), or it drops, alters or adds to what SOURCE states (changed, with the kind of change).
</GOAL>

<RENDERING_FORMAT>
A RENDERING is a label with a figure ("People killed by Israeli strikes in Lebanon: 634 people") or a sentence, followed by the fact's details: "in" a place, "as of" the date the fact describes, "according to" who it is credited to. A sentence carries its figure and details in brackets. "(estimate)" marks a figure as estimated or forecast, and "(provisional)" a sentence as not final; neither says that something is only proposed, planned or requested.
</RENDERING_FORMAT>

<CONTEXT>
The answer is context when RENDERING leaves out nothing SOURCE states, contradicts and strengthens nothing, and everything it says beyond SOURCE only names who or what the article is about, in a way that fits SOURCE_TITLE, STORY_TITLE or STATEMENT:
- the subject: "the outbreak" or its "cases" as Ebola, "the phenomenon" as El Niño, "the river" as the Colorado River, "the annex" as the PABS annex
- the place: "the country" as Lebanon, "the capital" as Beirut, "all nine provinces" as South Africa's, "the island" as New Guinea
- a body or person SOURCE refers to, named in full: "DWS" as the Department of Water and Sanitation, "the ministry" as Lebanon's health ministry, "WisdomTree's Gupta" as Aneeka Gupta, "he" as Israel Katz, "the medical charity" as Médecins Sans Frontières, a title added to a name
- a date SOURCE gives in part or relative to its own day, completed from the published date: "As of October 6" as October 6, 2026; "this year" as 2026; "on Thursday" as that day's date; an "as of" date that is only the published date
A RENDERING that states what SOURCE states, adding nothing and leaving nothing out, is context too.
</CONTEXT>

<CHANGED>
The answer is changed when RENDERING drops, alters or adds to what SOURCE states. One such change is enough, even where context is missing as well. The kinds:
${DRIFT_KINDS.map(kind => `- ${kind}: ${KIND_DEFINITIONS[kind]}`).join('\n')}
</CHANGED>

<REQUIREMENTS>
- Judge RENDERING against SOURCE. SOURCE_TITLE, STORY_TITLE and STATEMENT only show what the article is about: they can make a name context, and they never make a dropped period or condition, a stronger claim, a credit or a figure acceptable.
- A credit is context only when SOURCE itself credits a body or person and RENDERING names that same one more fully.
- A name fits when it is consistent with what SOURCE_TITLE, STORY_TITLE or STATEMENT say the article is about; it need not appear in them.
- What SOURCE states is read from SOURCE alone. What you know of the subject may only tell you whether a name fits.
- SOURCE may be in another language: a faithful translation changes nothing.
- The amount decides for a figure, never its form: "half" as 50%, "more than 1,000" as at least 1,000 and "trente à quarante-huit millions" as 30 million to 48 million change nothing.
- Where several kinds apply, name the first of them in the order of <CHANGED>.
- Answer every fact by its number, once.
</REQUIREMENTS>

<FACTS>
Facts a research step recorded from news articles while researching our stories. SOURCE is the article's own words, published on the date given, and SOURCE_TITLE, where given, the article's headline. RENDERING is the fact as the research step recorded it and as our writers are shown it. STORY_TITLE is the title of our story the article was read for: an article found by search may be background to it, about another year or place, and then SOURCE_TITLE says what the article is about. STATEMENT, where given, is the research step's own sentence for the fact. ${UNTRUSTED}
${facts.map((f, i) => factXml(f, i + 1)).join('\n')}
</FACTS>`
}
