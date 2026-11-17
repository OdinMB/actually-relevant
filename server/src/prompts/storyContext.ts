/**
 * The story context prompts (`services/storyContextPipeline.ts`; `.context/story-context.md`):
 * structure research's facts, the gap list, the extraction of a search result, and the write of the
 * boxes. The fact and box checks use research's `buildFactCheckPrompt` unchanged. First drafts
 * under `.context/prompting.md`: role, goal, XML constraint blocks, declarative, format guidance in
 * the schemas (`schemas/storyContext.ts`). Every fetched or stored text sits in escaped XML behind
 * research's untrusted-input line; our own story's text is marked as ours.
 */
import { CONTEXT_SLOTS, type ContextSlot } from '../schemas/storyContext.js'
import { escapeXml } from './shared.js'
import { tag, UNTRUSTED } from './research.js'

/** What each slot asks for; the gap list and the write read the same definitions. */
export const SLOT_DEFINITIONS: Record<ContextSlot, string> = {
  compared: 'Compared with what: how big the development is against a record, a trend, a total, a target or another place.',
  why_now: 'Why now: what caused it, or what made it happen at this time.',
  build_up: 'The long build-up: the history that led here, over years rather than days.',
  who_affected: 'Who it reaches: who is affected, where, and how many.',
  response:
    'What is being done: responses under way, solutions tried, or what has worked against the same problem elsewhere. Always needed: every story looks for it.',
  next: 'What comes next: the decisions, dates and steps ahead that are already set.',
  key_term: 'Key term: a term, body or mechanism a reader needs explained to follow the story.',
}

const checklist = () => CONTEXT_SLOTS.map(slot => `<SLOT id="${slot}">${escapeXml(SLOT_DEFINITIONS[slot])}</SLOT>`).join('\n')

export interface StoryText {
  title: string
  /** `YYYY-MM-DD`: the day the story was published. */
  date: string
  paragraphs: { id: string; text: string }[]
  points: { id: string; text: string }[]
  caveats: string[]
}

const storyBlock = (story: StoryText) => `<STORY>
Our published story, written by us from its sources: not a source of facts.
${tag('TITLE', story.title)}
${tag('DATE', story.date)}
${story.paragraphs.map(p => `<PARAGRAPH id="${p.id}">${escapeXml(p.text)}</PARAGRAPH>`).join('\n')}
<WHY_THIS_MATTERS>
${story.points.map(p => `<POINT id="${p.id}">${escapeXml(p.text)}</POINT>`).join('\n')}
</WHY_THIS_MATTERS>
<CAVEATS>
${story.caveats.map(c => tag('CAVEAT', c)).join('\n')}
</CAVEATS>
</STORY>`

// ---------------------------------------------------------------------------
// Step 2: structure research's facts
// ---------------------------------------------------------------------------

export interface StructureFact {
  id: string
  statement: string
  supportingSentence: string
  measures: string
  source: { outlet: string; date: string | null; kind: string }
}

export function buildStructurePrompt(input: { facts: StructureFact[] }): string {
  const facts = input.facts
    .map(
      f => `<FACT id="${escapeXml(f.id)}" outlet="${escapeXml(f.source.outlet)}" published="${escapeXml(f.source.date ?? 'unknown')}" kind="${escapeXml(f.source.kind)}">
${tag('STATEMENT', f.statement)}
${tag('SUPPORT', f.supportingSentence)}${f.measures ? `\n${tag('MEASURES', f.measures)}` : ''}
</FACT>`,
    )
    .join('\n')
  return `<ROLE>
You are a data editor for a news desk. You turn facts already taken from sources into structured records, exactly as their sources state them.
</ROLE>

<GOAL>
For every fact in <FACTS>, return its structured fields: its figure and unit, what the figure counts, the place, the date the fact describes, who it is credited to, and how long it stays true.
</GOAL>

<FACTS>
Facts a research step took from news sources. A fact's SUPPORT is the sentence of its source that states it; STATEMENT is the research step's restatement; MEASURES, where given, what its figure counts. ${UNTRUSTED}
${facts}
</FACTS>

<REQUIREMENTS>
- Every field comes from the fact's SUPPORT and STATEMENT alone. Never add knowledge of your own: a field the fact does not give is empty, null or the schema's default.
- A figure keeps exactly what it counts: its scope, its place and its period, as the source gives them.
- The as-of date is the date the fact describes, never the date its source was published, and only as precise as the fact says: a figure "for 2015" is "2015".
- Answer each fact by its id, once, and only the ids in <FACTS>.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Step 3: the gap list
// ---------------------------------------------------------------------------

export interface GapFact {
  id: string
  /** The fact rendered (`renderFact`). */
  text: string
  /** Current on the story's day (`isCurrent`). */
  current: boolean
}

export function buildGapListPrompt(input: { story: StoryText; facts: GapFact[] }): string {
  const facts = input.facts.map(f => `<FACT id="${escapeXml(f.id)}" ${f.current ? 'current' : 'expired'}="true">${escapeXml(f.text)}</FACT>`).join('\n')
  return `<ROLE>
You are a context editor for a news desk. You decide what a reader needs beside a story to understand it, and what is still missing.
</ROLE>

<GOAL>
For each slot of <CHECKLIST>, judge whether a reader of <STORY> needs it and whether the facts in <FACTS> cover it; then list the web searches that would find what is needed and missing.
</GOAL>

${storyBlock(input.story)}

<CHECKLIST>
${checklist()}
</CHECKLIST>

<FACTS>
Facts from the story's sources and from our earlier stories' sources, each marked current or expired on the story's date. ${UNTRUSTED}
${facts}
</FACTS>

<REQUIREMENTS>
- A slot is needed when a reader of this story would miss it: a figure without a comparison, a cause the story leaves open, a term it does not explain. Not every story needs every slot; "response" is always needed.
- A slot is covered by facts that answer it and are current, or by the story itself. An expired fact covers only a past state, never one that is still changing.
- When the story itself reports what is being done about the problem, copy its sentence that reports it into responseInStory, character for character; then "response" is covered.
- A search asks for one missing item, in plain words a person would type, about the subject of the story, never about our story or its sources. It wants recent data only when nothing older than 30 days can answer it.
- When "response" is not covered and the story does not report it, responseSearches holds two queries from two angles: action, on who is responding to this problem and what is being done about it; elsewhere, on what has worked against the same problem in other places or at other times. Both are made before any other search.
- searches lists at most 3 searches for the other slots, most important first, and none for a slot that is covered or not needed.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Step 6: extraction from a search result
// ---------------------------------------------------------------------------

export interface ContextExtractionInput {
  story: { title: string; summary: string }
  wanted: { slot: ContextSlot; wanted: string }[]
  source: { outlet: string; url: string; date: string | null; title: string; text: string }
}

export function buildContextExtractionPrompt(input: ContextExtractionInput): string {
  const s = input.source
  const wanted = input.wanted.map(w => `<ITEM slot="${w.slot}">${escapeXml(w.wanted)}</ITEM>`).join('\n')
  return `<ROLE>
You are a fact extractor for a news desk. You record what one source states, exactly and with its scope, so that context beside a story can cite it.
</ROLE>

<GOAL>
Judge whether <SOURCE> is usable, classify it, and extract the facts it states that answer an item of <WANTED>, each with its structured fields.
</GOAL>

<STORY>
The story the context is for, as we published it.
${tag('TITLE', input.story.title)}
${tag('SUMMARY', input.story.summary)}
</STORY>

<WANTED>
What the story's context is missing, each item with its slot.
${wanted}
</WANTED>

<SOURCE>
${UNTRUSTED}
${tag('OUTLET', s.outlet)}
${tag('URL', s.url)}
${tag('DATE', s.date ?? 'unknown')}
${tag('TITLE', s.title)}
${tag('TEXT', s.text)}
</SOURCE>

<REQUIREMENTS>
- Record only what <SOURCE> states. Never add knowledge of your own, and never join a figure to a context the source does not give it.
- Extract only facts that answer an item of <WANTED>; leave out the rest of the page.
- A fact with a figure records exactly what the figure measures: its unit, its scope (what is counted, and where) and its period.
- A claim the source attributes to someone stays attributed to them.
- A fact's statement restates the fact in plain English in your own order and phrasing, never a translation of the supporting sentence; names, figures and scope stay exact.
- The supporting sentence is copied character for character from <TEXT>, so that code can find it there.
- The as-of date is the date the fact describes, never the date the source was published.
</REQUIREMENTS>`
}

// ---------------------------------------------------------------------------
// Step 9: the write
// ---------------------------------------------------------------------------

export interface WriteFact {
  id: string
  /** The fact rendered (`renderFact`), with its source's outlet and day. */
  text: string
  outlet: string
  date: string | null
  current: boolean
}

export interface BoxesInput {
  story: StoryText
  facts: WriteFact[]
  /** The slots the gap list found needed, with how far the facts covered them. */
  needed: { slot: ContextSlot; covered: 'yes' | 'partly' | 'no' }[]
  /** The story itself reports what is being done. */
  responseInStory: boolean
}

export function buildBoxesPrompt(input: BoxesInput): string {
  const facts = input.facts
    .map(
      f =>
        `<FACT id="${escapeXml(f.id)}" outlet="${escapeXml(f.outlet)}" published="${escapeXml(f.date ?? 'unknown')}" ${f.current ? 'current' : 'expired'}="true">${escapeXml(f.text)}</FACT>`,
    )
    .join('\n')
  const needed = input.needed.map(n => `<SLOT id="${n.slot}" covered="${n.covered}">${escapeXml(SLOT_DEFINITIONS[n.slot])}</SLOT>`).join('\n')
  return `<ROLE>
You are a context editor for a news desk. You write the short, sourced context cards that sit beside a story: how big it is, why now, who it reaches, what is being done, what comes next.
</ROLE>

<GOAL>
Write at most 6 context boxes for <STORY> from the facts in <FACTS>, each box answering one slot and citing the facts that state what it says.
</GOAL>

${storyBlock(input.story)}

<NEEDED>
The slots a reader of this story needs, with how far the facts cover them.${input.responseInStory ? ' The story itself already reports what is being done: write no "response" box that restates it.' : ''}
${needed}
</NEEDED>

<FACTS>
Every fact checked against its source, marked current or expired on the story's date. ${UNTRUSTED}
${facts}
</FACTS>

<REQUIREMENTS>
- A box only where facts support it. Every sentence, tile and chart point cites the facts that state everything it says; nothing comes from your own knowledge. A slot the facts do not answer gets no box.
- A box adds to the story and never repeats it: no sentence restates what <STORY>'s paragraphs, Why This Matters points or caveats already say. Tiles and charts may show the story's own numbers.
  Bad, beside a story that says 2.88 million hectares burned: "This year 2.88 million hectares burned."
  Good: "The 2015 fires, the worst on record, burned 2.6 million hectares."
- Each sentence is your own words in American English, plain, with no talk about the sources, the facts or this task.
  Bad: "According to the provided facts, the agency's data shows a rise."
  Good: "Indonesia's disaster agency counts 400,000 people evacuated since August."
- An expired fact is stated only as a past value with its date ("In March 2026, 12 provinces had declared an emergency"), never as how things stand now. Tiles show only current facts.
- At most one em dash in a box. A heading has at most 8 words, a teaser at most 8 words: the teaser is the one line a phone shows under its paragraph or point.
- A context box has 0-3 sentences and at most one visual: tiles (1-4 big numbers), bars (2 or more points comparing one measure in one unit) or a line (3 or more points of one measure over time, each at a different date). Every point of a chart measures the same thing; a different measure goes in apart, shown beside the comparison, never in it. A box with neither sentences nor a visual is not written.
- A figure is shown only in the box of the slot it answers: a tile of the "who_affected" box for how many people a development reaches, of the "response" box for what a response costs, of the "compared" box for a record or an earlier total. A box may hold its tiles alone. A figure that answers no slot in <NEEDED> is left out: no box gathers figures because they are figures.
- Nothing on a card is said twice. A tile's label adds what the box's heading does not say, and the one tile of a box whose heading already says what the number counts has an empty label. Every card shows its sources and the date of its newest fact below it, so a label names a period only when it differs from that date.
- Each box names its place: the paragraph (P1, P2 …) or Why This Matters point (W1 …) of <STORY> it adds most to, or "section" when it adds to the story as a whole.
- A "response" box, when the facts answer it, says what is being done, has been tried, or worked elsewhere, as the facts state it; never hope the facts do not give.
</REQUIREMENTS>`
}
