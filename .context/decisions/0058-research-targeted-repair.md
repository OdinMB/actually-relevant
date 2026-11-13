---
id: ADR-0058
title: "Researched stories: repair only the items that failed their checks, in up to two rechecked rounds, and write a still-copying title, summary or blurb again from the kept story, instead of rewriting the whole draft once"
status: accepted
date: 2026-11-13
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, architecture]
tags: ["story-research", "fact-check", "prompts", "copying", "repair"]
---

# ADR-0058 · Researched stories: repair only the items that failed their checks, in up to two rechecked rounds, and write a still-copying title, summary or blurb again from the kept story, instead of rewriting the whole draft once

## Context

Story research (`.context/story-research.md`) writes a cited draft from extracted facts, checks
every item in code and with one fact-check call, and until now answered any problem with one
rewrite of the whole draft, checked again in full. An item still failing after it was dropped, or,
for the first story paragraph, the title, the summary or the blurb, made the run fall back to the
single-source story (`draft_failed_check`).

The whole-draft rewrite had two faults. It could break an item that had passed, which then failed
the second check and cost the item or the run. And it gave the writer one chance: an item it did
not fix, often a title, summary or blurb flagged for copying, ended the run although the story
itself was sound. The owner approved targeted repair on 2026-11-13; the agent placed the details
marked below.

## Decision

- **After the first check, only the failing items are rewritten.** An item with no problem, from
  code or judge, is frozen: the merge (`withRepairs`, `researchRepair.ts`) takes the answer for the
  failing labels alone, and an item that passed stays as it was, byte for byte.
- **Each failing item goes to the writer with its own problems** (the judge's reason or the code's
  problem, as recorded), the ids it cites, all the facts, and the story as it stands for context.
  The answer gives a new text and fact ids per failing label, and a new key quote when the key
  quote failed.
- **The rewritten items alone are rechecked**: the code checks and one fact-check call on just those
  items. Each recheck is recorded in `result.checks` with `rechecked`, the labels it checked again;
  each rechecked item's problems become that pass's.
- **Up to two rounds** (`config.research.repairRounds`, no env override). After the last, a
  paragraph or bullet still failing is dropped, an item the draft cannot do without still failing
  ends the run, a key quote still failing is dropped, as before. `failedOn` and the fallback
  categories are unchanged.
- **A title, summary or blurb still failing on copying alone is written again once from the kept
  story paragraphs** (the `derive` step), never from the sources' words, then checked once more; one
  failing on a fact is never written again, and still failing, the run falls back.
- **Repair calls count against the run's ceiling and the month's cap.** A call the budget skips
  ends the repair, and the drops and fallbacks apply to what the last check saw.

The agent's placements within the owner's decision:

- The repair call keeps the step name `rewrite`, so stored runs, their costs and the eval's reports
  read on; the derived fields are a new step, `derive` (medium tier).
- A round whose answer changes nothing ends the rounds, since a second identical answer would cost
  a call for nothing.
- A recheck the budget skips discards that round's repaired text: an unchecked rewrite is never
  kept. A repair or derive answer that fails to parse ends the run as `technical`, as the rewrite's
  did.
- The derived fields are written only when nothing else already ends the run, so a run that falls
  back anyway spends no call on them.
- The recheck's fact-check prompt holds the rewritten items alone, without the frozen story: each
  item is judged against its own evidence, as in the first pass.

Rule: a repair never touches an item that passed; only a rechecked item's text reaches readers.

## Consequences

- A passing paragraph, bullet, title, summary, blurb or key quote can no longer be broken by a
  repair, and an item failing after one round gets a second chance with its new problems.
- A title, summary or blurb flagged for copying no longer ends a run whose story paragraphs hold:
  it is written again from them.
- Worst case per run: two repair rounds and the derived fields, three medium-tier calls and three
  fact checks, against one rewrite and one fact check before. A repair writes only the failing
  items, so each call's output is smaller than a whole draft's; `STEP_OUTPUT_TOKENS.rewrite` still
  reserves for a whole draft until `eval:research` has measured it, and the eval's per-story budget
  counts one repair round.
- Runs stored before this change keep their one or two passes, with no `rechecked`, and read and
  display as before; `problems` is the last check of each item.
- The methodology page says a failing paragraph or point "is rewritten once"; that understates the
  rounds and is the owner's wording to change (`.context/ai-transparency.md`, §11).

## Alternatives considered

- **Keep the whole-draft rewrite, with more rounds.** Each round could still break items that had
  passed, and each would cost a full draft's output.
- **Rewrite each failing item in its own call.** More calls for the same work; one call per round
  sees all the failing items and keeps them consistent with each other.
- **Recheck the whole draft after each round.** Rejudging frozen items costs input and can only
  turn a passed item into a failed one by the judge's own variance, not by any change.
- **Write a failing title, summary or blurb again from the facts.** It would put the sources'
  wording back in front of the writer for the very fields that copied it; the kept story paragraphs
  have already passed the copying checks.
