---
status: draft
type: feature
complexity: complex
---

# Researched stories in our own words, cited per paragraph

Owner decision (2026-11-13): **write in our own words, and cite per paragraph instead of per sentence.** Context: `.context/story-research.md`, `.context/public-website.md` ("Researched stories"), `.context/ai-transparency.md` (§2 "AI features", the "Story research" row; §3 "Duties and measures", the "Story page" and "Methodology and correction channel" rows), `.context/prompting.md`.

Revised 2026-11-13 after a cold review. The coordinator decided: the judge works sentence by sentence; the code check also compares against fact statements, and the extraction prompt is tightened; every written item reaches the judge; tokenization and labels are specified; each problem records its cause.

## Open questions for the owner

Each has a default the plan builds unless the owner says otherwise.

1. **Methodology wording** (below, "Copy"). *Default: it ships only once approved, as the last commit of this change.* The current text is untrue for new drafts once this lands, so approval should come before the first apply.
2. **The opening paragraph.** Per sentence, a failing opening sentence was only dropped. Per paragraph, dropping the first paragraph would remove the what, who, where and when. *Default (kept by the coordinator, legally conservative): if the first story paragraph still fails after the rewrite, the run falls back (`draft_failed_check`), as a failing key claim does.* The shadow week measures how often this happens, by cause.
3. **The verbatim threshold.** The code check flags a run of **12 or more consecutive words** shared with one source's wording or with one of its fact statements. Shorter runs collide with the write prompt's own scope rule: "22 GW of rooftop solar in two years" has to be repeated exactly as the fact states it. *Default: 12 for both comparisons. Each item's longest run is recorded, so the shadow week shows the distribution; a lower bar is the legal reviewer's call.*
4. **Stories already applied** in the old format, if any (applying has stayed closed behind `RESEARCH_APPLY_ENABLED`). They keep per-sentence citations and were never checked for copying. *Default: nothing is migrated. The owner reverts any such story by hand, or re-researches it and applies the new run.*

## Problem

Live research drafts reuse a lot of the sources' expression: in each story, several small passages are close translations of a source's sentences. That risks the press publishers' right and copyright, since a close translation still reuses expression and attribution does not license it. Per-sentence citations push the writer the same way: a sentence tied to one fact reads most naturally as that fact's source sentence, restated.

## Approach

Five changes, all inside the research run and its reader projection. Sourcing, the gate, applying, the apply gate and the pipeline step stay as they are.

### 1. The writer sees less source wording, and writes a synthesis (prompts)

- **The write prompt no longer carries the original article's full text** (`<ARTICLE>`'s `<TEXT>`). Its facts are already in `<FACTS>` as `S0`, extracted for the same development; the block keeps the title, publisher, URL and date and says the article's facts are source `S0`. This fixes the root cause: the writer can only follow passages it is shown. With the article text gone, **every source wording the writer sees is also in front of both checks** (the facts' `SENTENCE`s, the voices' `QUOTE`s, the source titles), which makes the judge's material complete. Trade-off: the write step's own rating loses the article's detail. That rating is recorded only and never reaches a story (owner decision 2026-11-12), and `eval:research` reports its drift. *Alternative considered:* keep the text and also pass it to the fact check. Rejected: it adds the article's tokens to every check call, and it leaves the writer the one source it follows most.
- **`SENTENCE` stays in `<FACTS>`.** The key quote comes from it or from a `VOICE`'s `QUOTE`, and it shows the writer a figure's scope. The rules below and both checks cover it.
- **GOAL line, reworded:** "Write the researched version of the story in <ARTICLE> from the facts in <FACTS>, in our own words: title label, title, a story of 150-250 words in 2-4 paragraphs, each citing the facts it uses, a short summary, Why This Matters, Caveats, key quote, marketing blurb, relevance calculation and final rating, and two checks on the development (<OLD_NEWS>, <CONTRADICTED>). Avoid jargon."
- **A new `<OWN_WORDS>` block in `<REQUIREMENTS>`**, written declaratively as `prompting.md` asks:
  - The story is a short synthesis in our own words. Each paragraph combines facts from across the sources and compresses them into fewer, shorter sentences than the sources use.
  - It never translates or restates a source's sentences, nor a fact's statement, and never follows one source's order of points or its structure. The order is the story's own: what happened, then why and who is affected, then what comes next, as the Story block says.
  - It carries no run of a source's words, in any language, beyond names, titles, figures with their units and the scope a fact records.
  - No quotation marks appear in the title, the story, the bullets, the summary or the blurb. A person's exact words appear only in the key quote.
  - One Bad/Good pair, since reasoning models need the contrast (`prompting.md`, "Published fields never talk about the input"). Bad: a close English rendering of a German `SENTENCE`. Good: the same facts merged with a second source's in one plain sentence.
- **The Citations block, reworded per paragraph:** every paragraph cites, by id, every fact it uses, and says nothing its cited facts don't state. A bullet that states a fact cites it; a bullet that only judges cites nothing. The scope, weekday-date and `E` lines stay.
- **Kept unchanged:** one development; month and day in the opening paragraph; plain language for a smart 16-year-old; 150-250 words in 2-4 paragraphs; the bullet counts and rules; the key quote and blurb; the rating blocks; `<OLD_NEWS>`, `<CONTRADICTED>` and `<GUIDELINES>`. The length stays because the rating text sits in the same call (`prompting.md`, "Rating wording is calibration"). "Short synthesis" comes from compression, not a new word count.
- **The rewrite's `<PROBLEMS>` block** says "failed the checks" instead of "the citation check" and adds one line: an item flagged for copying a source is written again in our own words, merged with other sources' facts, not lightly reworded.
- **Format guidance in the schema** (`prompting.md`, "Schema carries format guidance"): `story` becomes an array of cited paragraphs, `{ text, factIds }`. `text` is described as "One paragraph of 2-4 short sentences in plain text, no Markdown, no fact ids, no quotation marks", and `factIds` as "Ids of every fact in <FACTS> the paragraph states". The bullets keep `citedBullet`, with "no quotation marks" added to its text description; the title's description gets the same.
- **The extraction prompt is tightened**, since the writer reads statements and the code check now compares against them. A fact's `statement` restates the fact neutrally in plain English: who did what, with the figure, its scope and period, and who claims it. It is never a translation or a rewording of the supporting sentence: the order and phrasing are the extractor's own, while names, figures and scope stay exact. This goes in the `factSchema.statement` description and as one `<REQUIREMENTS>` line in `buildExtractionPrompt`. `supportingSentence` stays verbatim, since `supportFound` depends on it. Risk: fact fidelity. The eval's manual sample reads statements against their sentences.

### 2. One citation group per paragraph and per bullet (schema and projection)

- **The draft (`writeSchema`):** `story: { text, factIds }[]`. The run's draft is internal, so its shape simply changes.
- **The stored projection and the public API keep their shape.** `researchedStorySchema.paragraphs` stays `{ sentences: CitedText[] }[]`, and a new draft's paragraph is stored as **one** cited text in `sentences`. *Why:* `research` is in the public OpenAPI contract (`PublicStoryDetail`), and reshaping it is a breaking public-API change, the owner's call (`.context/ci.md`, "Public API contract"). Keeping the shape means old and new projections parse with the same schema: no data migration and no read-time union. It also means the reader needs no change to show one citation button at the end of each paragraph, since `CitedSentences` already puts a button after each item. Accepted naming debt: for new stories, `sentences` holds one passage per paragraph. **Both OpenAPI descriptions say so**: the `.describe()` on `researchedStorySchema.paragraphs` in `researchedStory.ts` (today "each a list of cited sentences"), and the `research` description in `openapi.ts` (today "a citation of its source after each sentence and bullet"). Both become "one citation group after each paragraph and bullet; versions applied before 2026-11-13 cite after each sentence". Then `npm run api:snapshot --prefix server`; this is a description change, not a breaking one. *Alternative considered:* `paragraphs: CitedText[]`, with old projections normalized on read. Rejected: it breaks the API and adds a read path that rewrites stored data, only for a cleaner name.
- **`buildResearchedStory`** maps each draft paragraph to `{ sentences: [cite(paragraph, pool)] }`. `cite()` is unchanged: one citation per source in first-cited order, each with that source's first supporting sentence for the card. `forReaders`, `researchedStoryText` and `storedResearchText` (used by the podcast) work on both shapes unchanged.
- **Old runs**, stored with `{ sentences }` paragraphs: `appliedDraftSchema` (a `pick` of `writeSchema`) refuses them with the existing 409 "This run is from an older format and cannot be applied; research the story again". That is the intended outcome: those drafts were neither written nor checked for our own words. The admin run view reads both shapes (`'sentences' in p ? p.sentences : [p]`), and the shared type says so.
- **Client:** the citation dialog's name becomes "Source for this passage" / "Sources for this passage" instead of "… for this sentence". Bullets and the quote use the same component, so "paragraph" would be wrong there. This is an accessible name, not AI label copy. **`Citation.tsx` and `CitedText.tsx` are being edited by another agent: make these changes after that work lands, on top of it.**

### 3. Checks per paragraph and bullet

- **Items and labels.** `draftSentences` becomes `draftItems`, with one item per written field the checks read:
  - `Story paragraph N` (cited)
  - `Why This Matters N` and `Caveat N` (cited or judging only)
  - `Title`, `Summary` and `Blurb` (never cited)

  These exact labels are what the problems, the rewrite's problem lines (`describeProblem`: `<label> ("<text>") <problem>`), `dropFailing` and `longestRuns` use. The title label and the key quote are not items: the label is 1-3 words, and the quote is meant to be a source's words.
- **Each problem records its cause:** `CitationProblem` gains `kind: 'fact' | 'copying'` and `by: 'code' | 'judge'`. For copying problems it also gets `sourceId`, plus `against` (`'wording' | 'statement'`, code) or `copiedSentence` (judge). This lets the shadow week count first-draft flags by cause and compare code against judge, which is where judge precision shows.
- **The code citation check (`checkCitations`)** runs per cited item and per bullet: unknown ids; a story paragraph that cites nothing; every number in the item found in its evidence (`evidenceFor`: the cited facts plus the same sources' other facts, the `S2F0` publication-date facts included). The rules are the same but the unit is wider, so a paragraph's numbers are checked against the union of its sources' facts. Its problems are `kind: 'fact', by: 'code'`.
- **The LLM fact check:** every item now goes to the judge (section 4 says why and what it costs). Each cited item is judged as today for support: `supported` covers every claim of the passage, `problem` names the first unsupported claim, and `key` keeps its meaning (the unsupported claim is the main development itself). The weekday-date rule stays. An item with no cited facts (title, summary, blurb, a judging bullet) is judged for copying only, and the prompt says that `supported` is true for it. Support problems are `kind: 'fact', by: 'judge'`.
- **Rewrite or remove, per item.** Both checks run on every draft, and any problem triggers the one rewrite. After it, `dropFailing` drops each failing story paragraph or bullet. It falls back (`draft_failed_check`) on any of the following, and the result names the label it failed on (`failedOn`, recorded in `StoryResearch`, so the report can attribute fallbacks to causes):
  - a key claim fails
  - a part is left empty
  - `Story paragraph 1` still fails (open question 2)
  - `Title`, `Summary` or `Blurb` still fails (they can't be dropped)

### 4. The close-paraphrase check: a judge in the existing call, and a code check

Because of step 1, the writer sees source wording only in the outside sources' `SENTENCE`s, `QUOTE`s and titles, and their fact statements. Both checks compare against exactly that.

**The judge, inside the existing fact-check call (no new call).**

- **Prompt shape.** One shared `<SOURCE_WORDING>` block, placed once at the top: for each outside source (`S…`, never `E…`), its title (id `S2T`), each fact's `SUPPORT` sentence (id `S2F3`), and each voice's quote (id `S2Q1`), all in the original language. Then `<ITEMS>`, one `<ITEM number label>` per item in `draftItems` order, each with its `CITED_FACTS` (built by `evidenceFor` as today, statement and `SUPPORT`) or none.
- **Per item, beside `supported`, `problem` and `key`:**
  - `copiedSentence`: the id in `<SOURCE_WORDING>` of a source sentence, quote or title that any one sentence of the item renders closely, in nearly the same words or as a close translation, in any language; an empty string when none does.
  - `followsSource`: the id of the one source whose points the item follows in that source's order and phrasing; an empty string when none.
- **Rules.** One rule in `<RULES>`: sharing names, figures, units, places and technical terms alone is not copying. There is no exemption for passages that merge several sources: each sentence is judged on its own.
- **What a flag becomes.** A flag is a problem with `kind: 'copying', by: 'judge'`, its `sourceId` and `copiedSentence`, and the text "renders S2F3 closely" or "follows S2's order and wording". It is never key.
- **Why all items, and one shared block.** The title, summary, blurb and judging bullets are published text too, and copying a headline or a lead into a summary is the likeliest reuse that slips past a check run only on cited passages. One shared block, compared by every item against every outside source, is the cheapest complete option. Copying from a source an item does not cite is caught too, and no item repeats the quotes or titles. The cited items' `CITED_FACTS` keep their `SUPPORT` sentences for the support judgment, as today.
- **Cost.** About 6 sources × (8 sentences + 4 quotes + 1 title) at roughly 30 tokens each, about 2.5k input tokens once per check call. At the small tier's $0.10/M with the 1.25 cache-write factor, that is about $0.0003 per call, at most two calls a run: about $0.0006, some 4% of a $0.014 run. Against it, cited items fall from about 15 sentences to 7 or 8 passages, and the write and rewrite prompts lose the article text. *Alternative considered:* repeat each cited source's quotes and title inside every passage. Rejected: it costs more for the same evidence and leaves uncited items without it. A separate judge call was rejected too: it would repeat the evidence for no gain.

**The code check, `checkCopying(draft, sources, minWords)`** (`researchChecks.ts`; pure and free).

- **What it compares.** For each item (title, story paragraphs, bullets, summary, blurb) and each outside source (`S…`, never `E…`), it finds the longest run of consecutive tokens the item shares with any one of that source's strings, each compared separately so a run never crosses from one string into the next. The strings come in two kinds:
  - `wording`: the title, each `supportingSentence` and each voice `quote`
  - `statement`: each fact's `statement`
- **What gets flagged.** A run of `config.research.copiedRunWords` tokens (12) or more, of either kind, is a problem with `kind: 'copying', by: 'code'`, its `sourceId` and `against`, and the run quoted. A quoted span of 4 or more tokens in any item is one too ("quotes a source; a person's words go only in the key quote"). The check is deterministic: it catches verbatim reuse that the judge might excuse, and it gives the shadow week a number that doesn't depend on a model.
- **Tokenization** (one exported helper, `wordTokens(text)`, used for both the run and the quoted-span length):
  - First: Unicode NFKC, soft hyphens (U+00AD) removed, lowercase.
  - **A token is** a maximal run of letters, combining marks and digits (`[\p{L}\p{M}\p{N}]`), or a single `%` or currency symbol (`\p{Sc}`), each of which is a token of its own.
  - **A letter-digit boundary splits:** "22GW" and "22 GW" both give `22`, `gw`.
  - **Digit groups join:** a `,`, `.`, `'`, `’` or space (U+0020, U+00A0, U+202F) with a digit on both sides is dropped, so "1,200", "1.200" and "1 200" all give `1200`. Then "3.5" gives `35`, which is only an equality key, never shown.
  - **Apostrophes inside words** (`'` or `’` with a letter on both sides) are dropped: "Pakistan's" gives `pakistans`.
  - **Hyphens and dashes** (U+002D, U+2010-U+2015, U+2212) and everything else, quote marks and punctuation included, are separators: "long-term" gives `long`, `term`.
- **Quoted spans:**
  - **Openers:** `“`, `„`, `«`, `»`, `‹`, `›`, `‚`, `‘`, a straight `"`, and a straight `'` at the start of a word (after the text's start, whitespace or `(` or `[`, and before a letter).
  - **Closers:** `”`, `“`, `»`, `«`, `›`, `‹`, `’`, `‘`, `"`, and a straight `'` at the end of a word (before the text's end, whitespace or `.,;:!?)]`).
  - **Matching:** a span runs from an opener to the nearest closer of the same family (double: `“ ” „ " « »`; single: `‘ ’ ‚ ' ‹ ›`). So `„…“`, `„…”`, `«…»`, `»…«` and `“…”` match. An apostrophe inside a word never opens or closes a span.
- **Recorded for the shadow week:** `longestRuns`, each item's longest run per source and per kind, `{ label, sourceId, against, words }`, below the threshold too.

**On a flag:** the one rewrite, with the problem lines. If the item is still flagged after it, the paragraph or bullet is dropped, or the run falls back (section 3).

**Recorded in the run** (`result`, for the shadow evaluation):

- `checks`: one entry per check pass (one, or two after a rewrite), each `{ problems, longestRuns }`.
- `failedOn`: the label a fallback failed on.
- `problems` keeps its meaning: what the last check found.

From these come first-draft flags by cause, the rewrite rate, items dropped for copying, fallbacks by cause and the run-length distribution. There is no aggregate endpoint: `.context/story-research.md` gets the read-only SQL over `result->'checks'` for the week's tally.

**Cost:** a run stays at or under today's ~$0.014 unless the rewrite rate rises, and that rate is the one cost the shadow week must watch (a rewrite is a medium-tier call, about a third of the run). The judge's two new fields per item are a few output tokens each. `STEP_OUTPUT_TOKENS` is re-checked against the output the eval measures, not raised by guess.

*Not chosen:* an embedding similarity check between items and source sentences. It needs a new call per run, and similarity of meaning is expected here, since the story restates the facts. Also not chosen: n-gram overlap against translated sources, which would need a translation call per source.

### 5. Copy (for the owner's approval; American English, no em dash)

Methodology page, "Researched Stories", end of the first paragraph. It replaces "From the facts these sources report, AI writes the story and cites a source after every sentence. Tap a citation to see the outlet, its date and the sentence from it that backs the claim, chosen by AI and possibly translated.":

> From the facts these sources report, AI writes a short story in its own words, combining what the sources say rather than translating or following any one of them, and cites the sources it draws on at the end of each paragraph. Tap a citation to see each outlet, its date and a sentence from it that backs the paragraph, chosen by AI and possibly translated.

Start of the second paragraph. It replaces "Every sentence is then checked against the sources it cites, first by code and then by a second AI check. A sentence that fails is rewritten once and removed if it still fails.":

> Each paragraph and point is then checked against the sources it cites, first by code and then by a second AI check. Both checks also look for text that follows a source's wording too closely, in the headline and summary too, and the AI check catches close translations. A paragraph or point that fails is rewritten once and removed if it still fails.

The rest of the second paragraph stays. The section comment's date becomes the approval date.

`ai-transparency.md`:

- **§2 "AI features", the "Story research" row:** the draft is written in our own words, with one citation group per paragraph and bullet. The fact check also judges every written item for close copying of a source, translations included, and a code check looks for verbatim runs. The write step no longer reads the article's full text.
- **§3 "Duties and measures", the "Methodology and correction channel" row:** "a citation after every sentence" and the per-sentence check give way to the approved wording's content and its approval date.
- **§3, the "Story page" row:** a citation card's sentence backs a paragraph or bullet; the dialog's name.
- **§11 "Open items", the "Story research" item:** the legal reviewer gets this design and the shadow numbers.

No AI label wording changes (`aiDisclosureCopy.ts` and `aiLabelCopy.ts` stay untouched).

## Changes

| File | Change |
|------|--------|
| `server/src/prompts/research.ts` | `buildWritePrompt`: drop `<TEXT>` from `<ARTICLE>`, the new GOAL line, `<OWN_WORDS>`, the Citations block per paragraph; `problemsBlock` wording. `buildExtractionPrompt`: the neutral-statement requirement. `buildFactCheckPrompt(items, sources)`: `<SOURCE_WORDING>` once, `<ITEMS>` with labels, the copying rule; `CheckedSentence` becomes `CheckedItem` (`label`, `text`, `facts`) |
| `server/src/schemas/research.ts` | `writeSchema.story` as `citedParagraph[]`; "no quotation marks" in the title and text descriptions; `factSchema.statement` description (neutral, not a translation); `factCheckSchema.items` with `copiedSentence` and `followsSource` |
| `server/src/services/researchChecks.ts` | `draftItems` (was `draftSentences`) with the labels above; `kind`, `by`, `sourceId`, `against`, `copiedSentence` on `CitationProblem`; `checkCitations` per item; new `wordTokens`, `quotedSpans` and `checkCopying` returning problems and `longestRuns`; `dropFailing` per item, with the paragraph-1 and title/summary/blurb fallbacks, returning `failedOn`. Same responsibility as the file today (deterministic judgments on a draft), so no new module |
| `server/src/services/researchPipeline.ts` | `check()` runs `checkCitations`, `checkCopying` and the fact check over all items, maps `items` back to labels (support and copying problems); `writeChecked` pushes each pass onto `r.checks` and records `failedOn`; `StoryResearch.checks`, `failedOn` |
| `server/src/config.ts` | `research.copiedRunWords: 12` (no env override, like `maxRunUsd`) |
| `server/src/services/researchedStory.ts` | `buildResearchedStory`: one cited text per paragraph; the `paragraphs` and `citedTextSchema` `.describe()`s as in section 2 (they feed OpenAPI) |
| `server/src/lib/openapi.ts` | The `research` description as in section 2; then `npm run api:snapshot --prefix server` |
| `server/src/services/researchSwap.ts` | No code change (`appliedDraftSchema` picks the new `story`); its comment names drafts from before 2026-11-13 as the refused older format |
| `server/src/services/researchCalls.ts` | `STEP_OUTPUT_TOKENS` for `fact-check`, `write` and `rewrite` re-checked against the eval's measured output |
| `server/src/scripts/eval/research/report.ts` | `draftLines` renders paragraphs; a report section "Own words": first-draft flags by cause (`kind` × `by`, and `against` for code), rewrites they caused, items dropped, `draft_failed_check` fallbacks by the cause of the `failedOn` item's problems, the longest-run distribution per kind (max, share at 8+ and 12+), and fact-check input tokens per call (mean, max) next to the per-step table |
| `server/src/scripts/synthetic-data/research.ts` | Synthetic run draft in the new paragraph shape |
| `shared/types/index.ts` | `ResearchDraft.story` as `(ResearchCitedText \| { sentences: ResearchCitedText[] })[]` (older runs); `kind?`, `by?`, `sourceId?`, `against?`, `copiedSentence?` on the problem type; `checks?` and `failedOn?` on `ResearchResult` |
| `client/src/components/admin/ResearchRunView.tsx` | Draft renders both paragraph shapes; each problem shows its cause |
| `client/src/components/research/Citation.tsx` | Dialog name "Source(s) for this passage"; doc comment. **After the other agent's work in this folder lands** |
| `client/src/components/research/CitedText.tsx` | Doc comment only (one item per paragraph in new versions). **After the other agent's work in this folder lands** |
| `client/src/pages/MethodologyPage.tsx` | The approved wording, once approved |
| `.context/story-research.md` | "What a run does": writer input, per-item checks and labels, the copying checks with the tokenization summary and threshold, `checks` and `failedOn` in the result, the paragraph-1 and title/summary/blurb fallbacks; "Reader format": one cited passage per paragraph, older projections per sentence; "Applying a run": runs from before 2026-11-13 refused as the older format; the shadow-week SQL; "Rollout": what the shadow week measures |
| `.context/public-website.md` | "Researched stories", "Citations": after each paragraph or bullet; the dialog's name |
| `.context/prompting.md` | One lesson paragraph: the writer is not shown source text the checks can't see; the own-words rule with its Bad/Good pair; statements restate, they don't translate |
| `.context/model-eval.md` | "Research measurement": the "Own words" metrics; the write step no longer reads the article's text; the 2026-11-13 run's folder and cache reuse (below) |
| `.context/ai-transparency.md` | The rows named in section 5 |

## Tests

These follow the existing `researchChecks.test.ts`, `researchPipeline.test.ts` (a fake `call` answering per step), `researchedStory.test.ts`, route and RTL patterns.

- **Fixture moves.** In `researchChecks.test.ts` and `researchPipeline.test.ts`, the draft builders and inline drafts move to the paragraph shape (`story: [{ text, factIds }]`). The fact-check fakes (`allSupported` and the `<SENTENCE number=…>` regex) move to `<ITEM number=…>` and `items` with empty `copiedSentence` and `followsSource`. The same move applies to the fixtures in `researchApply.test.ts`, `researchApply.db.test.ts`, `researchSwap.test.ts`, `promptInputs.test.ts`, `report.test.ts`, `stories.db.test.ts` and the client's `StoryResearch.test.tsx`, without new cases.
- **`researchChecks.test.ts`:**
  - `checkCitations` per paragraph: a paragraph citing nothing fails; a number found only in another cited source's fact passes; an unknown id fails.
  - `wordTokens`: "22GW" and "22 GW" give the same tokens; so do "1,200", "1.200" and "1 200"; "Pakistan's" is one token; "long-term" is two; `%` and `€` are tokens of their own.
  - `checkCopying`, wording: a 12-token run shared with one source's supporting sentence is flagged with that source, `against: 'wording'` and the run quoted; 11 tokens pass; case, punctuation and quote marks don't matter; an `E` source never flags; a run spread across two strings or two sources does not flag.
  - `checkCopying`, statements: a 12-token run shared with a fact's `statement` is flagged `against: 'statement'`, and `longestRuns` keeps each kind's longest run apart, below the threshold too.
  - Quoted spans: `„…“`, `«…»` and `“…”` spans of 4 tokens flag; 3 tokens pass; an apostrophe in "Pakistan's" opens nothing.
  - Coverage: title, summary and blurb are checked, under those labels.
  - `dropFailing`: a failing later paragraph is dropped. Each of these gives `failed` with its `failedOn`: a failing `Story paragraph 1`, a key claim, an emptied part, a still-flagged `Title`, `Summary` or `Blurb`.
- **`researchPipeline.test.ts`:**
  - The write prompt doesn't contain the article's text, the guarantee the judge's completeness rests on.
  - Which items reach the judge: every item in `draftItems` order, uncited ones without `CITED_FACTS`. `<SOURCE_WORDING>` carries each outside source's title, supporting sentences and voice quotes under their ids, and no `E` source.
  - A judge `copiedSentence` on the first draft triggers the rewrite with a "renders S1F2 closely" line. If the paragraph is still flagged, it is dropped and the run kept. `checks` then holds two passes whose problems carry `kind` and `by`.
  - The fact check's `items` map back to the right labels, and an uncited item's `supported: false` is ignored.
- **`researchedStory.test.ts`:** a paragraph draft gives one cited text per paragraph, with per-source citations in first-cited order. A stored per-sentence projection still parses, and `storedResearchText` joins it as before.
- **`researchApply.test.ts`:** a run whose draft has `{ sentences }` paragraphs is refused as the older format.
- **`routes/admin/research.test.ts`:** the pinned result JSON shape gains `checks` and `failedOn`, and each problem's `kind` and `by`.
- **`ResearchRunView.test.tsx`:** renders a new-shape and an old-shape draft.
- **`report.test.ts`:** the "Own words" section counts flags by cause, dropped items, and fallbacks by cause.

There are no tests for prompt wording, the methodology copy or the dialog's name, beyond updating the existing assertions they break.

## Eval and the shadow week

- **Before merge, `eval:research` on the same sample.** The run gets a new folder, `DOCS/2026-11-13_research-own-words-eval`. Copy into it `.cache/research-fixtures.json` and `.cache/tavily.jsonl` from `DOCS/2026-11-12_research-eval`: the same 30 stories, and the same search answers at no Tavily cost. Then copy that folder's `research-report.md` alongside as `research-report-baseline-2026-11-12.md`. The 2026-11-12 folder is never written to. Model calls miss the cache anyway (the schemas are versioned and the prompts changed), so the extraction, write and checks all run again within `--budget 3`.
- **What to compare with the baseline:**
  - kept drafts, and fallbacks by category and by cause
  - the rewrite rate, and items dropped
  - first-draft flags by cause
  - the longest-run distribution per kind
  - fact-check input tokens, and cost per story
  - research-rating drift
- **Reading by hand.** Read 10 drafts side by side with their sources, non-English sources first, for close copying the judge missed, and the new statements against their supporting sentences for fidelity.
- **`eval:recalibrate` does not apply.** No production rating, dedup, social or selection prompt changes, and research's rating is recorded only.
- **The shadow week** (production runs, through the SQL in `story-research.md`):
  - first-draft flags per run by cause (code wording, code statement, judge `copiedSentence`, judge `followsSource`)
  - the rewrites they cause, and the paragraphs and bullets dropped
  - `draft_failed_check` share against the week before, split by cause (fact, copying, paragraph 1)
  - the longest-run distribution, to settle open question 3
  - cost per run
  - a manual sample of about 10 kept drafts and 10 judge-flagged items against their sources, for the legal reviewer: the judge's recall on translations and its precision

## Out of Scope

- The press-publisher-right legal check itself, and opening `RESEARCH_APPLY_ENABLED`: the owner's gate, unchanged.
- The citation card's verbatim source sentence, one per source per citation group (fewer now): unchanged, but worth the legal reviewer's eye with the rest.
- Renaming `paragraphs[].sentences` in the public API (a breaking change, the owner's call).
- Migrating or re-researching stories applied before this change (open question 4).
- An admin aggregate view of copying flags: SQL over `result` serves the shadow week.
- The single-source assess prompt, and the key quote's own checks.
