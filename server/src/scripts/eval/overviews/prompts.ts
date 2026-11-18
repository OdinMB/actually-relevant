/**
 * The overview evals' own prompts and output schemas, never production's: drafting a gap key
 * (`gapDraft.ts`), the strong judge's three questions on story context (`contextJudge.ts`):
 * which key needs the kept cards meet, whether a figure fact's structured fields are right, and
 * whether a note beside a paragraph or point adds to it; and its question on a later pass's Update
 * note (`update.ts`): whether it says what changed and why. Box support is judged with production's own
 * fact-check prompt, not here. Written under `.context/prompting.md`: role, goal, XML blocks,
 * declarative requirements, format guidance in the schemas' `.describe()`s. Every fetched text sits
 * in escaped XML behind research's untrusted-input line; our own story is marked as ours. Plain
 * strings only in the schemas (no length limits), as production's structured outputs use them.
 */
import { z } from 'zod'
import { tag, UNTRUSTED } from '../../../prompts/research.js'
import { escapeXml } from '../../../prompts/shared.js'
import { SLOT_DEFINITIONS, type StoryText } from '../../../prompts/storyContext.js'
import { CONTEXT_SLOTS } from '../../../schemas/storyContext.js'
import type { ContextInput } from '../../../services/storyContextPipeline.js'
import { GAP_NEED_KINDS } from './gapKeySchema.js'

/** A story's input as the prompts show it: its title, day, paragraphs, Why This Matters points and caveats. */
export const storyTextOf = (input: Pick<ContextInput, 'title' | 'storyDay' | 'layout'>): StoryText => ({
  title: input.title,
  date: input.storyDay,
  paragraphs: input.layout.paragraphs,
  points: input.layout.points,
  caveats: input.layout.caveats,
})

const storyBlock = (story: StoryText) => `<STORY>
Our published story, written by us from its sources.
${tag('TITLE', story.title)}
${tag('DATE', story.date)}
${story.paragraphs.map(p => `<PARAGRAPH id="${escapeXml(p.id)}">${escapeXml(p.text)}</PARAGRAPH>`).join('\n')}
<WHY_THIS_MATTERS>
${story.points.map(p => `<POINT id="${escapeXml(p.id)}">${escapeXml(p.text)}</POINT>`).join('\n')}
</WHY_THIS_MATTERS>
<CAVEATS>
${story.caveats.map(c => tag('CAVEAT', c)).join('\n')}
</CAVEATS>
</STORY>`

// ---------------------------------------------------------------------------
// Drafting a gap key
// ---------------------------------------------------------------------------

export const gapDraftSchema = z.object({
  needs: z
    .array(
      z.object({
        id: z.string().describe('Short id, unique in the answer, lowercase with hyphens, e.g. "record-2015".'),
        slot: z.enum(CONTEXT_SLOTS).describe('The slot of <CHECKLIST> the need belongs to.'),
        need: z
          .string()
          .describe('What a reader needs, in one line, about this story\'s subject ("How this year\'s burned area compares with the 2015 record").'),
        kind: z
          .enum(GAP_NEED_KINDS)
          .describe('figure: a number with its unit and scope. fact: a statement without a figure. term: a term, body or mechanism explained.'),
        importance: z
          .enum(['must', 'nice'])
          .describe('must: a reader cannot size or place the story without it. nice: it helps, but the story stands without it.'),
        inStory: z.string().nullable().describe('When <STORY> already states it: its words, copied exactly. Null otherwise.'),
        accepts: z
          .string()
          .describe(
            'What context meets the need, concrete enough to decide yes or no: the figure, its unit and scope, or the fact, and that it names its source ("Any figure for the area burned in Indonesia in 2015, in hectares, credited to a named source").',
          ),
        example: z
          .object({ value: z.string().describe('A value or statement a source gives.'), source: z.string().describe('Who states it.') })
          .nullable()
          .describe('One answer a source gives, as a guide for the judge. Null when you know of none.'),
      }),
    )
    .describe('2 to 8 needs, the most important first.'),
  notNeeded: z
    .array(z.object({ slot: z.enum(CONTEXT_SLOTS), why: z.string().describe('One line: why a reader of this story does not need it.') }))
    .describe('Each slot of <CHECKLIST> with no need, once.'),
  notes: z.string().describe('Anything a judge must know about a need: a borderline call and why. Empty string otherwise.'),
})

export type GapDraftAnswer = z.infer<typeof gapDraftSchema>

export interface GapDraftInput {
  story: StoryText
  /** Research's facts as stated: id and statement. */
  facts: { id: string; statement: string }[]
}

export function buildGapDraftPrompt(input: GapDraftInput): string {
  const checklist = CONTEXT_SLOTS.map(slot => `<SLOT id="${slot}">${escapeXml(SLOT_DEFINITIONS[slot])}</SLOT>`).join('\n')
  const facts = input.facts.map(f => `<FACT id="${escapeXml(f.id)}">${escapeXml(f.statement)}</FACT>`).join('\n')
  return `<ROLE>
You are a senior news editor. You decide what context a reader needs beside a story to size it and place it, and you write it down as an answer key that the context a system writes is checked against.
</ROLE>

<GOAL>
For <STORY>, list what a careful editor would add beside it so a reader can size and place the story, slot by slot of <CHECKLIST>, each need with what context meets it; and name the slots this story does not need.
</GOAL>

${storyBlock(input.story)}

<CHECKLIST>
${checklist}
</CHECKLIST>

<FACTS>
The facts research found in the story's sources, as statements. ${UNTRUSTED}
${facts}
</FACTS>

<REQUIREMENTS>
- 2 to 8 needs, each about this story's subject. A generic need ("more background", "expert views") is not a need.
- Every slot of <CHECKLIST> is either a need, once or more, or in notNeeded, once; never both.
- "response" is always a must need: what is being done about the problem, solutions tried, or what has worked against it elsewhere. When <STORY> itself reports the response, inStory quotes our words. When you know of no source that reports one, accepts says so and example is null.
- inStory quotes <STORY> exactly where the story already states what the need asks; null otherwise.
- accepts decides yes or no from the context alone: it names the figure with its unit and scope, or the fact, and asks that it names its source. A need that any loosely related sentence would meet is too vague.
- Your own knowledge of the subject is welcome in the needs and examples: the key is the answer, not the step it checks. Never take a need from what a system might find; take it from what a reader needs.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Judge: which needs the kept cards meet
// ---------------------------------------------------------------------------

export const needsJudgeSchema = z.object({
  needs: z
    .array(
      z.object({
        id: z.string().describe('The id of the need in <NEEDS>.'),
        met: z.boolean().describe("True when an item in <CONTEXT> states what the need's ACCEPTS asks for. False otherwise."),
        factIds: z.array(z.string()).describe('When met: the ids of the facts the meeting items cite. Empty otherwise.'),
        why: z.string().describe('One short sentence: the item that meets it, or what is missing.'),
      }),
    )
    .describe('One entry for every need in <NEEDS>, in its order.'),
})

export type NeedsJudgeAnswer = z.infer<typeof needsJudgeSchema>

export interface NeedsJudgeInput {
  story: StoryText
  needs: { id: string; slot: string; kind: string; need: string; accepts: string }[]
  /** Each kept item as production's box check reads it: label, slot, text, cited fact ids. */
  items: { label: string; slot: string; text: string; factIds: string[] }[]
  facts: { id: string; text: string; outlet: string; date: string | null }[]
}

export function buildNeedsJudgePrompt(input: NeedsJudgeInput): string {
  const needs = input.needs
    .map(
      n =>
        `<NEED id="${escapeXml(n.id)}" slot="${escapeXml(n.slot)}" kind="${escapeXml(n.kind)}">\n${tag('WHAT', n.need)}\n${tag('ACCEPTS', n.accepts)}\n</NEED>`,
    )
    .join('\n')
  const items = input.items
    .map(i => `<ITEM label="${escapeXml(i.label)}" slot="${escapeXml(i.slot)}" facts="${escapeXml(i.factIds.join(' '))}">${escapeXml(i.text)}</ITEM>`)
    .join('\n')
  const facts = input.facts
    .map(f => `<FACT id="${escapeXml(f.id)}" outlet="${escapeXml(f.outlet)}" published="${escapeXml(f.date ?? 'unknown')}">${escapeXml(f.text)}</FACT>`)
    .join('\n')
  return `<ROLE>
You are an exacting editor. You check the context cards written beside a news story against an answer key of what its readers needed.
</ROLE>

<GOAL>
For each need in <NEEDS>, judge whether the context in <CONTEXT> meets it as its ACCEPTS says, and name the facts it rests on.
</GOAL>

${storyBlock(input.story)}

<NEEDS>
The answer key: what a reader of the story needed beside it.
${needs}
</NEEDS>

<CONTEXT>
The items of the cards shown beside the story: sentences, big-number tiles and charts, each with the ids of the facts it cites.
${items || '(no cards)'}
</CONTEXT>

<FACTS>
The facts the items cite, each checked against its source. ${UNTRUSTED}
${facts || '(none)'}
</FACTS>

<REQUIREMENTS>
- A need is met only when an item in <CONTEXT> states what its ACCEPTS asks for: the figure with its scope, or the fact, from a named source. An item on the same topic that leaves out what ACCEPTS asks for does not meet it.
- Only the items count: what <STORY> says meets no need here.
- A met need names the facts cited by the items that meet it.
- Answer every need by its id, once.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Judge: a figure fact's structured fields
// ---------------------------------------------------------------------------

export const fieldsJudgeSchema = z.object({
  facts: z
    .array(
      z.object({
        number: z.number().int().describe('The number of the fact in <FACTS>.'),
        value: z.boolean().describe('True when VALUE and HIGH are the figure EVIDENCE or STATEMENT gives, in the unit of UNIT.'),
        unit: z.boolean().describe('True when UNIT is what one of the value is.'),
        counted: z.boolean().describe('True when COUNTED is what the figure counts, with its scope: not narrower, wider, or a running total for a new count.'),
        place: z.boolean().describe('True when PLACE is the place the fact is about, or empty when it names none.'),
        asOf: z
          .boolean()
          .describe('True when AS_OF is the date the fact describes, no more precise than its source, or empty when the source dates it by publication only.'),
        credited: z.boolean().describe('True when CREDITED is who the source credits the fact to, or empty when the source states it on its own authority.'),
        invented: z.boolean().describe('True when VALUE is a number neither EVIDENCE nor STATEMENT states in any form.'),
        problem: z.string().describe('When a field is wrong or the value invented: what is wrong, in one short sentence. Empty string otherwise.'),
      }),
    )
    .describe('One entry for every fact in <FACTS>, in its order.'),
})

export type FieldsJudgeAnswer = z.infer<typeof fieldsJudgeSchema>

export interface FieldsJudgeFact {
  evidence: string
  statement: string
  outlet: string
  date: string | null
  value: number | null
  valueHigh: number | null
  unit: string
  approx: string
  counted: string
  place: string
  asOf: string | null
  credited: string
}

const field = (name: string, value: string | number | null) => tag(name, value === null || value === '' ? '(empty)' : String(value))

export function buildFieldsJudgePrompt(facts: FieldsJudgeFact[]): string {
  const xml = facts
    .map(
      (f, i) => `<FACT number="${i + 1}" outlet="${escapeXml(f.outlet)}" published="${escapeXml(f.date ?? 'unknown')}">
${tag('EVIDENCE', f.evidence)}
${tag('STATEMENT', f.statement)}
${field('VALUE', f.value)}
${field('HIGH', f.valueHigh)}
${field('UNIT', f.unit)}
${field('APPROX', f.approx)}
${field('COUNTED', f.counted)}
${field('PLACE', f.place)}
${field('AS_OF', f.asOf)}
${field('CREDITED', f.credited)}
</FACT>`,
    )
    .join('\n')
  return `<ROLE>
You are a data editor. You audit structured records of facts against the source sentences they were taken from.
</ROLE>

<GOAL>
For each fact in <FACTS>, judge each structured field against the fact's EVIDENCE and STATEMENT, and whether its VALUE is a number they state at all.
</GOAL>

<FACTS>
Each fact's EVIDENCE is its source's words; STATEMENT is a research step's restatement of it, which may carry the scope or period from elsewhere in the source. ${UNTRUSTED}
${xml}
</FACTS>

<REQUIREMENTS>
- A field is right when EVIDENCE or STATEMENT gives it and the field states it faithfully, or when neither gives it and the field is empty.
- A figure in other words is the same figure: "half" is 50 with unit %, "2.9 million" is 2900000. APPROX records "about", "at least" or "under" and is not judged.
- A figure that counts something narrower, wider or of another period than COUNTED says is a wrong COUNTED, not a wrong VALUE.
- AS_OF is the date the fact describes, never the date its source was published.
- Judge each fact on its own evidence only; never on your own knowledge of the subject.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Judge: a note beside a paragraph or point
// ---------------------------------------------------------------------------

export const placementJudgeSchema = z.object({
  notes: z
    .array(
      z.object({
        number: z.number().int().describe('The number of the note in <NOTES>.'),
        adds: z.boolean().describe('True when the card adds to the passage it sits beside without restating it. False otherwise.'),
        why: z.string().describe('One short sentence: what it adds, or why it does not.'),
      }),
    )
    .describe('One entry for every note in <NOTES>, in its order.'),
})

export type PlacementJudgeAnswer = z.infer<typeof placementJudgeSchema>

export interface PlacementJudgeNote {
  passage: { id: string; text: string }
  card: { slot: string; heading: string; items: string[] }
}

export function buildPlacementJudgePrompt(input: { story: StoryText; notes: PlacementJudgeNote[] }): string {
  const notes = input.notes
    .map(
      (n, i) => `<NOTE number="${i + 1}">
<PASSAGE id="${escapeXml(n.passage.id)}">${escapeXml(n.passage.text)}</PASSAGE>
<CARD slot="${escapeXml(n.card.slot)}">
${tag('HEADING', n.card.heading)}
${n.card.items.map(t => tag('ITEM', t)).join('\n')}
</CARD>
</NOTE>`,
    )
    .join('\n')
  return `<ROLE>
You are a story editor. You decide whether a context card set beside one passage of a story earns its place there.
</ROLE>

<GOAL>
For each note in <NOTES>, judge whether its card adds to the passage it sits beside without restating it.
</GOAL>

${storyBlock(input.story)}

<NOTES>
Each note is a passage of <STORY> (a paragraph or a Why This Matters point) and the card shown beside it.
${notes}
</NOTES>

<REQUIREMENTS>
- A card adds to its passage when it gives a reader of that passage something the passage does not say and that helps them understand it: a comparison for its figure, a cause, who it reaches, what is being done, what comes next, a term it uses.
- A card that restates its passage does not add to it, nor does one that bears on another part of the story rather than this passage.
- Judge the card's place beside its passage only, not whether its facts are true.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Judge: an Update note (the `update` step)
// ---------------------------------------------------------------------------

export const noteJudgeSchema = z.object({
  accurate: z.boolean().describe('True when everything the note says matches <CHANGES> and <FACTS>. False when it states anything they do not.'),
  complete: z
    .boolean()
    .describe('True when the note says what changed in the story and why: the newer reporting behind the change. False when either is missing.'),
  problem: z.string().describe('One short sentence: what the note gets wrong or leaves out. Empty string when it is accurate and complete.'),
})

export type NoteJudgeAnswer = z.infer<typeof noteJudgeSchema>

export interface NoteJudgeInput {
  /** The story's day, `YYYY-MM-DD`. */
  storyDay: string
  /** Each section the update changed: its text before, and after (null when it was removed). */
  changes: { section: string; before: string; after: string | null }[]
  /** The newer facts the changes rest on, and the facts they showed wrong. */
  facts: { id: string; statement: string; outlet: string; date: string | null; contradicted: boolean }[]
  note: string
}

export function buildNoteJudgePrompt(input: NoteJudgeInput): string {
  const changes = input.changes
    .map(
      c => `<CHANGE section="${escapeXml(c.section)}">
${tag('BEFORE', c.before)}
${c.after === null ? '<AFTER removed="true"></AFTER>' : tag('AFTER', c.after)}
</CHANGE>`,
    )
    .join('\n')
  const facts = input.facts
    .map(
      f =>
        `<FACT id="${escapeXml(f.id)}" outlet="${escapeXml(f.outlet)}" date="${escapeXml(f.date ?? 'unknown')}"${f.contradicted ? ' contradicted="true"' : ''}>${escapeXml(f.statement)}</FACT>`,
    )
    .join('\n')
  return `<ROLE>
You are a standards editor. You check the short Update a news site prints at the top of a story it has corrected or brought up to date.
</ROLE>

<GOAL>
Judge whether <NOTE> tells a reader accurately and completely what changed in the story and why.
</GOAL>

${tag('STORY_DATE', input.storyDay)}

<CHANGES>
The sections of our story the update changed, as they read before and after. Our own text.
${changes}
</CHANGES>

<FACTS>
The newer reporting the changes rest on; a fact marked contradicted is one the story had relied on and newer reporting showed wrong. ${UNTRUSTED}
${facts}
</FACTS>

${tag('NOTE', input.note)}

<REQUIREMENTS>
- The note is accurate when every claim in it is stated by <CHANGES> or <FACTS>: no figure, date, name or cause they do not give.
- The note is complete when a reader learns what in the story changed (the claim, figure or section) and why (the newer reporting, or the earlier claim shown wrong). Every change need not be listed when the note names the main one and says the rest were brought up to date.
- A note that only says the story was updated, without what changed, is not complete.
- Judge the note against <CHANGES> and <FACTS> only, never on your own knowledge of the subject.
</REQUIREMENTS>`
}
