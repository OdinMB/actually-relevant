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
