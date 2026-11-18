# Ongoing-story overviews (the `link_overviews` step, built and switched off)

An **overview** follows one ongoing development (an outbreak, a war, a negotiation, a rule-making) across our stories: a charter saying what belongs, a title, and a timeline of entries, one per story. The **link step** files each newly published story under the development it reports on, or starts a development when two stories report the same one. Plan: `.plans/2026-11-18_overviews-linking.md`; decision: ADR-0070.

**What is built and what it does today.** Phases 1 and 2 of the plan: the records, the answer keys' version 2 and the halves, and linking (candidates, the link confirmation, founding, roles), the `link_overviews` job after publishing, the decisions log, and the `link`, `found` and `role` evals in an in-memory sandbox. **Nothing runs in production:** the job row is seeded disabled, enabling it is refused while its eval gate is closed and while research passes' is, and nothing reads the tables yet. Phases 3 to 6 (stands, the status machine and reviews; the admin views; the public page and story field; the switch) are still to come.

## Records

Migration `20261118203742_overviews`, additive. Only `services/overviewLifecycle.ts` writes these four tables (`test/overviewWriters.test.ts` fails on a Prisma write or raw INSERT, UPDATE or DELETE anywhere else outside `scripts/` and `test/`).

- **`overviews`**: title, `slug` (null until the overview is public, phase 5), `issue_id` (the founding story's issue), `scope` (`single`, `forming`, `ongoing`; a founding makes `forming`), `status` (`open`, `quiet`, `closing`, `closed`), `charter` (`{ in, out[], endEvent }`, with the model and prompt version that wrote it), `frozen`, `hidden`, `founded_at` (the earlier founding story's publication date) and `last_entry_at` (the newest entry's), so both are in the development's time, not the run's; closing and review columns for phase 3.
- **`overview_entries`**: one per story and overview, `kind` `story` (a CHECK requires `story_id` for it), `role` (`turning_point`, `routine`) and `role_kind` (a turning point's kind: setback, response, spread, decision, escalation, deescalation, money, science, people, milestone), `status` (`active`, `detached`), `judgment`, who joined it, `locked` (an editor's detach: automation never links the story there again), `shared` (the judgment record: `{ cause, place, end }`, each `{ story, other }` quoting this entry's story and the other side), the confidence, model and prompt version, and the decision that made it. **A story has at most one active entry** (partial unique index `overview_entries_one_active`).
- **`overview_stands`**: the versions of "Where this stands", numbered per overview; **one current at most** (`overview_stands_one_current`). Phase 3 writes them.
- **`overview_decisions`**: every automated or editor decision (`kind` `link`, `found`, `role`, `stands`, `status`, `close`, `review`, the editor's actions, `undo`), with its outcome, inputs, the model's answer, model, prompt version, confidence, cost and actor; `undone_at` for an undone one.

`check:migrations` fails on a drop of either partial index, as for `article_versions_one_current` (`scripts/check-migrations/rules.ts`). The migration also inserts the `link_overviews` job row (disabled) and its $10 spending warning level; `seed-jobs.ts` upserts the same.

## How a story is linked

**Owed stories** (`services/overviewQueue.ts`): published, published within `overviews.backfillDays` (183) of now, with no active entry and no live settling `link` decision. `joined`, `founded`, `none` and `rejected` settle a story; `held` (its overview is frozen), `conflict` and `failed` leave it owed for the next run. A run takes the **backlog** (owed stories older than `nightHours`, 24) first, at most `backfillPerRun` (300), then the **night's** owed stories, at most `perRun` (60), each oldest first by publication date, so a 6-month backfill takes about 6 nights and no story is linked before an older one it may belong with.

**Every window counts from the story's own date (`asOf` = its `datePublished`)**, in production as in the replay. For one story (`services/overviewLink.ts`, `linkStory`, pure over injected reads and calls):

1. **Candidates** (`services/overviewCandidates.ts`), in two parts so the replay runs the same code:
   - `nearestPublished`, SELECT only through the client given: published stories within `maxDistance` (0.45) by exact cosine distance (dedup's `MATERIALIZED` pattern, `.context/embeddings.md`), published on or before `asOf` and within `memberLookbackDays` (180) before it, nearest `neighbourLimit` (40); plus, whatever their distance, the earlier stories its research linked (its pool's `earlier` sources, else its newest completed legacy run's `earlier`) and its cluster's other published members.
   - `groupCandidates`, pure over a membership map (production's from `membershipsOf`, the sandbox's in memory): the overviews of neighbours that are active members, except one closed at its end event (a `faded` one stays, and reopens on a join), one whose newest entry is older than the lookback, and one an editor detached the story from; ranked by their nearest member, at most `candidateOverviews` (5). A frozen overview stays a candidate. **Founding partners:** neighbours with no active entry, within the distance and the 30 days before the story (`foundingWindowDays`), at most `foundingCandidates` (3).
   - No candidate: no call, and the story is settled `none`.
2. **Link confirmation** (`overview-link`, small tier, cached): the story (title, label, summary, day, up to 10 usable pool facts of pages as context), each candidate overview (title, charter, its 5 newest published entries) as `O1`…, each founding partner as `F1`…. Per candidate: `belongs` (`yes`, `no`, `unsure`), the shared cause, place and end, each quoting both sides, the end-event flag, the stated confidence; for the story its role and kind.
3. **Acceptance** (`acceptLink`, code): a `yes` counts only with all three fields filled on both sides and each quote found in its side's text (`lib/quoteMatch.ts`, the answer keys' normalization): the story's title, label or summary; the overview's title or charter; the partner's title, label or summary. `unsure` is no. **The nearest passing overview wins** (a story joins one at most); if it is frozen the story is `held`. A founding partner is considered only when no overview passed. A refused yes with nothing else makes the story `rejected`; otherwise it is `none`.
4. **Founding** (two large-tier calls that must agree): `overview-found` drafts the charter (IN, OUT, an end event, which must be named) and the title from the two stories, the earlier as A; `overview-found-check` sees only the charter and each story and judges whether each fits and whether the end event is concrete. A draft with no end event, title or IN is `refused` without the check; disagreement founds nothing. Either way the attempt is a `found` decision and the story stays alone (`none`); a call that gave nothing leaves it `failed`.

**Writes are ordered** (`linkInOrder`): link calls `concurrency` (3) at once, writes one story at a time in the run's order through `applyLink`, which in one transaction re-reads the memberships of the story and of the partners it was shown. A story that has an active entry or a settling decision by then (it was taken as a founding partner) is skipped. **A result whose partner has joined or founded an overview since is stale:** it is asked again once after the others, with fresh candidates, so two stories of one night proposing the same partner found one overview and the second joins it; stale again, it is stored as a `conflict`. A write the one-active-entry index refuses (an editor's attach at the same moment) is rolled back and logged as a `conflict`. Each outcome is the story's `link` decision; a founding also writes the overview (`forming`, open), both entries, its `found` decision and the partner's `link` decision. A join adds the entry, moves `last_entry_at`, and opens a quiet overview or reopens a faded one. **A join never changes a charter or a title.**

## The job

`link_overviews` (`jobs/linkOverviews.ts`, "Link Overviews") is the last step of `daily_edition_chain`, after `publish_stories`; it is in `GOES_ON_PAST_FAILURE`, so a failed linking night leaves its own Error and failure notice, the chain run still succeeds and story context's after-publish part runs. It is in `MODEL_JOBS` (Flex) and `RESUMABLE_JOBS` (a story is settled by its decision, each written in one transaction). Before each write it re-reads the switch and stops once it is off; the stories left stay owed. A story whose read or write throws is `failed` and the run goes on. Items for the failure share: checked = joins proposed (yes answers), failed = yeses code refused; the failed-stories notice fires when more than the failure share of at least `failedStoriesMin` (5) stories failed. Summary: "Linked 9 stories: 4 joined, 1 founded, 4 alone", with held, left and failed counts after it and "; backfill 300 of 1,612" while a backlog is owed. Phase 3 adds the status machine, reviews and stands to the same run.

## How the switch stays off

Four layers, as for the research pass: **the eval gate** `OVERVIEW_EVAL_GATE` (`services/overviewGate.ts`, a code constant a test can mock and nothing at run time can change) refuses enabling (`ENABLE_CHECKS`) while set, and **while research passes' gate `PASS_EVAL_GATE` is closed**; **the order of switches**: enabling is refused while `research_pass` is disabled (`jobEnableConflict`); **the disabled row**; **the handler** does nothing unless both gates are open and the job is enabled ("Run now" on the disabled job does nothing). The owner opens the gate in its own change once the replay on the judged half meets the bars (plan phase 6).

## Evals

`eval:overviews --steps link,found,role` (`.context/model-eval.md`, "Overview evals"): one replay of a half's answer keys (entries and near misses, `developmentHalves.ts`, Ebola judged) in date order through production's `linkInOrder` against the in-memory sandbox (`scripts/eval/overviews/overviewSandbox.ts`, the lifecycle's rules), with production's neighbours read-only as of each story's date and kept to the replayed stories. Bars: joins right ≥97% and must entries found ≥85% (`link`); no wrong founding and the key's end event for every development, by the strong judge (`found`); roles agreeing ≥85% (`role`).

## Files

| File | Role |
|---|---|
| `services/overviewTypes.ts` | The shared in-memory shapes and fixed lists |
| `services/overviewCandidates.ts` | `nearestPublished`, `membershipsOf` (SELECT only), `groupCandidates` (pure) |
| `services/overviewInput.ts` | `linkStories`, `candidateOverviews` (SELECT only): what the prompts read |
| `services/overviewLink.ts` | `linkStory`, `acceptLink`, `acceptFounding`, `isStale`, `linkInOrder` (pure) |
| `services/overviewLifecycle.ts` | `applyLink`: the only writer of the four tables |
| `services/overviewQueue.ts` | The switch (`overviewSwitchRefusal`, `overviewPassConflict`, `overviewStepOn`) and the owed stories |
| `services/overviewGate.ts` | `OVERVIEW_EVAL_GATE` |
| `prompts/overviews.ts`, `schemas/overviews.ts` | The link, found and found-check prompts and their schemas, versioned (`OVERVIEW_PROMPT_VERSIONS`) |
| `jobs/linkOverviews.ts` | The job: production's deps, the run, the summary |
| `config.ts` `overviews` | The constants above (code constants: the evals tune them) and the step tiers |
