---
id: ADR-0080
title: "A research fact is its statement, and its figure stays only when a model finds it in the source"
status: accepted
date: 2026-11-24
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["story-context", "research-passes"]
---

# ADR-0080 · A research fact is its statement, and its figure stays only when a model finds it in the source

**The owner's rules, built by an AI.** The plan `.plans/completed/2026-11-24_research-fact-figures.md`
records two rules as Odin's, chosen on 2026-11-24 and passed to the implementing agent by the main
session he gave them in: a fact is shown as its statement with its fields as a labeled record beside
it, the statement governing; and whether a figure is given by its source is a model's judgment, never
a code check, a figure not given being removed while the fact stays. The rendering format, the
wiring as a step of its own, the prompt texts, the reading of filler fields and how a failed call is
handled are claude-code's: the plan first had a failed figure call remove its figures, and the main
session changed that before the implementation to the rule below. Accepted with the commit on
2026-11-24. The measurements after the change were not yet run then.

## Context

Story context and the research pass showed a fact with a figure and a counted thing to every writer
and every check from its structured fields alone (`renderFact`: "Area burned in Indonesia: about 2.88
million hectares, as of 2026, according to KLHK (estimate)"). The fact's statement, usually accurate,
was thrown away. The fields lost what the statement kept (a proposal became a share in force, "11
countries, including five named" became 5), built an "as of" from a date the sentence gives for
something else, credited a body where the source credits no one, and held figures the source never
gives ("1 series of actions"). The model also wrote "none" and "unknown" into fields it should have
left empty, which rendered as "according to none".

Measured on 2026-11-24: of 22 overview lines a source-reading judge rejected, 12 faithfully repeated
such a fact, 10 of them misleading. On the judged half's first-pass pools, a strong judge reading
each fact as rendered against its source's words found 57.4% of the facts with a figure and 75.5% of
those without faithful; of 110 changed facts, 50 had lost or altered a period, 20 a credit, 15 a
figure and 15 a scope.

ADR-0057's amendment of 2026-11-16 had the fact check judge "each fact as `renderFact` renders its
structured fields", so in a research pass the article was written from statements no check ever
read. The same amendment recorded the owner's ruling that code checks of numbers are not reliable
("50%" against "half of"). The facts are taken from published news reports; an editor's "Gather
context" was the one live path, the nightly context step, research passes and overviews being
switched off.

## Decision

We show a fact to every reader of it (the gap list, the fact check, the card write, the box check's
evidence, the overview stands and the eval's judges) as its statement, then its fields as a labeled
record in square brackets, only the fields that are set. The record adds what the statement leaves
out; where the two contradict, the statement governs, for a date, a period and a credit as for a
figure, and every prompt that shows facts says so. The fact check judges the statement and each
field of the record against the source's words. This replaces "as `renderFact` renders its structured
fields" in ADR-0057's amendment of 2026-11-16.

Before the fact check, a model on the small tier judges, for each fact that carries a figure,
whether its source's words give that number for the thing it is said to count: given, computed,
given for another thing, or not stated. Code only applies the answer: a figure answered anything but
given, or left out of the answer, is removed and recorded, and the fact stays with its statement,
place, as-of date and credit and is fact-checked without the figure. No code check of figures
replaces or precedes that judgment. A figure-check call that gives no answer is a failed step, as a
failed fact-check call is: the context run fails as technical and the pass gets its second attempt,
and no figure is removed. A text field that holds only a filler reads as empty, when the fields are
stored and when a stored fact is shown.

Not covered: tiles and charts still read the fields; facts stored before the change keep their
figures, judged by no one; no stored shape changes and nothing is migrated.

## Consequences

- The statements an article and a card are written from are now checked, and a figure its source
  does not give no longer reaches a tile or a chart.
- One or two more small-tier calls a story (about $0.002 by a desk estimate), metered in a pass.
- A null value on a fact stored from now on can mean that a figure was recorded and removed; the
  run's record says which, and the admin lists each with the reason.
- Worse: the fact check now judges every field of the record as a claim, so some facts it passed
  are rejected and a run may write fewer cards.
- Worse: a failed figure call fails a whole context run or pass, a failure that did not exist.
- Worse: every fact now shows a statement to the card and stands writers, so the 12-word copying
  check can drop more of their sentences.
- Worse: the figure check reads one sentence or passage, so a figure the article gives elsewhere is
  removed. A tile is lost; no wrong number is shown.
- Worse: every prompt that shows a fact changed, so every cached eval call holding a rendered fact
  misses, and the catch rates on context and pool facts, the stands' "latest value stated" and the
  stands bars tuned on 2026-11-24 are not comparable with runs before the change. The stands prompt
  was tuned on the old rendering and has to be measured again.
- Revisit when the measurement after the change shows the faithful share of facts with a figure no
  higher than before, when the figure check's false removals exceed the bar the owner sets, or when
  failed figure calls fail a noticeable share of runs.

## Alternatives considered

- **The statement instead of the fields** — the checks would no longer judge what tiles and charts
  draw from.
- **Two XML elements per fact, statement and fields** — five prompt builders and the eval's helpers
  would each need a new shape; one text with a labeled bracket fits them all.
- **Prose details as before ("…, according to X") beside the statement** — prose reads as a claim of
  the fact, a label as a record.
- **A code check that the figure's digits stand in the source** — ruled out by the owner: code
  cannot tell "half" from 50%, or a number given for another thing from one given for this.
- **A second call under the fact-check step's name** — a step is the unit of tier, prompt version,
  cost estimate, call record and eval arm, and two schemas under one name break each of them.
- **A failed figure call removes its figures** — the plan's first rule ("no answer, no figure"). A
  pool fact is checked once, so one timeout would have cost up to 25 figures for good, where the same
  timeout on the fact check only fails the pass and is tried again.
- **Tighten the structure prompt and keep showing the fields** — the fields would still be all any
  check and writer saw, and the fact check would still not read the statements.
