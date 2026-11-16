---
status: approved
type: feature
complexity: complex
---

# Story overviews: the build plan

Approved by Odin on 2026-11-16 ("go for it", after the fifth version of the design). This is the roadmap for the whole feature: what gets built, in which order, behind which gates, and the decisions already taken. Each module gets its own implementation plan when its turn comes; the first one, the evals, is `.plans/2026-11-16_overview-evals.md`.

Design (read it before planning a module): `/mnt/project-files/story-directions/2026-11-16_ebola-lifecycle.md`, with mockups in `/mnt/project-files/story-directions/mockups/` (`story-context`, `thread-v2`, `home-c`) and the pipeline chains in `2026-11-16_pipeline-chains-and-flex.md`.

## Problem

Our stories stand alone. A reader who follows the Ebola outbreak in Congo sees some 40 near-identical "deaths top X" stories with no shared timeline, no tracked numbers and no sense of where things stand, and a one-off story carries none of the context that research already gathers. The fix must keep the relevance bar exactly where it is, run with no person in the loop, and stay modular: each part has a switch and a monthly cap, and the site works with any subset switched on.

## What gets built: seven modules

| # | Module | What readers get | Needs |
|---|---|---|---|
| 1 | Story context | Context boxes, a figures box and code-drawn charts on every story, from its own research plus a second research pass for missing context | — |
| 2 | Overviews and linking | Stories about one development share an overview: timeline, "Where this stands", an "ongoing story" link | — (better with 1) |
| 3 | Tracked figures | Numbers defined once per overview, charted over time, disagreeing counts shown | 2 |
| 4 | Watched primary sources | Overviews stay current between stories (WHO, OCHA, official series) | 2 |
| 5 | Front page and briefing | The new homepage, the weekly "big picture" and "coming up" | 2 (richer with 1, 3) |
| 6 | Below-bar contributions | Numbers and events from assessed articles we don't publish | 2 |
| 7 | Merges | Two overviews that turn out to be one development combine (soft, undoable) | 2 |

## Order and gates

- **Now, alongside the job-groups change (PR #86):** the evals and answer keys (`.plans/2026-11-16_overview-evals.md`), which touch no production code path.
- **After job groups merges:** module 1 as a step of the daily edition chain, right after research. A step is a job in its chain's step list (`server/src/jobs/chainDefinitions.ts`, per the job-groups thread). Job groups gives per-step on/off (a step that's off is skipped, the chain carries on) and per-step cost with model tokens and Tavily credits apart. Module 1's plan adds the two things it lacks, as checks in the chain runner around each step: a monthly dollar cap per step (a capped step behaves as off) and a pause when more than about 20% of a step's items fail checks (with an admin notice).
- **Then:** the database records for overviews, modules 2 and 5, then 3 and 4, then 6 and 7 once real costs and error rates are known.
- **Every module ships switched off** and is switched on only after its evals and the replay meet their bars. Its cost and error rate show in the job overview from its first run.

## Records (shape, to be settled per module plan)

Two kinds, the basis of the safeguards. **Evidence** is what was fetched: a source's URL, its text, the supporting sentence word for word, the source's date. **Judgments** come from a model and are stored with model, prompt version, inputs, confidence, time and status (`unreviewed` / `reviewed` / `demoted`). Judgments never become evidence: a summary is never fed back as a fact.

New records: Fact (module 1), Context box (1), Overview with scope (`single` / `forming` / `ongoing`), status (`open` / `quiet` / `closing` / `closed`) and charter (2), Entry (2, 4, 6), Figure and Figure value (`shown` / `held` / `demoted`) (3), Overview source (`probation` / `active` / `dropped`) (4), Audit and automation log (2+). The monthly cleanup keeps rejected stories that an entry points to, with their embeddings (6).

## Decisions taken (decision stubs)

Each becomes an ADR in `.context/decisions/` when the first code it governs lands.

- **D1 · Stories stay the unit; overviews tie them together.** Threads and contextualized overviews are one object. An overview can start as a single story's context and grow. (Odin, 2026-11-16.)
- **D2 · Cosine proposes, a model confirms.** No story joins an overview by similarity alone; a model must confirm it against the overview's charter, stating the shared cause, place and end. (Odin, 2026-11-16.)
- **D3 · No person in the loop.** Every step is automatic; a person can step in only by switching a step off or setting it to review. (Odin, 2026-11-16.)
- **D4 · Numbers are judged by a fact-check call, never failed by code.** ADR-0057's rule extended to every new step: extraction keeps the supporting sentence word for word and what a figure measures; a fact-check call judges each fact against the passage it came from; code checks only structure (a fact names a fetched source, a citation exists) and passes what else it notices as hints. Where numbers slip through, the fact check's rules get tighter. (Odin, 2026-11-16: code checks are not reliable enough, "50%" against "half of".)
- **D5 · One named source is enough.** A number from one source may appear anywhere, always with its source shown; disagreeing sources are shown side by side, not resolved. Nothing waits for a second source. Joins, charters and figure definitions never rest on a single value, so one bad number cannot reshape an overview. (Odin, 2026-11-16: "A bad context number doesn't ruin a thread.")
- **D6 · The stronger model shapes overviews and reviews them.** Founding, charter, title, figure choice and definitions, closing, merging and every review run on the large tier (gpt-6.1-sol today), with two independent calls that must agree for founding, charter, definitions, closing and merging. Routine steps run on the small tier; each step's eval decides whether it must move up. (Odin, 2026-11-16.)
- **D7 · Automatic corrections only remove or downgrade.** Reviews may detach, demote, narrow, retitle and relabel, never add; a demotion is a flag the next review can undo, and everything built on a demoted item is recomputed.
- **D8 · Every model step has an eval and the replay gates each launch.** Bars per step, tuned on half the developments and reported on the other half (Ebola in the reported half), rerun after every prompt or model change. (Odin, 2026-11-16: "We'll need evals for all of this.")
- **D9 · No direction badges and no images per story.** Direction ("getting worse") was dropped as low value and an embarrassment risk; standardized charts and area colors are allowed, story images are not. (Odin, 2026-11-16.)

## Risks to watch

- **Search credits dominate cost** (about $17 of the $18–33 a month for modules 1–5, with flex): module 1's plan should start with basic depth, 3 searches and a 7-day reuse within an overview, and measure.
- **The fact check's leniency** is now the main defense against wrong numbers; the planted-error eval measures it before module 1 and after every prompt change.
- **Replay hindsight:** searches limited to before each story's date still find pages updated later, so replay numbers flatter module 1 a little.
