---
plan-id: 2026-11-22_linking-eval-background-and-labels
title: Linking eval - neighbouring developments as background in the judged replay, and three answer-key labels
status: implemented
created: 2026-11-22
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [ai-risk]
decisions:
  - ref: .context/decisions/0073-judged-linking-replay-background.md
type: feature
complexity: complex
---

# Linking eval: background developments in the judged replay, and three key labels

Archived on 2026-11-22.

Written by an AI planner on 2026-11-22 on branch `claude/project-thread-egeer5` (at 7ddb97d), from the owner's request of the same day. It was revised the same day after three plan reviews (simplicity, architecture, a cold read).

**Who decided what.** The owner asked for the four things: background stories in the judged replay, labels for the two foundings, the PABS end event relaxed, and `--concurrency 1` for paid linking runs. Every choice of *how* is the planner's, recorded as ADR-0073 and in the prose below.

**The parallel plan.** `.plans/2026-11-22_overviews-no-end-event-closing.md` drops formal closing. This plan stays off its ground; "Shared files" lists what both touch. That plan holds ADR-0072, so this one reserves ADR-0073.

## Problem

The judged linking replay (`link.ts`) holds only the five judged keys' entries and near misses. The Iran war and Hormuz (tune half) appear in it only through their Lebanon look-alikes. In two of three paid runs (`DOCS/2026-11-19_linking-eval/…-half-judge-repeat-3.md`), those look-alikes founded a "US–Israeli campaign against Iran" overview. That overview counted as Lebanon's, its ten Iran-war stories as wrong Lebanon joins, and joins right came out at 89.8%. In production the Iran war would have had its own overview from its own stories.

Two smaller problems in the same run:

- **Two foundings count as wrong only because no key covers them.** Each is a real separate development: the UN pandemic declaration, and the US plan to dismantle the Ocean Observatories Initiative (OOI).
- **Two PABS foundings were judged wrong end events.** They named adoption of the annex alone, and the key's end event also allows abandonment of the talks.

## Approach

### 1. Background stories (ADR-0073)

**The rule, for `--half judge` only.** Background keys are the keys in `others` whose own base entries share a slug with `replaySlugs(keys)`. Each adds its base entries (must and optional) that the replay does not already hold. Its near misses and centers are left out.

- **Judged runs only.** The problem is the judged replay's. A tune run never takes judged stories in through background. This holds even for the label keys below, whose entries are judged-half stories.
- **The other key's entries, not its near misses, decide.** A key whose near miss happens to be a judged story has none of its own stories in the replay. Adding its entries would recreate the look-alike problem one step out. For the same reason a background key's own near misses are not replayed.
- **One hop only.** Iran and Hormuz each share entries with Lebanon's replay. Going further would pull in developments unrelated to the judged half.

The new pure function `backgroundOf(keys, others): { keys: AnswerKey[]; slugs: string[] }` sits in `link.ts`, beside `replaySlugs`, since both decide the replay's stories. `runLinkStep` calls it only when `half` is `judge`. It loads the judged and background slugs together, sorts them by date as today, and keeps neighbours to all of them. A judged `--limit N` takes the first N of the union. Smoke runs use the tuned half, so this has no effect on them.

**One reading of the keys, in one helper.** "What an overview stands for" and "how a member is scored" are now used by the scorer, the diagnostics and the whole-step replay. One pure builder in `linkScore.ts`, beside `keyIndex`, owns both, so the three can't drift: `linkKeys(keys, others)`. It returns:

- **`entry`, `nearMiss`:** the judged index (`keyIndex(keys)`), as today.
- **`all`:** the entry index over `[...keys, ...others]`.
- **`judged(slug)`:** whether a story is a judged story, meaning an entry (center entries included) or a near miss in the judged index. That is the set `replaySlugs` gives, built here without importing `link.ts`.
- **`standsFor(members)`:** `developmentOf(members, all)`, the key of *either* half whose must entries the overview mostly holds.
  - Without this, an overview of ten Iran stories and two Lebanon entries would still stand for Lebanon. The ten background stories would then count as wrong Lebanon joins: today's failure, which background alone does not cure.
  - Read this way, that overview stands for the Iran war, and the two Lebanon entries in it are the wrong joins.
- **`verdict(slug, dev)`:** `'right' | 'wrong' | 'ignored' | null`, where null means not scored. It encodes the join rules:
  - **In an overview standing for a judged key D:**
    - a must entry of D (in `all`) is right;
    - an optional entry of D is ignored, as optional joins always are;
    - every other member is wrong: a background story, a near miss, or another key's entry, its center entries included. The keys list every story that belongs (`entries`, `keySchema.ts`), so a story that is not D's entry does not belong to D. The owner's "an entry of that key is right" is read as a must entry, since the bars ignore optional joins.
  - **In any other overview:** only a judged key's must entry is scored. It is right where the overview's key holds it as must too (the two-key rule of 495a8663), ignored where that key holds it as optional, and wrong otherwise. Everything else, background stories' own misses included, counts toward no bar.

**Behaviour changes for stories already in the replay:**

- **Cross-key joins.** A judged near miss or optional entry of key A, or a center entry of A, that lands in judged key B's overview now counts as a wrong join. Until now it went uncounted. One rule for every member is no larger than a background-only branch and follows from the same premise. Every case in today's `linkScore.test.ts` keeps its asserted values (checked by two reviewers).
- **What an overview stands for.** An overview made mostly of another key's must entries now stands for that key. `linkDiagnostics.test.ts:153` changes: o3 now stands for `strait`.

**Found, role and foundings:**

- **Found and role** count the judged keys' must entries only, as today. An entry counts as found in an overview whose key holds it as must, a key of either half included, and its role is judged against that key.
- **The founding bar** checks a founding only when one of its two stories is `judged`. A founding from two background stories alone is never wrong.
- **`foundings`** stays the count of every overview, matching the diagnostics' charter list.
- **An overview founded from background stories that comes to stand for a judged key** is that key's overview for the end-event judge, as today.

**What the judged result can claim, and what it can't.** It can claim this: the keys under the bars are the judged half's, no prompt was tuned on them, and they now replay among the neighbours they had in production. It can't claim three things:

1. The background stories are tune-half stories, and their own behaviour is not held-out evidence. Tuning keeps them in their own overviews, which also keeps them out of judged ones, so joins right may read a little high.
2. Some judged stories were seen in tuning already. A Lebanon near miss that is an Iran-war entry is replayed in tune runs too. That was true before this plan.
3. The neighbourhood is one hop, while production holds every story.

`.context/model-eval.md` says all three, with no count that could go stale.

**Alternatives weighed:**

- **Score background without changing `developmentOf`.** Rejected: background-dominated overviews would still be read as judged developments.
- **Background in tune runs too.** Rejected: it would carry judged stories into tuning.
- **Hard-code Iran and Hormuz.** Rejected: the request asks for a general rule.
- **Take every key outside the half.** Rejected: it adds unrelated developments, at a cost.
- **Copy the rule into each of the three readers.** Rejected: there are three call sites today, and diagnostics would drift; the first draft of this plan already missed the charter counts.

### 2. Labels

**Two label keys, in neither half.** `developmentHalves.ts` gets a third committed list, `LABEL_DEVELOPMENTS`. Its keys are never tuned on, replayed as a half, or scored. They only say what a story is: for the founding bar, for `standsFor`, and for the background rule.

- **No half.** `developmentHalf` returns null for them, so `keysOfHalf` puts them in `others` for every half. `keyDraft`, `passPool`, `review`, `stands` and `recenter` all filter by half and leave them alone.
- **`update` is the exception.** It reads every key's must entries (`update.ts:108`, `updateSlugs`). It would gain four stories from another gate's eval, so it takes only keys listed in a half.
- **The list's purpose.** `developmentHalves.test.ts` can then still tell a deliberate key from a forgotten one.

The two keys:

- **`un-pandemic-declaration-2026`:** the UN General Assembly's political declaration on pandemic prevention, preparedness and response.
  - Entries: `us-blocks-un-pledge-on-future-outbreak-response` (2026-09-29, must, turning point, setback) and `un-members-renew-pledges-to-stop-future-outbreaks` (2026-10-13, must, turning point, decision).
  - End event: "the General Assembly adopts the declaration".
  - OUT: the PABS annex talks.
- **`us-ocean-observatories-cuts-2026`:** the US plan to defund and dismantle the OOI.
  - Entries: `trump-plan-would-cut-key-sea-data-raise-forecast-errors` (2026-06-06, must, turning point, setback) and `us-cuts-threaten-disaster-warnings-ahead-of-el-nino` (2026-06-24, must, routine).
  - End event: null.
  - OUT: the 2026–27 El Niño itself.

Both keys share this shape:

- **Fields.** `schemaVersion: 1`, `"closed": null`, `figures: []`, no values, statuses or responses, and `nearMisses: []`, so they need no quote.
- **`notes`.** The notes say they were drafted by an AI session from the titles and the PABS and El Niño keys' lines; that they list only the stories other keys name; and, for the UN key, that the 13 October story reports the adoption. `closed` is left null because nothing reads a label key's end, and the closing plan deletes the field.
- **The stories stay where they are** in PABS and El Niño. Overlap across keys is allowed.

Why this mechanism:

- **Label keys** fit change 1: a founding from either pair becomes right over every key, and background adds no story, since all four are already in the judged replay.
- **The tune half was rejected:** tuning would replay these judged near misses.
- **The judged half was rejected:** it would add two-story developments to the gate's bars.
- **A per-story label field was rejected:** it would be a second way of saying which development a story is.

**The coral pair stays wrong.** `warming-linked-to-stronger-pacific-climate-swings` and `human-warming-supercharges-pacific-climate-swings` are one study reported twice.

**PABS end event.** `charter.endEvent` in `keys/pandemic-agreement-pabs.json` becomes:

> The World Health Assembly adopts the PABS annex, so the Pandemic Agreement can open for signature. Our stories put the target first at the May 2026 Assembly, then at May 2027.

The key's `notes` gain a line: formal abandonment of the talks would also end the development. The end event names adoption alone because the end-event judge reads any alternative as a different event.

**Why the key text stays a plain event:**

- **Other readers.** The charter text is read by more than the linking judge:
  - the `review` eval sends it to production's review prompt as the overview's END_EVENT (`review.ts:86`);
  - `recenter` sends it to the judge as `expectedEndEvent` (`recenter.ts:241`);
  - `keyDraft` sends it to the drafter (`keyDraft.ts:77`).
  
  An instruction aimed at the judge must not leak into them.
- **What this gives up.** A founding naming abandonment alone would be judged wrong. No founding has named it.
- **Cost.** PABS's cached calls in `link` (end-event judge), `review` and `recenter` (judge) change: a handful of calls, a few cents.
- **Why not the judge prompt.** A general "one of the key's endings is enough" rule in `buildEndEventJudgePrompt` would also change Colorado's and the autonomous-weapons talks' verdicts. It is left as follow-up.

**Drafting and checking the keys.**

- **Drafting.** The implementer writes both files from the slugs, dates and titles in the PABS and El Niño keys, which already passed `--steps keys`. It reads nothing from production and never reads a `.env` file. It then adds both ids to `LABEL_DEVELOPMENTS`, runs `npm run format --prefix server`, and runs `keys.test.ts` and `developmentHalves.test.ts` (format, no database).
- **The database check.** `npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-22_linking-eval --steps keys` makes no API calls. It checks every slug is published and every date is the story's UTC day. It runs in the main folder, since it reads the local database through the repository's env file.
- **If the local database is unreachable** from the implementer's session, the check goes in the follow-up. Runbook step 0b runs it before any paid call anyway.

### 3. Runbook: paid linking runs at `--concurrency 1`, in a new folder

Every linking command in `.context/model-eval.md`, and both commands of `.plans/2026-11-19_overviews-eval-runbook.md` step 2, gets `--concurrency 1`, so that a `--cache-only` rerun reproduces the paid run call for call ("A free rerun from the cache" says so). Both commands move to a new folder, `DOCS/2026-11-22_linking-eval`: the report name carries no concurrency, so in the old folder the new run would overwrite the 2026-11-19 baseline report. The smoke command keeps `--budget 1`, and the judged one takes `--budget 3`.

**Order.** The closing plan changes the link prompt, so the next paid linking run comes after both plans have landed.

**Cost.** The judged half's 209 stories plus roughly 250–340 background stories (the Iran war's 237 entries and Hormuz's 116, less those they share and those already replayed) make about 460–550 a run.

- **The background stories' link calls.** At the paid run's measured $0.0005 a story and run, they add about $0.38–0.51 over 3 runs.
- **The background developments' own foundings** on the large tier add about $0.05–0.30.
- **Added per judged paid run of 3 runs: about $0.45–0.80.** The whole judged line costs about $0.75–1.10 in the fresh folder: background stories become neighbours of judged stories, so their prompts change and nothing is reused from the old cache.
- **Linking as a whole** (smoke plus gate) is about $1–1.50, against the earlier desk figure of about $3, so the runbook's totals come down by about $1.50–2.

**Time.** At concurrency 1 the three runs take roughly 1.5–2 hours.

**No rescore of the old run.** The 2026-11-19 bars can't be rescored under these rules (the cache-only rerun drifted). The new run is the baseline.

## Changes

| File | Change |
|------|--------|
| `server/src/scripts/eval/overviews/linkScore.ts` | New exported `linkKeys(keys, others)`, as in Approach 1 (`entry`, `nearMiss`, `all`, `judged`, `standsFor`, `verdict`). `scoreLinkRun` builds it once, loops its members through `verdict`, takes found and role from `all`, and skips the wrong-founding check when neither founding story is `judged`. `developments` holds judged keys only. Update the module doc. |
| `server/src/scripts/eval/overviews/linkDiagnostics.ts` | `diagnoseRun` takes `linkKeys` and uses it for `devOf` (`standsFor`), `isOurs` and the expected role (`all`), and the charter member counts (`verdict`). Missed entries and role misses still iterate the judged must entries. `what()` labels a story of a key in neither half "(label key)" rather than "(other half)". |
| `server/src/scripts/eval/overviews/replay.ts` | Line 157 builds `linkKeys(keys, others)`; `checkpoint`'s `wrongMembers` (lines 104–111) and the re-centers' `development` (lines 229–232) use `standsFor`, so the replay's report reads overviews as its link bars do (`replayScore.ts:195` passes `others`). The closure call (line 247) is left; the closing plan deletes it. Background in the whole-step replay is out of scope. |
| `server/src/scripts/eval/overviews/link.ts` | New pure `backgroundOf`, beside `replaySlugs`. `runLinkStep` replays the union for `half: 'judge'`. `LinkStepReport` gains `background: { keys: string[]; stories: number }` (empty in the refusal branch). `stories` is the total replayed, and `perStoryUsd` is computed over it. |
| `server/src/scripts/eval/overviews/linkReport.ts` | The replay line: "N stories: J judged (entries and near misses) of the half's keys, and B background stories of K, unscored unless they join a judged development's overview". The background part is omitted when B is 0. |
| `server/src/scripts/eval/overviews/developmentHalves.ts` | Add `LABEL_DEVELOPMENTS`. Update the doc of `keysOfHalf`: `others` now also decides what an overview stands for, and supplies background. |
| `server/src/scripts/eval/overviews/update.ts` | Line 108: keep only keys listed in a half (`developmentHalf(id) !== null`). |
| `server/src/scripts/eval/overviews/keys/un-pandemic-declaration-2026.json` | New, as in Approach 2. *Responsibility:* labels the UN declaration's stories as one development. |
| `server/src/scripts/eval/overviews/keys/us-ocean-observatories-cuts-2026.json` | New, as in Approach 2. *Responsibility:* labels the OOI dismantling stories as one development. |
| `server/src/scripts/eval/overviews/keys/pandemic-agreement-pabs.json` | `charter.endEvent` as quoted; one line in `notes`. |
| `.context/model-eval.md` | Linking section: the replay bullet (the background rule), the scoring bullet (`standsFor` and the join rules; "the bars skip center entries as optional" now holds only in their own key's overview; background foundings; the three claims and limits), "A free rerun from the cache" (reproduced at `--concurrency 1`), and the commands. "The halves": the label list. The keys bullet: the two label keys. "update": label keys excluded. "The overviews gate, in order", step 1: `--concurrency 1`, the folder `<date>_linking-eval` for both lines, budgets 1 and 3, about $1–1.50. Linking's share in "Where the money goes" and the gate total. |
| `.context/overviews.md` | "Switching on": the `link` and `found` "Rests on" cells (judged stories plus unscored background; foundings with a judged story), and linking's cost and the total in item 2. |
| `.plans/2026-11-19_overviews-eval-runbook.md` | Step 2's two commands (folder, concurrency, budgets), its cost and time, one line on the background stories and what the result can't claim, and that it runs after the closing plan lands. Table row 2 and the expected total. |
| `.context/decisions/0073-…md`, `.context/decisions.md` | Promote ADR-0073 through `ashoka-engineering:adr` at implementation (the agent as decider; the owner's request named in its context), at the next free id if 0073 is taken by then. |

## Tests

These follow `linkScore.test.ts`'s inline `key()` and `run()` helpers and `link.test.ts`'s fake context:

- **`linkScore.test.ts`, `linkKeys`:** a table over `verdict`:
  - In a judged overview, its key's must entry is right and its optional entry is ignored. A background story, another key's near miss, optional entry and center entry are each wrong.
  - In an overview standing for an `others` key, a judged must entry is wrong, or right where that key holds it as must too. A judged near miss and a background story there are null.
  - `standsFor` picks the `others` key that holds most of the members' musts.
- **`linkScore.test.ts`, `scoreLinkRun`:**
  - A founding of two background stories is not counted wrong. One with a judged story is checked.
  - `developments` holds no `others` key.
  - A judged must entry in an `others` key's overview that holds it as must is found, and its role is judged against that key.
- **`link.test.ts`:**
  - `backgroundOf`: a key whose entry is in the replay contributes its entries but not its near misses. A key whose only shared slug is its own near miss contributes nothing. Slugs already replayed are not added again.
  - `runLinkStep` with `half: 'judge'` replays the background stories in date order and reports their keys and count. With `half: 'tune'` it adds none.
- **`linkDiagnostics.test.ts`:** update line 153 (o3 now stands for `strait`). A label key's story reads "(label key)". The charter counts of an `others`-standing overview come out as `verdict` gives them.
- **`developmentHalves.test.ts`:**
  - Every committed key appears in exactly one of the three lists.
  - Lines 29, 31 and 32 change: `others` now includes the label keys, for `all` too.
- **`update` test** (`updateFixtures.test.ts` or `update.test.ts`, whichever builds keys): a key in no half adds no slug.
- **No tests for key contents or the PABS wording.** `keys.test.ts` already holds every committed key to the schema.

## Out of Scope

- **Dropping formal closing**, which is the parallel plan's work: the `closure` step, the end quote in linking, `closed` in the keys, and replay.ts's closure lines.
- **Background in the whole-step `replay` step**, and `--concurrency 1` on its runbook line. Both come after the closing plan lands, since that plan rewrites that line. This plan only aligns how the replay reads overviews.
- **A general rule in the end-event judge** for alternative endings.
- **Searching the database for further stories** of the two label developments. The replay holds only key stories, so stories absent from every key can't affect it.
- **Prompt tuning**, and opening any gate.

## Shared files with the closing plan

- **Docs and the runbook:** `.context/model-eval.md` (the linking section, the gate list and its totals), `.context/overviews.md` ("Switching on" item 2 and the table), and `.plans/2026-11-19_overviews-eval-runbook.md` (step 2 and the totals).
- **Code:** `replay.ts` (this plan changes lines 104–111, 157 and 229–232; that plan, the closure lines, `lastDay` and the refusal) and `linkDiagnostics.ts` and its test (that plan likely changes the quote-rule wording at test line 130). Possibly `link.ts` (the end-event loop, which this plan leaves alone) and `linkReport.ts`.
- **Keys:** `keys/*.json` (that plan deletes `"closed": null` from every key file, which will be 12 by then, the two label keys included).

The two plans' semantics don't conflict; whichever lands second rebases these texts. The ADR ids are distinct: 0072 is the closing plan's, 0073 this one's.
