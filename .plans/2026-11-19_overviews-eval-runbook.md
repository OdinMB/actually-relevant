# Ongoing-story overviews: eval run plan before switching on (2026-11-19)

Branch `claude/project-thread-egeer5`, commits `76e83db` to `cfad841`, `14c0b80`, which cut this eval to its present scope and put the eval's spending cap back to $20, and `4a940ec`, which adds step 1's drafting of the answer keys' "what's being done" and ends. Updated 2026-11-20 for re-centering (commits `af23d01`, `52ef8c6`, `07f5a7c` and the review fixes after them): an overview whose development grew past its first description can now be re-described ("re-centered") by two agreeing model calls, held to where it began; this adds step 3b, the optional Colorado center in step 1b, and re-centers in steps 2 and 6. Updated 2026-11-22 for ADR-0072: an overview now closes only by fading or an editor's Close, so step 1 drafts the "what's being done" items only, step 2 is paid again (the link prompt changed: a story no longer needs a quoted shared end), step 6 has no closing bar, and step 7 lists the reader wording that changed. Updated 2026-11-22 again for ADR-0073: step 2's judged line replays the stories of the neighbouring developments' keys beside the judged half as unscored background, both linking lines run one call at a time (`--concurrency 1`) in a new folder, and step 2 costs about $1–1.50, not $3. Updated 2026-11-22 a third time for ADR-0074: the linking lines run at the default concurrency again, their three runs side by side, so step 2's judged line takes about 15 to 25 minutes rather than 1.5 to 2 hours; each run saves its replay beside its report, and `--rescore` scores that replay again under today's keys for free ("Reading why, for free", with the recipe for the run made one call at a time). Ongoing-story overviews are built and switched off: each night, after publishing, the `link_overviews` step would file every new story under the ongoing development it reports on (an outbreak, a war, a negotiation), start a new one when two stories report the same development, and keep each one's timeline and "Where this stands" summary up to date. Readers would get `/ongoing`, a page per development, a card on the story page and a chip on story cards. This plan checks, on past developments we covered, that the step gets them right before it runs for real. Nothing here changes production: the evals only read the database and write only into their `DOCS/` folders, except step 1's drafts, which go into the answer keys in the repository for you to review. The switch itself is two acts at the end: one line of code, then the job enabled on the Jobs page.

All commands run from the repository root on the computer with the local database copy (`DATABASE_URL`, holding the published stories the answer keys name), `OPENAI_API_KEY` and, for steps 4 to 6, `TAVILY_API_KEY`. `--budget` caps everything a folder has spent over all its runs, not one run, so a later command in the same folder names the folder's running total; no budget above $20 is accepted. A rerun in the same folder answers from its cache and costs nothing again. No paid run of these steps has been made yet, so the costs below are desk estimates; the first run of each sets the baseline.

Expected total: **about $15.50–18** (about $11–26 if the desk figures are off), and never more than **$29**, the four folders' caps. Most of it is researching 38 stories for the summaries (step 4, about $6), one replay of the whole step (step 6, about $3.70–4.10) and the re-centers (step 3b, about $2.25–3.75). Your own time: about 30–45 minutes in step 1, reviewing the drafted answer-key items (`2026-11-19_overviews-key-review.md`, beside this file), and, if you draft Colorado's center (step 1b, optional), about 30–60 minutes more.

| Step | What | Runs | Expected | Folder budget |
|---|---|---|---|---|
| 1 | Answer keys: "what's being done" drafted, you review it, then the check | once | about $1 | 2 (key-drafts folder) |
| 1b | Optional: Colorado's center, drafted by you from your database copy | none | no cost | none |
| 2 | Linking: smoke, then the judged half with its background stories, the three runs side by side (about 15–25 minutes) | 3 | about $1–1.50 | 1, then 3 (linking folder) |
| 3 | Reviews with planted mistakes | 3 | about $0.60 | 2 (review folder) |
| 3b | Re-centers on planted cases | 3 (1 for the negatives) | about $2.25–3.75 (+$0.30–0.50 with Colorado's center) | 6 (review folder, running total) |
| 4 | Research the summaries' 38 stories | once | about $6 | 11 (upkeep folder) |
| 5 | "Where this stands" and its fact check | 1 | about $1.20 more | 13 (upkeep folder, running total) |
| 6 | The whole step replayed | 1 | about $3.70–4.10 more | 18 (upkeep folder, running total) |

The reports mark a bar **"for the owner"** when it rests on fewer than 20 judgments, too few for the eval to decide (with 20, one judgment moves the rate by 5 points). The report lists those judgments; read them, and the bar counts as met when you say so.

## 0. First: research passes are on

Overviews come after research passes, for two reasons: enabling `link_overviews` is refused while `research_pass` is off, and "Where this stands" is written only from facts research passes have checked.

- **Before anything below:** research passes' own evals met their bars, their gate opened in its own change, and `research_pass` enabled, with a few nights of passes run cleanly.
- **Note for that change:** opening research passes' gate is not one line as it stands. Setting `PASS_EVAL_GATE` to null makes 48 of today's server tests fail (they assume it closed). That change has to update them. The overviews' own switch has no such tests left.

## 1. Answer keys: draft, review, check (about $1, budget 2)

One bar has nothing to measure yet: "What's being done" present (step 5) needs to know what each development's stories report as being done. None of the nine keys records it, and the stories' texts are only in your database copy, so the first two lines draft it there.

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_key-drafts --steps key-draft --half judge --dry-run
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_key-drafts --steps key-draft --half judge --budget 2
npm run format --prefix server
# review the drafts (2026-11-19_overviews-key-review.md), then:
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_linking-eval --steps keys
```

- **The draft:** the dry run costs nothing and prints the estimate (about $1 for the five judged developments). The second line asks a strong model once per development, with every story it covers, what each story reports as being done (aid, a vaccination campaign, a ban in force, a court case, a funding pledge: under way, by someone named). Code keeps only what it can check: one item a story, from a story that clearly belongs, with words that are really in that story. It writes them into the five key files in the repository, each marked `"reviewed": false`. The report in `DOCS/2026-11-19_key-drafts` lists every item for your review.
- **Your review** (about 30–45 minutes; how, in `2026-11-19_overviews-key-review.md`): delete what is wrong, keep what is right by marking it `"reviewed": true`. Until every item is marked or deleted, step 5 refuses to run. Then commit the five key files, or ask a session to.
- **The check (last line), compares against:** the answer keys in `server/src/scripts/eval/overviews/keys/` (the development keys and, since 2026-11-22, two small label keys): which of our stories belong, which only look like they do, each story's role, and what was being done.
- **Bar:** every slug is a published story and every quote, the reviewed ones included, is found in its text; the "To review" column reads 0 for the five judged keys.
- **Fails:** a story was corrected or unpublished since the key was written. Fix the key to match the story, never to make a later step pass.

## 1b. Optional: Colorado's center (no cost; before step 2)

The Colorado River key describes the rules fight; later stories describe the water shortage itself. That second description is a "center" the development moved to, and with it step 3b can test a real re-center beside the planted ones. Only you can write it, since the stories' texts are in your database copy. Without it, step 3b reports the real case as "not run" and the planted cases still decide.

- **Where:** in `server/src/scripts/eval/overviews/keys/colorado-river-rules.json`, a new `"centers"` list with one item (a session can write the skeleton for you to fill).
- **What it holds:** `"from"`: the day of the first shortage story, which must come **after 2026-08-18** (the key's last checkpoint); `"title"`: "Colorado River water shortage"; `"charter"`: `"in"` (one or two sentences on what the shortage covers), `"out"`: the key's own six "out" entries, every one kept, and `"endEvent"`: an event that would end it, or `null` (it ends by fading); `"why"`: one line on what moved the center; `"entries"`: each shortage story (the hydropower intervention among them) with its slug, date, title, `"join": "must"` (or `"optional"`), its role (`"turning_point"` with a kind, or `"routine"`) and a line of why; `"nearMisses"`: drought stories outside the basin, each with slug, date, title and why; then `"reviewed": true`.
- **Then:** `npm run format --prefix server`, and the check of step 1 again (`--steps keys`): it finds every slug, date and quote in the database. Commit the key, or ask a session to.
- **Too thin:** with fewer than 3 shortage stories on or after `"from"`, the real case cannot be built (a re-center takes in at least 2 stories and needs the signal), and step 3b says so.
- **Important:** once a center is in a key, steps 2, 3b, 5 and 6 refuse to run until it is marked `"reviewed": true`.

## 2. Linking (about $1–1.50, folder budget 3)

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-22_linking-eval --steps link,found,role --half tune --limit 20 --budget 1
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-22_linking-eval --steps link,found,role --half judge --repeat 3 --budget 3
```

Run this only on the branch with re-centering, the end-event change (ADR-0072) and the background (ADR-0073) in it, all three landed by 2026-11-22: each changed what the prompts are asked, so a run before would have to be paid again. The first line is a smoke run on the developments the prompts were tuned on (under $0.40); the second is the real test, three runs on the five developments held back for judging (Ebola in eastern DR Congo, El Niño, the war in Lebanon, the WHO pandemic agreement's PABS annex, the Colorado River rules), about $0.75–1.10. Their 209 stories are replayed in date order as if each night had linked them, among about 280 **background stories**: the stories of the Iran war and Hormuz keys, the neighbouring developments some of the judged stories also belong to. In production those developments would have their own overviews from their own stories; without them, their look-alikes among the judged stories founded an overview of the Iran campaign that counted against Lebanon. A background story counts only where it ends up in a judged development's overview, as a wrong join. Add `--dry-run` to either line to see the stories, the background and a desk estimate at no cost. Both lines run in a new folder, so the 2026-11-19 report stays. The 3 runs go side by side, each filing stories as production's nightly step does (three calls ahead of its writes), and take about 15 to 25 minutes. Each line saves its replay beside its report, so the report can be scored again later at no cost (step "Reading why, for free" below). If the report shows a line "Calls that failed", OpenAI limited the requests: run the line again with `--concurrency 4` added. Most of the cost is the call that files each story, about $0.0005 a story and run as the 2026-11-19 run measured, and the strong model's two calls whenever a development is founded, so this step keeps its three runs.

- **Compares against:** the answer keys, and two small "label" keys (the UN pandemic declaration, the US ocean-observatories cuts) that only say two pairs of judged stories are each a development of their own, so founding one from them is right. No earlier run under these rules exists; this one is the baseline.
- **What it can't claim:** the background stories are from the tuned half, so how they behave is no held-out evidence, and joins right may read a little high; some judged stories were already replayed in tuning as look-alikes; and the replay holds one ring of neighbours, where production holds every story.
- **Bars** (means over the three runs): of the stories it files, at least 97% in the right development; at least 85% of the stories that belong found there; no development started from two stories that are not the same development; no wrong "end event" where a new development names one (a strong model judges; one started with none, which ends by fading, is counted for you and never wrong); turning point or routine agreeing with the key at least 85% of the time (the role readers get: since 2026-11-22 code makes a story that reports the development's end event a turning point, so a wrong flag counts as a wrong role).
- **Rests on:** three runs of the 121 stories that belong and the look-alikes and background stories that end up filed in a judged development; every founding with a judged story in it; 5 end events a run. Large enough for the eval to decide every bar.
- **Expect:** the report lists every wrong join and wrong founding with the story's title, and the cost per story. A new table counts, with no bar, how often the filing call flagged that a story points past a development's description ("wider") or that the development moved ("center moved"): on Colorado's center stories if you wrote one (how well the flag finds a real move), on the look-alikes (how often re-center attempts would fire, and so their cost), and on developments that never moved (false alarms). Read it for yourself.
- **Fails, files too many wrong stories:** read the wrong joins. If they share a place but not a cause, the link prompt (`server/src/prompts/overviews.ts`) needs tightening: tune on `--half tune`, then run the judged half again. If tuning does not get there, the plan's fallback is the link check on the large model (`config.overviews.tiers.link` set to `'large'`), at about $9-15 a month instead of $4-8.
- **Fails, misses too many stories:** read the misses: usually a story whose development had no nearby story yet. Check `neighbourLimit` and `memberLookbackDays` in `config.overviews` before the prompt.
- **Reading why, for free (2026-11-21; `--rescore` since 2026-11-22):** the report lists every missed story with its cause (no candidate, its development not offered, refused by the quote checks with the rule, a founding not agreed, or the model's no or unsure), the roles that disagree, and every charter founded. Each run saves its replay beside its report (`linking-replay-half-judge-repeat-3.json` for the judged line). After a fix to a key, rerun the judged line with `--rescore` added: it makes no call and opens no database, scores the paid run's replay under today's keys, and writes `overview-eval-steps-link-found-role-half-judge-repeat-3-rescore.md` beside the paid report (`.context/model-eval.md`, "Saved replays and free rescoring").
  - **Exact:** a label fix among the stories replayed (a role, must or optional, a look-alike made an entry).
  - **Not evidence for the gate:** keys that now name stories the run never replayed. The rescore still runs, lists those stories as left out ("not in the saved replay"), and says so on its first lines; a paid run is then the measurement.
  - **Not judged:** a development's end event changed since the run (in the key, or in how the judge is asked). That end event shows "not judged", and the end-event bar has no verdict.
  - **The run made one call at a time on 2026-11-22,** before replays were saved: rerun its judged line with `--concurrency 1 --cache-only` added. It answers every call from the cache, costs nothing, writes `…-cache-only.md` and saves the replay, also where the folder's spend is already past `--budget`; then run the line with `--rescore` added. A rerun from the cache that leaves calls unanswered, or stops before its last story, saves nothing, so a paid replay is never replaced by a drifted or cut-short one.
- **Paid again after 2026-11-22:** the end-quote rule refused about half of the missed stories in the paid run below (routine stories never say how a development ends), so the owner removed it with the end-event closing (ADR-0072). The link prompt and schema changed with it, so the cached link calls miss and the judged line above is paid again (about $0.75–1.10 with the background); its rerun from the cache cannot measure the change.
- **The cached rerun is not the measurement (2026-11-22):** it left 316 calls unanswered, against 627 story replays over the three runs (the drift described in `.context/model-eval.md`, "Saved replays and free rescoring"), so those stories count as failed and its bars (found 18.5%, joins right 93.2%, roles 71.3%) say nothing about the step. The paid run's bars stand: joins right 89.8%, found 59.2%, wrong foundings 2.67 a run, wrong end events 1.33, roles 51.1%. Rescored by hand against today's keys, the paid run's wrong foundings drop to about 2.00 a run: the US–Iran deal pair (run 1) and the strikes-and-"very soon" pair (run 2) are entries of the Iran war's key. The rest stay wrong: the two Science coral-study stories (all three runs), the El Niño warning-cut pair (run 1), a Lebanon near miss with a Lebanon entry (run 3), and the UN pandemic-declaration pair (run 3). The answers the rerun did get are real ones, so its missed-story causes and role disagreements can still be read. The two pairs that are developments of their own (the El Niño warning-cut pair and the UN pandemic-declaration pair) have label keys since 2026-11-22, so a founding from either now counts as right, and the PABS annex's end event names its adoption alone, so a founding naming adoption is no longer judged wrong for leaving out abandonment. Those bars are not rescored: the new run, with its background, is the baseline. A fresh paid run of the old line cost about $0.30; the new one costs about $0.75–1.10.
- **Paid judged run, 2026-11-22** (`DOCS/2026-11-22_linking-eval`, after the end quote stopped being required, with the background stories, label keys and the PABS key, on the untuned role and founding prompts; the tuning of 2026-11-22 was reverted because it lowered joins and found on the tune half). It cost $1.75 for 487 stories × 3 runs, about 20 minutes at the new default concurrency. Results:
  - joins right **97.1% (met)**, against 89.8%;
  - found **93.4% (met)**, against 59.2%;
  - wrong foundings **1.33** a run: the Science coral-study pair in every run, and two general WHO warnings in run 3;
  - wrong end events **1.00** a run: Ebola every run, with the founding naming "declared over in all affected countries" against the key's "DR Congo and WHO declare it over";
  - roles **52.8%**: the key says routine and the model says turning point, almost always.
  
  The saved replay, `linking-replay-half-judge-repeat-3.json`, rescores for free with `--rescore`.

## 3. Reviews (about $0.60, budget 2)

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_review-eval --steps review --half judge --repeat 3 --budget 2
```

Each judged development is built from its key with mistakes planted: up to two look-alike stories slipped in, one story's role flipped, and the list of what stays out emptied. The review must find them. Five calls a run, so it keeps its three runs.

- **Bars:** at least 80% of the planted mistakes undone; at most 3% of the correct stories taken out or relabeled.
- **Rests on:** 20 planted mistakes and 116 correct stories a run, three runs.
- **Fails:** read the listed misses and wrong removals; the review prompt is the place to tune, on `--half tune` first.

## 3b. Re-centers (about $2.25–3.75, budget 6 in the review folder)

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_review-eval --steps recenter --half judge --budget 6
```

The automatic re-center is two strong-model calls: one proposes a new description of the development and judges every story under it, a second checks it blind; code then applies it only when both agree, it still covers where the development began, and it does not swallow a neighboring development that has its own page. Here it is asked directly, on cases built from the keys. Each story offered comes with the words that flagged it, as in production (the linking step quotes a few words of a story that point past the description; here the case's own words, or the story's title):

- **Planted narrowed descriptions**, one per judged development, each a plausible early description too narrow for what the development became (Ebola as "WHO's Ebola emergency", El Niño as "El Niño's threat to the Indian monsoon", Lebanon as "Israeli strikes on Beirut", the PABS annex as "the May 2026 deadline", the Colorado River as "the seven states' talks"), two thirds of the way in, offered the development's other stories and its look-alikes: it should re-center back to the key's description, taking in the right stories and no look-alike. 3 runs each.
- **Colorado's real center** (only if you wrote it in step 1b): it should re-center to it. 3 runs.
- **A trap:** Colorado offered only look-alikes that a "Western US water loss" description would take in, which would leave the rules fight behind: it must not re-center. 3 runs.
- **A second trap, a neighbor it would swallow:** the Lebanon war under an earlier description (one that does not yet rule out the wider war with Iran), offered six stories of that wider war, with the Strait of Hormuz page open beside it. Taking those stories in needs a description of the whole regional war, which would swallow the Hormuz page; merging two pages is not what a re-center may do, so it must not re-center (it may keep its description, or the check refuses it for covering Hormuz). 3 runs, about $0.25–0.45.
- **Developments that did not move**, at their last checkpoint, offered their look-alikes: none may re-center. 1 run each (the PABS annex has no look-alikes in its last 90 days, so it is not run).

- **Bars:** re-centered where expected at least 80% of the time; no wrong "end event" where one is named (a strong model judges); no false re-center; no look-alike taken in; no applied re-center that lost the development's start (code makes that impossible; it is a regression check).
- **Rests on:** 15 expected re-centers (18 with Colorado's center), so the 80% bar is **for the owner**: the report lists every attempt, and you decide. The counts decide on any sample.
- **Expect:** a table of every attempt with its outcome, what refused it if anything, its new title and end event, and what it took in; for the traps and the negatives, which rule held (for the Hormuz trap, "neighbour" is the rule built for it).
- **Fails, no re-center where expected:** read the attempts' reasons. Usually the proposal kept too few of the existing stories or took in too few new ones; the re-center prompt (`server/src/prompts/overviews.ts`) is the place to tune, on cases of the tuned half first.
- **Fails, a false re-center or a look-alike taken in:** read the proposal's description and the check's reasons. This one matters more than a missed re-center: it changes what readers see with no person involved.

## 4. Research the summaries' stories (about $6, budget 11)

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool --half judge --dry-run
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool --half judge --budget 11
```

The first line costs nothing: it prints how many stories the second would research (38) and their ceiling ($15.20 at $0.40 a story, which no story is expected to reach). The second researches them once, in memory, as a research pass would. "Where this stands" is checked at 15 checkpoints (5 developments, each a third of the way in, two thirds in and at the end), and at each one this researches the 3 newest stories published by then (2 at the PABS annex's and the Colorado River's first checkpoint, which have no more yet). That is 38 of the judged half's 121 stories that belong; the summaries read nothing from the rest, so they are not researched.

- **Read:** the report's cost per story (about $0.10–0.25 expected, $0.15 in the estimate) and how many of the 38 gave facts the summaries can use.
- **Watch:** every checkpoint needs at least 3 such facts, or step 5 reports "not enough evidence" and the gate stays closed. If several stories gave none, read which before paying for step 5.
- **If the budget stops it:** the report lists the stories not run. Run the same line again with `--budget 14`; what it already did costs nothing again. Then run step 5 with `--budget 16` and step 6 with `--budget 20`, the most any folder may have.

## 5. "Where this stands" and its fact check (about $1.20 more, budget 13)

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,stands,fact-check --facts stands --half judge --budget 13
```

One run, on step 4's research (from the cache, at no cost). "Where this stands" is written at each checkpoint, a strong model reads every line against its facts, then errors are planted in those lines to see whether the fact check catches them.

- **Bars:**
  - summaries: no sentence the strong model finds unsupported; the latest value of each tracked figure stated at least 90% of the time where a fact holds it; "What's being done" present at least 70% of the time where the key says something was being done and a fact reports it, and never unsupported; all of it over the 15 checkpoints, each with enough facts;
  - fact check on the summaries' lines: at least 90% of planted errors caught, at most 5% of correct lines rejected.
- **Rests on:** one run. At most 60 summary sentences (4 at each checkpoint) and 30 lines of "What's being done". At most 21 latest values (only Ebola, El Niño and Lebanon track figures), so that bar is **for the owner**: the report lists each value not stated, and you decide. "What's being done present" rests on the items you reviewed in step 1: at most 15 judgments (one a checkpoint, where a reviewed item's story has current facts), so it is **for the owner** too. The step refuses to run while a drafted item is not reviewed. The fact check works on the up to 90 lines the summaries kept and their planted variants, enough for the eval to decide.
- **What one run gives up:** "no unsupported sentence" on up to 60 sentences shows the rate is under about 5%; three runs (180 sentences) would have shown under about 1.7%. A mistake that appears one run in three can pass unseen. And the summaries see the facts of the newest 3 stories at each checkpoint, not of every story as production would (up to 60 facts), so they may read a little better than production's will.
- **Fails, unsupported summary sentences:** the report lists them; read them beside their facts. A pattern (a figure restated with the wrong date, a response claimed from a plan only announced) goes into the summary prompt, tuned on the tuned half, which needs its own research first: `npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-tune --steps pass-pool,stands --half tune --budget 5` (21 stories, about $3–4).
- **Fails, "not enough evidence":** too few facts at some checkpoints. Read which developments, and whether research found nothing or found facts that were not usable; this is research's side, not the overview's.

## 6. The whole step replayed (about $3.70–4.10 more, budget 18)

```bash
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,replay --half judge --budget 18
```

One run: the whole step replayed night by night (linking, the status machine, reviews, re-centers, summaries) on the same research, again from the cache. Most of its cost is the strong model's reviews, about 45 over the run; re-center attempts, fired by the flags step 2 counts, add about $0.20–0.60.

- **Bars** (since 2026-11-22 no closing bar: overviews close only by fading or an editor's Close, ADR-0072):
  - re-centers: none of a development that never moved, and no look-alike taken in by one;
  - the whole replay: the linking bars of step 2 hold on its end state, and its cost per story fits the plan's estimate of about $4-8 a month once switched on.
- **For you to read:** how many re-centers happened and the most on one development (never more than 2: after that only an editor may), each one's day against the day Colorado's center began (if you wrote it), and "splits": a new development started from two of the center's stories instead of the old one re-centering.
- **Rests on:** one run of the 5 developments and 209 stories. The cost per story is a little low, since the replay writes summaries only where it has researched stories (summaries are about a tenth of the step's monthly cost).
- **Expect:** if the budget stopped it, the report says where, and its bars are no evidence: run the line again with a higher `--budget` (what it did costs nothing again).

## 7. The switch (after every bar above is met)

- **Approve the words:** the methodology page's new "Ongoing Stories" section (`client/src/components/overview/OngoingStoriesMethod.tsx`, shown only while overviews are on) and the pages' other wording (`client/src/components/overview/overviewCopy.ts`). The label "Summary and timeline by AI, from our stories and their sources." is already yours. Changed on 2026-11-22 with the end-event closing's removal (ADR-0072), and approved by you the same day:
  - the methodology's linking sentence now ends "…for a shared cause and place, and code finds each quote in their text." (it said "…for a shared cause and place, and a shared end where the development names one, and code finds each quote in their text.");
  - its closing sentence is now "When three weeks pass without a new story, the page shows the date of the last one, and a new story that belongs picks the development up again." (it said "A development ends when two AI checks agree that one of our stories reports its end, or after 120 days without a new story, and opens again when a new story belongs.");
  - a development that faded (120 days without a story) now reads "No new reporting since <its last story's day>", as a quiet one does; only an editor's Close reads "Ended <day>".
- **The gate change, its own commit:** in `server/src/services/overviewGate.ts`, set `OVERVIEW_EVAL_GATE` to `null`. That is the only code line; no test depends on it. The same commit changes the docs that say the step is switched off (listed in `.context/overviews.md`, "Switching on", step 4). Deploy as usual.
- **Enable `link_overviews`** on the Jobs page once the deploy is live, before a night's daily edition. The site's "Ongoing" link appears within 5 minutes; `/ongoing` stays empty until a night's review makes the first development public (at three kept stories).
- **The first week:** the first 6 nights or so also link the last 6 months' stories (300 a night), each night 15-25 minutes longer after publishing, about $10-20 once. Watch the job's summary on the Jobs page ("backfill N of M" until it is done), its spending line against the $10 warning, failure notices, and the admin's Overviews pages. An editor's Detach, Hide or Undo fixes a wrong one at once.
- **To switch off again:** disable `link_overviews`. Readers see no overview from then on, and the records stay for the admin.

## After the runs

- Keep the four folders, `DOCS/2026-11-22_linking-eval` and the `DOCS/2026-11-19_*` key-drafts, review and upkeep folders (five if you tuned the summaries; step 3b shares the review folder), and the old `DOCS/2026-11-19_linking-eval` for its report: their caches make every rerun free, and their reports are the record the gate opened on.
- Tell a session which bars were missed, if any, with the folder's report: it tunes on the tuned half and you rerun only the judged-half lines.
- Once switched on and a month has passed, compare the real cost per story and per development (the decisions' recorded costs) with the replay's estimate.
