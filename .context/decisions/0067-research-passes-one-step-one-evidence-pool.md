---
id: ADR-0067
title: "Research passes: one repeatable research step over one evidence pool per story, with one switch, one budget and one spending line; the old run tables kept as read-only history"
status: accepted
date: 2026-11-18
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, data, cost, ai-risk]
tags: ["research-passes", "story-research", "story-context", "records", "database", "scheduler"]
---

# ADR-0067 · Research passes: one repeatable research step over one evidence pool per story, with one switch, one budget and one spending line; the old run tables kept as read-only history

## Context

Story research (`.context/story-research.md`, ADR-0055) and story context (`.context/story-context.md`,
ADR-0061) are two steps over two sets of records: research's runs are jsonb rows that write nothing
until applied, and context's runs keep their own per-run copies of facts and boxes and re-check
research's facts. They have two budgets, two switches, two admin buttons and two run views, and
neither can update a published story. The owner's direction (2026-11-17): "research should be one
step to add context, and which can be repeated to get more and more context, always adding sources
(if any are new), updating context boxes, dropping facts, etc." Overviews (module 2 of
`.plans/2026-11-16_story-overviews.md`) need a story's evidence in one place with its provenance.
Plan: `.plans/2026-11-17_research-passes.md`, approved by the owner on 2026-11-17 (one step with one
budget; the article kept unless something is wrong or substantially different; Updates that keep the
earlier text). This entry lands with the plan's phase 1 (records) and phase 2 (the first pass); the
later pass, its versions and Updates are ADR-0068's, with phase 3.

## Decision

- **One step, `research_pass`**, replaces `research_stories` and `build_story_context`: one switch (its
  job flag), one budget (research's monthly cap, `RESEARCH_MONTHLY_CAP_USD`, counting every pass), one
  spending line (the job's `job_month_spend` row, editors' passes included) and, once wired, one admin
  button. A pass reserves its ceiling at start under research's advisory lock: $0.40 for a first pass,
  $0.25 for a later one, about twice their targets (`config.research.pass`). One meter
  (`createRunMeter`) meters every call and search of the pass, the card steps' included.
- **The evidence is rows per story, not jsonb per run**: `research_passes`, `evidence_searches`,
  `evidence_sources`, `pool_facts`, `article_versions` and `pass_boxes`. Every row carries the pass
  that wrote it, its provenance. What was fetched is kept word for word and is never a page's text
  (the supporting sentence, a passage of at most 600 characters, quotes); every model answer carries
  its model and prompt version. Nothing the model wrote is fed back as evidence.
- **A fact lives once per story and is checked once.** Its identity is `poolFactKey` (its page, its
  supporting sentence and its statement, normalized); a pass checks only `unjudged` facts and never
  re-judges one with a verdict. **A demotion is a status** (`demoted`, with its pass, its reason and
  the facts that contradict it), never a deletion, so a later pass may undo it. Our own earlier
  stories' facts feed the article writer, never the cards or a figure.
- **Articles are versioned; the story's columns stay the live copy** every reader reads. At most one
  `current` version per story, by the partial unique index `article_versions_one_current`, which Prisma
  cannot model and `check:migrations` guards against a drop. No column is added to `stories`.
- **The old tables stay as read-only history.** `story_research_runs`, `story_context_runs`,
  `context_facts` and `context_boxes` get no new rows once the step is on; no migration copies, drops
  or rewrites them. A story's legacy runs become its pool once, at its first pass, inside the pass's
  claim transaction (`importLegacyPool`): sources and facts from its newest research run with facts,
  verdicts taken over from a context run by `factKey`, both runs' queries as searches, and version 1
  (`legacy`) from the story's columns when it carries researched text.
- **One switch at a time.** Enabling `research_pass` switches the two old jobs off in the same write,
  and enabling either old job is refused while it is on; switching back is the rollback. The swap is a
  new job, never a new pipeline behind `research_stories`, which is live. **Until the pass's lifecycle
  is wired, enabling `research_pass` is refused outright** (`PASS_NOT_WIRED`), and its handler does
  nothing.
- **Cards never fail a pass**, and nothing about cards holds the edition: a card failure or budget
  stop completes the pass with its article. The chain's publish gate holds only what research's holds
  today (`awaitingPass`, at most 120 minutes from selection).

## Amends

These take effect when the owner switches `research_pass` on, not before:

- **ADR-0055:** new work is a `research_passes` row, not a `story_research_runs` row; the cap's month
  sum is both tables' rows of the month, which never counts a run twice because the old table gets no
  new rows after the switch. A pass writes its own rows and, through the fenced apply research's step
  uses (`putResearch`), the story's columns; still no research field on `stories`.
- **ADR-0061:** a story's facts and cards are kept per story, not copied per run (`reused_from_id` only
  for facts offered from linked earlier stories); the context step is merged into the pass; and, on
  the plan's recommendation (For Odin 4, open below), its after-publish part is retired.

## Open owner decisions

Recorded here when answered; until then the work proceeds on the plan's recommendations, all of which
take effect only at the switch (plan, "For Odin" 1, 4 and 7):

- **The monthly cap:** recommended $60 when the step is switched on (today $30, research only).
- **The after-publish catch-up:** recommended retired; a story published without a pass gets one when
  an editor clicks "Research again".
- **The methodology paragraph:** the plan's replacement text goes into "Researched Stories" in the
  change that switches the step on.

## Consequences

- Deploying phases 1 to 5 changes nothing readers or the nightly chain see: six new, empty tables, a
  disabled job row with a $20 spending warning level, and a "Research Passes" row on the Jobs and
  Spending pages. The old steps keep running as before.
- A first pass costs about two to four times a research run today (target $0.12–0.20), so at $30 the
  cap would run out in a busy month; the first night after the switch also imports every story's
  legacy runs, which costs nothing but adds a fact check of imported research facts to their passes.
- The import takes the newest research run, since which run's version was applied is not recorded;
  the pool can then differ from the facts the live article cites, which costs at most a redundant fact.
- Module 2 gets rows to point at, demote and reuse; `fact_judgments` would join when its reviews
  re-judge facts.
- Retirement (the plan's phase 7) removes the old jobs and their code; the legacy read views and the
  `context_boxes` fallback stay.

## Alternatives considered

- **Extending `story_context_runs`, `context_facts` and `context_boxes` into the pool:** their facts are
  copied per run and cite run-level refs, so the old rows would carry the wrong meaning under a
  per-story pool.
- **Copying all legacy runs into the new tables in a migration:** research's results are deep jsonb,
  and the old jobs keep writing until the switch, so a migration-time copy would miss rows.
- **One jsonb pool per story:** nothing for module 2 to query or demote by row.
- **Swapping the pipeline behind `research_stories` and keeping its row:** that job is live in
  production, so the merged step would ship switched on, before its eval.

## Amendment 2026-11-18: wired, and kept off by its eval gate

The plan's phase 4 wires the pass (claim, reservation, apply, the job in the daily edition between
`build_story_context` and `publish_stories`, `awaitingPass`, the one-switch rule, editors' passes and
the public `updates` field). `PASS_NOT_WIRED` goes, and **enabling `research_pass` stays refused
outright until its evals meet their bars** (D8): the refusal is now the eval gate, `PASS_EVAL_GATE`
(`services/researchPassGate.ts`), a code constant rather than a setting, which the change that switches
the step on (plan phase 6) sets to null; after it, research's own switch (the key, priced models). The
gate also stops the handler, the publish gate and every editor's start, and a "Run now" of the
disabled job researches nothing, so the old steps and this one never both run on a night. The cap's
month sums both tables' rows from now on (`monthToDateUsd`), which changes nothing while no pass
runs. Everything else stands as written.
