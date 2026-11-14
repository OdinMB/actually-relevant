---
id: ADR-0057
title: "Researched stories: extracted facts, not source texts, feed the writer; numbers are judged by the fact check, not string-matched in code"
status: accepted
date: 2026-11-13
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, architecture]
tags: ["story-research", "fact-check", "prompts", "copying"]
---

# ADR-0057 · Researched stories: extracted facts, not source texts, feed the writer; numbers are judged by the fact check, not string-matched in code

## Context

Story research (`.context/story-research.md`) extracts facts from each source, writes a cited draft
from them, and checks the draft in code and with a fact-check call. The owner found close
translations of source sentences in drafts written while the writer had the original article's text
in its prompt; since the own-words change (2026-11-13) the write step reads only the extracted facts,
their supporting sentences and the voices' quotes. That raised the question whether extraction is
worth keeping at all, or whether the writer should get the sources' full texts with instructions to
reformulate.

Separately, the code's number check (`checkCitations`) made a problem of every number a story
paragraph or bullet stated that its cited facts did not state digit for digit. A problem triggers
the one rewrite and, if it is still there after it, drops the item or, on the first story paragraph,
the title, summary or blurb, falls the run back. Legitimate rewording failed it: "half" for "50%",
"2024 and 2025" for "two years", rounding, a unit converted.

The owner decided both on 2026-11-13. The agent placed the rules: where the hint sits in the
fact-check prompt, and that a bullet citing nothing is judged for its numbers too.

## Decision

- **The writer reads extracted facts, never the sources' full texts.** Extraction stays: one call
  per source turns its text into facts (a neutral statement, the verbatim supporting sentence, what
  a figure measures) and voices, and the write and rewrite prompts get those and nothing else of the
  sources. A possible later middle ground, should the facts prove too thin for good prose: short
  neutral per-source summaries beside the facts, never source wording.
- **Numbers are the fact check's to judge.** The code's citation check fails only a citation's
  structure: an id that is not among the facts, and a story paragraph that cites nothing. A number a
  story paragraph or bullet states that its evidence (`evidenceFor`) does not state digit for digit,
  and for a bullet that cites nothing every number it states, never fails anything by itself: it
  goes to the fact-check call as a hint for that item (`checkedItems` in
  `server/src/services/researchChecks.ts`, `<NUMBERS_NOT_FOUND>` in the prompt), whose rules count a
  number given in other words, rounded or in another unit as stated. The fact check's verdict
  decides. An item that cites nothing but carries hints is judged for support, so a number it states
  as a fact needs a cited fact behind it. Each check pass records its hints (`numberHints`, per
  label) for the shadow week's tally.

Rule: a number mismatch the code finds never fails an item by itself; where numbers slip through,
tighten the fact check's rules instead.

## Consequences

- Everything of a source the writer sees is a supporting sentence, a quote or a title, the lines
  both copying checks compare against (`sourceLines`), under the ids the judge's flags name. Fetched
  text, which is untrusted, stays in the extraction step, apart from the step that writes
  reader-facing text.
- Each paragraph is checked against a handful of facts, not whole articles, and the reader's
  citation card shows the fact's supporting sentence with no further step.
- The writer has only what extraction kept: a detail the extraction dropped cannot reach the story,
  and a fact's statement must not itself echo its source (the extraction prompt says so).
- A reworded, rounded or converted number no longer costs a rewrite or an item. The price is that a
  wrong number the fact check misses is no longer caught by code. The fact check already runs on
  every draft, so this adds no call; its prompt grows by one line per hinted item and three rules.
- A bullet that cites nothing and states a number is dropped only when the fact check finds the
  number unsupported; before, code failed it whatever the number was, the year in "the 2015 Paris
  Agreement" included.
- The shadow week reads `numberHints` against the fact check's verdict on the same items (SQL in
  `.context/story-research.md`, "Own words"; `eval:research` counts the same). Hinted items it
  passed are worth a sampled read against their facts, for the judge's leniency.

## Alternatives considered

- **Drop extraction and put the sources' full texts in the write prompt, with instructions to
  reformulate:** the close translations were written while the writer had article text in front of
  it, and a prompt is the weakest lever against copying; each paragraph would be checked against
  whole articles (costlier and looser); the citation card's backing sentence would need a new step;
  and fetched text would reach the step that writes reader-facing text. Cost is roughly even, so it
  decides nothing.
- **Keep the number check as a hard problem and widen its matching** (spelled-out fractions, year
  ranges, unit tables): every new form is another rule to keep in step with how writers reword, and
  it still fails whatever it does not know.
- **Drop the number check altogether:** loses the pointer that tells the fact check where to look,
  and the tally of how often code and fact check disagree.

## Amendment 2026-11-13: key quote

The draft's key quote (`quote`, `quoteAttribution`, `quoteSourceId`) was checked by nothing, code
or fact check. The owner decided on 2026-11-13 that the existing fact-check call judges it, with no
new call; the agent placed the rules marked below.

- **The fact check judges the key quote for faithfulness**, as its last item (`Key quote`,
  `checkedQuote` in `server/src/services/researchQuote.ts`), with its attribution and the source it
  names, against that source's quotes and supporting sentences in `<SOURCE_WORDING>`. Faithful: the
  same words or their English translation, the same meaning and the speaker the source gives them
  to; context in square brackets, an ellipsis for words left out and differences of quote marks,
  punctuation or case are faithful. So that the speaker can be checked, each quote in
  `<SOURCE_WORDING>` now names its speaker (the agent's placement).
- **Code never fails its words.** As for numbers, its only judgment is a hint
  (`<QUOTE_NOT_FOUND/>`, `quoteFound`): the quote, split at brackets and ellipses, does not stand in
  order in one of those lines. A translation never does, so the hint decides nothing.
- **Neither copying check flags it**: it is the one place a source's exact words belong.
- **A `quoteSourceId` that is not one of the run's sources fails it in code**, and the judge does
  not see it. An earlier story of ours (`E…`) is not a source it may quote (the agent's placement:
  its sentences are our own AI-written text, and `<SOURCE_WORDING>` holds none of them).
- **A failure goes into the one rewrite. A key quote still failing after it is dropped, never the
  run**: all three fields are emptied, so the story publishes without a key quote; its problem is
  never key and is listed with the run's problems. An unjudged key quote fails nothing.

Rule: the key quote is judged only for faithfulness to its source, by the fact check; code may
hint about its words and check its source id, and nothing judges it for copying.

Consequences: a misquote or a misattribution the fact check catches no longer reaches readers; a
quote failing alone costs a rewrite, a medium-tier call; some researched stories publish without a
key quote. Its problems count under `fact` in the tallies, told apart by the label `Key quote`
(`.context/story-research.md`, "Own words").

## Amendment 2026-11-13: copying standard

The fact check flagged plain restatements of a source's fact as copying, such as "Countries raised
domestic tuberculosis funding by 14% to $5.6 billion between 2024 and 2025, partly making up for
falling international support." against WHO's "domestic funding for TB increased by 14% to US$ 5.6
billion between 2024 and 2025, in part offsetting a decline in international financing of a
similar scale." A flag costs a rewrite and, if it stays, the item or the run. The owner decided on
2026-11-13 that the judge's standard is expression, not facts; the agent placed the rules marked
below.

- **Copying is reproducing a source's expression**: its distinctive phrasing, its sentence
  structure, or its sequence of points across several sentences, in nearly the same words or as a
  close translation. A close translation of a source's sentence still counts. The prompt words the
  structure as "a sentence structure the facts do not dictate" (the agent's wording), so that it
  does not contradict the next rule.
- **Facts are free to use**: plainly restating one fact with its names, figures, units, period and
  scope is not copying, even in the source's order and close to its words, since there are few
  ways to say it.
- **Following the order of the only source an item cites is not copying.** `followsSource` is for
  an item whose sentences follow one source's order and phrasing while it draws on other sources
  too. Code ignores it on an item whose cited facts all come from one source (`citesOneSource` in
  `judgedProblems`; the agent's placement: a source's date fact `S2F0` counts as that source, and
  an item that cites nothing, the title, summary or blurb, can still follow one).
- **The code check is unchanged and stays the hard limit**: a run of 12 words shared with one
  source line, or a quoted span of 4, fails whatever the judge says.
- The fact-check prompt carries a generic Not copying / Copying pair on the same pattern (the
  agent's placement), not the tuberculosis case, which stays the anchor in
  `.context/story-research.md` and a test of the code check.

Rule: the judge flags a source's expression, never a plainly stated fact; the 12-word run stays the
hard line.

Consequences: fewer copying flags, rewrites and drops on sentences that state figures. A sentence
that keeps a source's order while stating only facts now passes the judge, unless it reaches the
code's 12-word run. The standard is the owner's reading of press publishers' right and copyright,
not a legal opinion: **the legal reviewer should see examples of it before it is relied on** (the
tuberculosis anchor, and from the shadow week a sample of kept items that restate a fact close to
their source's words) and may set a stricter line (`.context/ai-transparency.md`, §11).

## Amendment 2026-11-13: headline, summary and blurb checked against all facts

The title, summary and blurb cite nothing, and the fact check judged an item with neither cited
facts nor number hints for copying only. So the three lines readers see first were never checked
for facts: in production a researched title, "Scott Colom becomes Mississippi's first Black
senator", passed although every fact said "the first Black senator since Reconstruction" (Hiram
Revels was the first). The change was set out on 2026-11-13 in the brief that asked for it, with
the rules below; the agent placed those marked.

- **The fact check judges the title, summary and blurb against every fact of the pool**, in the
  same call, no new call (`checkedItems` in `server/src/services/researchChecks.ts` gives them the
  whole pool as evidence, `againstPool`): a claim in them is supported only when some fact states
  it with the same scope. The judge's support verdict on them now counts, as on a cited item.
- **Overstatement is unsupported**: a claim that drops a qualifier its fact gives ("since
  Reconstruction", "nearly", "projected") states more than the fact. The prompt states this rule
  for every item, story paragraphs and bullets included (the agent's placement: scoped to these
  three it would read as leave for the others, and "with the same scope" already meant it there).
- **The pool is shown once**, in `<POOL>` (every fact with its statement, `MEASURES` and `SUPPORT`:
  the sources', our earlier stories' and the date facts), and the three items carry the mark
  `<AGAINST_POOL/>` instead of a copy each (the agent's placement); a recheck that holds none of
  them leaves the block out.
- **Their number hints are computed against the whole pool** (`<NUMBERS_NOT_FOUND>`), as a cited
  item's are against its evidence.
- **A failure is a fact problem on an item the draft cannot do without**: it goes through the
  repair rounds as any failing item and, still failing after them, the run falls back
  (`draft_failed_check`). It is never written again from the kept story, which only a copying
  failure is (ADR-0058).
- **A bullet that cites nothing keeps its rule**: it has no evidence and is judged for support only
  once it carries a number hint. The key quote's handling is unchanged, and the title label, a topic
  of 1-3 words that states no claim, stays outside the checks (the agent's reading).
- The write and repair prompts' citation rules, and the derive prompt, ask for the title, summary
  and blurb to state only what facts state, with their qualifiers (the agent's placement, so that the
  writer aims at the standard the check applies).

Rule: every published line of a researched story is checked against facts, a paragraph or bullet
against the ones it cites, the title, summary and blurb against all of them; a dropped qualifier is
an unsupported claim.

Consequences: a title, summary or blurb that overstates a fact costs a repair round, and the run
when the rounds cannot fix it, so some runs that were kept before now fall back to single-source.
The first fact-check call grows by the pool, some 45 facts or about 4k input tokens (about $0.0005
a call on the small tier), and so does a recheck that holds one of the three; not yet measured
(`eval:research` reports the fact check's input per call). The qualifier rule may raise more
support failures on paragraphs too. The methodology page's "Each paragraph and point is then
checked against the sources it cites" stays true, but does not say that the headline, summary and
blurb are now checked against all facts; that wording is the owner's (`.context/ai-transparency.md`, §3).

## Amendment 2026-11-14: newest information leads; contradicted and old news narrowed

A researched story was written around the original article's main claim even where a later report
showed that the development had moved on: a plan dropped, a figure revised. Such a report could
also make the story `contradicted`, and an article reporting a new step in an event more than 14
days old could be `stale`; the research step rejects both. The coordinating agent proposed on
2026-11-14 that the newest information leads and that both verdicts narrow to match; the owner
decided all three on 2026-11-14. The agent placed the rules marked below.

- **Newest information leads.** Where a source dated after the original article (`S0`), or a fact
  that dates its event after the article's date, shows that the development has since moved on, the
  story is written around that latest state and the earlier claim is context ("First announced as a
  ban on all imports, the plan was narrowed to luxury goods on March 4."). The title, the first
  paragraph, the summary and the blurb state the latest state, never the earlier claim as if it
  still held. It is one block, `LATEST_STATE` in `server/src/prompts/research.ts`, in the write and
  repair prompts; the derive prompt carries its headline part (the agent's placement, so that a
  title, summary or blurb written again from the kept story keeps the latest state). The fact check
  is unchanged: the latest state and the earlier claim are each a claim its cited facts must state.
- **The writer sees each source's publication day** on its `<SOURCE>` (`publishedDay`, `YYYY-MM-DD`
  or `unknown`), and the prompt says what the date is. The date facts (`S2F0`) stay out of the write
  prompt and in the fact check's evidence. A source dated as search gives it
  (`Thu, 12 Nov 2026 08:00:00 GMT`) had no date fact, since `publishedFact` read only an ISO date;
  it has one now (the agent's fix, found while checking what the writer sees).
- **`contradicted` narrows to a disagreement no later report settles**: credible sources disagree
  about the main claim at the same time, one stating the opposite of what another states about the
  same moment, and no later report settles which is right (`<CONTRADICTED>`, and the
  `isContradicted` description in `server/src/schemas/research.ts`). A later report that reverses,
  updates or settles the claim is not a contradiction; the story gives that latest state. The
  verdict, its fact ids and the gate (`decideGate`) are unchanged.
- **Old news narrows to an old event with nothing new since**: the main development first happened
  before the cutoff (14 days before the article's date) and no fact reports a new development
  about it on or after the cutoff (`<OLD_NEWS>`, the `isOld` description). Where one does, the
  story is written around that development, with the earlier event as context, and it is not old
  news; the write prompt's one-development rule names that development (the agent's placement).
  No schema field was added (the agent's choice): `firstHappened` stays the old event's own date,
  so a kept run whose `firstHappened` precedes the cutoff records the rule at work, and stored runs
  parse unchanged. The verdict and the gate are unchanged.

Rule: a researched story states the latest state its sources show; an earlier claim is context,
never the headline; a change over time is never a contradiction, and an old event with a fresh
development is not old news.

Consequences: a story whose development moved on after the article reads differently from the
article that first reported it, its headline possibly the reverse of the original's ("Pakistan
narrows import ban" for "Pakistan bans all imports"); the Sources list still starts with that
article. Later reports are few where the research runs at selection (the search reaches 7 days past
the article's date, never past the run time, and the research step runs on the day's selection);
an editor's run of an older story finds the most. Fewer stories are rejected as contradicted: one
whose claim a later report reversed is now published at its latest state, and only a dispute
between reports of the same time still rejects it; runs stored before keep the verdicts they got.
Fewer stories are rejected as stale too: an article about a fresh step in an older story is
published, written around that step, which the model judges, as it judged the event's date
before. Not yet measured with `eval:research`. The methodology page's "If the research shows that
the story is old news or is contradicted by other reports, we don't publish it" now reads wider
than both rules and says nothing of the latest state; that wording is the owner's
(`.context/ai-transparency.md`, §3 and §11).
