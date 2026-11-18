/**
 * A research pass's three later-pass prompts (`services/researchPassLater.ts`;
 * `.context/research-passes.md`, "The later pass"): the judge, which asks of each section of the
 * current article whether what the pass found makes it wrong or substantially different; the
 * rewrite of the flagged sections, research's repair prompt in an update's framing, with research's
 * own-words, citation, latest-state and writing blocks; and the Update note. Written under
 * `.context/prompting.md`: role, goal, XML constraint blocks, declarative, exact counts, format
 * guidance in the schemas (`schemas/researchPass.ts`), every fetched or stored text escaped behind
 * the untrusted-input line. Each prompt's version is a hash of it on a fixed input and of its schema.
 */
import { repairSchema } from '../schemas/research.js'
import { judgeSchema, noteSchema } from '../schemas/researchPass.js'
import { promptVersionOf } from './promptVersion.js'
import { CITATIONS, FACTS_INTRO, factsBlock, LATEST_STATE, OWN_WORDS, repairItem, tag, UNTRUSTED, WRITING_GUIDELINES, type RepairInput } from './research.js'
import { escapeXml } from './shared.js'

/** A fact as the judge and the note read it: its statement and evidence, its source and that source's day. */
export interface PassFactBrief {
  id: string
  statement: string
  measures: string
  supportingSentence: string
  outlet: string
  /** `YYYY-MM-DD`, or null when unknown. */
  date: string | null
}

const fact = (f: PassFactBrief, extra = '') =>
  `<FACT id="${f.id}" outlet="${escapeXml(f.outlet)}" date="${f.date ?? 'unknown'}"${extra}>${escapeXml(f.statement)}${f.measures ? `\n${tag('MEASURES', f.measures)}` : ''}\n${tag('SENTENCE', f.supportingSentence)}</FACT>`

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

export interface JudgeInput {
  /** `YYYY-MM-DD`: the day the story was published, or written when not yet published. */
  storyDay: string
  /** The story's sections as readers see them, each with the facts it cites (null for the title, summary and blurb). */
  sections: { label: string; text: string; factIds: string[] | null }[]
  /** The facts the sections cite. */
  cited: PassFactBrief[]
  /** The facts this pass found, each supported by its check. */
  fresh: PassFactBrief[]
}

const section = (s: JudgeInput['sections'][number]) =>
  [`<SECTION label="${escapeXml(s.label)}">`, tag('TEXT', s.text), ...(s.factIds ? [tag('CITES', s.factIds.join(', ') || 'none')] : []), '</SECTION>'].join(
    '\n',
  )

export function buildJudgePrompt(input: JudgeInput): string {
  return `<ROLE>
You are a corrections editor at a news desk. You decide whether newer reporting makes any part of a published story wrong or out of date, and you leave every other part alone.
</ROLE>

<GOAL>
For each section in <STORY>, judge whether the facts in <NEW_FACTS> make it wrong or substantially different, naming the new facts that do; and name each fact in <CITED_FACTS> that a new fact shows was wrong about its own moment.
</GOAL>

<STORY>
The story as readers see it, published on ${escapeXml(input.storyDay)}, section by section. A story paragraph or bullet comes with the ids of the facts it CITES; the title, the summary and the blurb cite none and rest on the story as a whole. ${UNTRUSTED}
${input.sections.map(section).join('\n')}
</STORY>

<CITED_FACTS>
The facts the sections rest on, each with the outlet that states it, the day that outlet published it, and the sentence that states it. ${UNTRUSTED}
${input.cited.map(f => fact(f)).join('\n')}
</CITED_FACTS>

<NEW_FACTS>
Facts found since the story was written, each checked against the sentence of its source that states it, in the same form. ${UNTRUSTED}
${input.fresh.map(f => fact(f)).join('\n')}
</NEW_FACTS>

<RULES>
<SUBSTANTIALLY_DIFFERENT>
A section is substantially different when a reader who read it would now hold a materially false or outdated belief about the development: a figure revised beyond rounding, a decision taken or reversed, a plan dropped or narrowed, an outcome now known, the main claim now disputed by a later credible report. This holds for a figure the section dates too ('180 deaths by November 10'), since the story gives the development's latest state.
A section that new facts only add to is unchanged: more detail, context, a reaction, or a further step that leaves what it says true and current. That detail belongs elsewhere, never in a rewrite.
</SUBSTANTIALLY_DIFFERENT>
- A section is wrong when a fact in <NEW_FACTS> shows that what it states was never true: a corrected figure, a claim given to the wrong party, an event that did not happen as stated.
- Every flag rests on facts in <NEW_FACTS>, named in its entry. A section you would flag on your own knowledge, or on <CITED_FACTS> alone, is unchanged.
- A difference of scope or period is no change: a figure for one province does not revise a national total, and a figure for another year does not revise this one.
<CONTRADICTED>
A fact in <CITED_FACTS> is contradicted when a fact in <NEW_FACTS> states the opposite about the same moment or event: a corrected figure for the same date, a denial of what it reports, a disproof. A newer value for a later moment, such as a death toll that has risen since, supersedes it without contradicting it, and is not listed. A section citing a contradicted fact is wrong.
</CONTRADICTED>
- Each section is judged on its own text, against the facts above alone; what you know from elsewhere does not count.
</RULES>`
}

// ---------------------------------------------------------------------------
// The rewrite: research's repair prompt in an update's framing
// ---------------------------------------------------------------------------

/**
 * The flagged sections written again for newer reporting: each with the judge's reason or the
 * contradicted fact it cites as its problem, the whole story for context and every usable fact of the
 * pool, so a rewritten section stays coherent with its neighbours and every other section stays as it
 * is (`withRepairs` keeps them so whatever the answer). Answered in research's repair shape.
 */
export function buildUpdateRewritePrompt(input: RepairInput): string {
  return `<ROLE>
You are a news writer who updates a published story for newer reporting.
</ROLE>

<GOAL>
Write each item in <REPAIRS> again so that it gives what the facts in <FACTS> now show, with the smallest change that does it: what its problems do not touch stays as it is. Every other item of <STORY> stays as it is too, so each new text keeps its item's place and job in the story and about its length, and adds nothing another item already says.
</GOAL>

<STORY>
The story as it stands, item by item. ${UNTRUSTED}
${input.story.map(i => `<ITEM label="${escapeXml(i.label)}">${escapeXml(i.text)}</ITEM>`).join('\n')}
</STORY>

<FACTS>
${FACTS_INTRO}
${factsBlock(input.sources, input.earlier)}
</FACTS>

<REPAIRS>
The items to write again, each with its TEXT, the ids it CITES (none for an item that carries no citations), and each PROBLEM: what newer reporting changes in it, with the ids of the facts that show it. ${UNTRUSTED}
${input.repairs.map(repairItem).join('\n')}
</REPAIRS>

<REQUIREMENTS>
<UPDATE>
- An item gives the development's latest state as <FACTS> show it, and cites the facts it rests on, the newer ones its problems name among them. An earlier figure or claim may stay as context, cited, where a reader needs it to see what changed: 'First put at 180, the death toll rose to 212 by November 18.'
- A fact a PROBLEM says newer reporting contradicts is left out, and the item says what the newer facts state instead.
- An item whose PROBLEM asks to check it against the rewritten opening paragraph comes back word for word as it is, unless it now states an earlier claim as if it still held.
- Each text reads as the story's own, never as a note about the change: no 'update', 'correction' or 'earlier reports said' unless the development itself was revised.
- The title, the summary and the blurb cite nothing. The summary keeps 40-70 words; the blurb keeps 25-30 words, never more than 230 characters, and opens with the development itself.
</UPDATE>

${OWN_WORDS}

${CITATIONS}

${LATEST_STATE}
</REQUIREMENTS>

${WRITING_GUIDELINES}
`
}

// ---------------------------------------------------------------------------
// The Update note
// ---------------------------------------------------------------------------

export interface NoteInput {
  /** Each changed section's text before and after (null when it was removed). */
  changes: { label: string; before: string; after: string | null }[]
  /** The facts the note may cite: found this pass, or shown wrong by them. */
  facts: (PassFactBrief & { contradicted: boolean })[]
  /** On the repair round: what the checks found in the note before. */
  problems?: { text: string; problems: string[] }
}

const change = (c: NoteInput['changes'][number]) =>
  [`<CHANGE section="${escapeXml(c.label)}">`, tag('BEFORE', c.before), c.after === null ? '<REMOVED/>' : tag('AFTER', c.after), '</CHANGE>'].join('\n')

const problemsBlock = (p: NoteInput['problems']) =>
  p
    ? `

<PREVIOUS>
Your previous Update failed its checks: write it again so that none of its problems remains. ${UNTRUSTED}
${tag('TEXT', p.text)}
${p.problems.map(problem => tag('PROBLEM', problem)).join('\n')}
</PREVIOUS>`
    : ''

export function buildNotePrompt(input: NoteInput): string {
  return `<ROLE>
You are a news editor who writes the short Update shown on a story that changed for newer reporting.
</ROLE>

<GOAL>
Write the Update for the changes in <CHANGES>: what is different now and what newer reporting showed, in one or two sentences of at most 60 words, citing the facts in <FACTS> that the changed sections rest on.
</GOAL>

<CHANGES>
Each section that changed, as it read BEFORE and as it reads AFTER; REMOVED marks a section taken out. ${UNTRUSTED}
${input.changes.map(change).join('\n')}
</CHANGES>

<FACTS>
The facts the changes rest on, each with the outlet that states it, the day that outlet published it, and the sentence that states it; CONTRADICTED marks an earlier fact that newer reporting showed was wrong. ${UNTRUSTED}
${input.facts.map(f => fact(f, f.contradicted ? ' status="CONTRADICTED"' : '')).join('\n')}
</FACTS>${problemsBlock(input.problems)}

<REQUIREMENTS>
- The Update says what changed in the development and who reported it, naming the outlet or body: 'The death toll was revised to 212 from 180, according to the WHO's situation report of November 18.'
- It is published as written beside the story, so it is about the development, never about the story, its sources or its versions: it does not mention the article, the story, the sources, the facts or an earlier version.
  Bad: 'This story was updated because new sources were found.' Good: 'Officials raised the count of displaced people to 40,000 from 25,000 on November 18, according to OCHA.'
- It states only what its cited facts state, with their scope and qualifiers, and cites every fact it states.
- No quotation marks and at most one em dash. The date of the update is added beside it, so the text gives none of its own; the date of a report it names is fine.
- American spelling ('program', 'analyze').
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Prompt versions
// ---------------------------------------------------------------------------

const CANONICAL_FACT: PassFactBrief = { id: 'S1F1', statement: 'Fact.', measures: '', supportingSentence: 'Sentence.', outlet: 'Outlet', date: '2026-01-01' }

/** The later pass's prompt versions, computed once at load. */
export const PASS_PROMPT_VERSIONS = {
  judge: promptVersionOf(
    buildJudgePrompt({
      storyDay: '2026-01-01',
      sections: [{ label: 'Story paragraph 1', text: 'Paragraph.', factIds: ['S1F1'] }],
      cited: [CANONICAL_FACT],
      fresh: [{ ...CANONICAL_FACT, id: 'S2F1' }],
    }),
    judgeSchema,
  ),
  update: promptVersionOf(
    buildUpdateRewritePrompt({
      sources: [],
      earlier: [],
      story: [{ label: 'Story paragraph 1', text: 'Paragraph.' }],
      repairs: [{ label: 'Story paragraph 1', text: 'Paragraph.', factIds: ['S1F1'], problems: ['Problem.'] }],
    }),
    repairSchema,
  ),
  note: promptVersionOf(
    buildNotePrompt({ changes: [{ label: 'Story paragraph 1', before: 'Before.', after: 'After.' }], facts: [{ ...CANONICAL_FACT, contradicted: false }] }),
    noteSchema,
  ),
} as const
