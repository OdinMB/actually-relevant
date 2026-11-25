# Eval baselines

The measured results a later change is compared against. One section per baseline, newest first; a section is replaced only by a newer run of the same command, and says which commit it was measured on. How the evals work, their flags and bars: `model-eval.md`. The reports and the caches that make reruns free are not in the repository: they live in `DOCS/` on the machine that ran them, so on another machine every run is paid in full.

## Overviews and research facts, 2026-11-24 and 2026-11-25

Run on branch `claude/project-thread-egeer5` against a local copy of production of 2026-11-19, following `.plans/2026-11-19_overviews-eval-runbook.md`. Halves: `judge` is the gate (5 developments, 201 stories, 37 researched), `tune` is what prompts are tuned on (29 stories researched). Models as `config.ts` had them: small tier gpt-6-luna, strong judge gpt-6.1-sol at high effort.

### Bars and where each stands

| Step | Measure | Bar | Result | Verdict |
|---|---|---|---|---|
| 2 Linking (3 runs, 2026-11-23) | joins right | ≥ 97% | 97.4% | met |
| | true joins found | ≥ 85% | 91.1% | met |
| | wrong foundings (share) | ≤ 10% | 0.0% (0 of 18) | met |
| | roles agreeing | ≥ 65% | 71.5% | met |
| | wrong end events | report only | 1.00 a run | report only |
| 3 Reviews (3 runs) | planted errors caught | ≥ 90% | 95.0% | met |
| | correct items taken out | ≤ 3% | 0.0% | met |
| | correct roles kept | ≥ 90% | 92.3% | met |
| 3b Re-centers | re-centered where expected | ≥ 90% | 15 of 15 | for the owner (under 20 judgments) |
| | false re-centers | ≤ 10% | 0 of 10 | met |
| | look-alikes joined, anchor breaks | ≤ 10% | 0 | met |
| 4 Research for the stands | stories giving usable facts | every checkpoint ≥ 3 facts | 36 of 37; every checkpoint ≥ 23 | met |
| 5 Stands (3 runs) | unsupported sentences | ≤ 5% | 1.9% | met |
| | "What's being done" unsupported | ≤ 5% | 3.6% | met |
| | "What's being done" present | ≥ 70% | 53.3% | **accepted by the owner for now, 2026-11-25** (investigation in `BACKLOG.md`) |
| | latest value stated | report only | 24.4% | report only |
| | fact check: planted errors caught | ≥ 90% | 96.7% | met |
| | fact check: correct lines rejected | report only | 2.5% | report only |
| 6 Whole step replayed with the background (1 run, ADR-0081, commit ee305c2d) | joins right | ≥ 97% | 97.0% (just under: 3 wrong joins) | **met: the owner accepted it, 2026-11-25** |
| | true joins found | ≥ 85% | 88.1% | met |
| | wrong foundings (share) | ≤ 10% | 0.0% | met |
| | roles agreeing | ≥ 65% | 81.3% | met |
| | false re-centers, look-alikes joined | ≤ 10% | 0%, 0% | met |

- **Step 5** is the run after ADR-0080 (a fact shown as its statement with a record; the figure check). Before it, on the same stories: unsupported sentences 0.9%, "What's being done" unsupported 2.7%, present 66.7%, latest value 28.2%, caught 100%, correct lines rejected 16.0%. The strong judge reads each line against its facts as the write was shown them (the owner, 2026-11-24). Read against the source sentences instead, it accepted 22 of 46 lines before ADR-0080 and 38 of 49 after.
- **Step 6** first ran without step 2's background stories (2026-11-24: joins right 89.8%, wrong foundings 14.3%, both missed). Replayed with them (2026-11-26, 473 stories: 201 judged, 272 of the Iran war and Hormuz keys; $2.15), the foundings share fell to 0 and joins right rose to 97.0%, a fraction under the bar. The three wrong joins: a Lebanon entry ("Iran facility struck amid mass civilian casualties in Lebanon") filed in the Iran war's overview, and two El Niño near misses about record sea warmth filed in El Niño's. Misses are mostly Colorado (no candidate before its overview formed on 2026-08-18) and four Ebola stories the link call answered no. One re-center was applied, to a background overview (the Iran war's), unscored. Background developments split into several overviews (the Iran war three times), unscored.
- **Every overview bar is met or accepted by the owner** (2026-11-25): joins right in step 6 at 97.0% and "What's being done present" at 53.3% both accepted. The gate (`OVERVIEW_EVAL_GATE`) stays closed until the owner's switch (runbook step 7).

### Research facts against their sources

`--steps pass-pool,fact-check,figure-check --facts pool`: 300 facts the first passes keep, each as rendered, read by the strong judge against its supporting sentence and the source's date; a second pass sorts the rejections into "only context the sentence lacks" (counted faithful) and "changed". Report only: the owner has set no bar. One run of 300 carries about ±4.5 points of sampling noise.

| Half | State of research | Faithful, with a figure | Faithful, without | Changed (of 300) |
|---|---|---|---|---|
| judge | before ADR-0080 (fields rendered alone) | 57.4% | 75.5% | 110 |
| judge | after ADR-0080 (commit 99fdc927) | 83.8% | 74.4% | 61 |
| tune | after ADR-0080 | 65.9% | 68.4% | 97 |
| tune | field and statement rules (3279a064), extraction effort `none` | 75.3% | 73.0% | 79 |
| tune | the same rules, extraction effort `low` (the default since bdde2f05) | 77.3% | 82.5% | 57 |
| tune | and the own article read to 12,000 characters, up to 12 facts (46ab57b2) | 72.4% | 74.3% | 79 |
| judge | the end state: rules, effort `low`, longer own article (46ab57b2) | 83.6% | 73.0% | 64 |

- **The current baseline is the last two rows** (commit 46ab57b2). On the judged half the end state reads no better than straight after ADR-0080 (64 changed against 61); on the tune half the longer own article took back the gain of effort `low` (57 to 79, at the edge of two runs' noise), with the rise in credit (13 to 24) and period (15 to 21). Nobody has read these two samples by hand, so how much of the rise is real and how much is the judge seeing one sentence of a longer article (a speaker or date named paragraphs earlier) is open. The longer text gave 21% more facts on the tune half (668 to 806 over 29 stories).
- **The hand-read of 2026-11-25** (`.plans/2026-11-25_longer-text-hand-read.md`) read all 200 changed facts of the last three rows against the whole article: real errors 11, 15 and 11 of 300 (3.7%, 5.0%, 3.7%), the rest right by the article (14, 20, 9), the judge counting an omission as a change (29, 41, 41) or unclear (3 each). None of the 37 sampled facts from beyond character 4,000 is a real error; the rise from 57 to 79 is 4 real errors, 6 right by the article and 12 strict verdicts. Real errors are a floor: only flagged facts were read.
- **Never run:** the judged half with the rules and effort `low` on the 4,000-character text, so no arm separates the three changes there. The rules were written from the judged half's errors, so that half is no held-out test of them; the tune half is the cleaner reading.
- **The judge is strict.** Read by hand twice (the second reader trying to overturn the first), the judged half's 61 were 26 real errors (8.7% of 300; 18 in a record field with the statement right, 8 in the statement; one clearly misleading), 6 that the texts cannot settle and 29 the judge's strictness. 8.7% is a floor: the judge named record errors only where it looked. With this judge the share cannot fall much below 10 to 12%.
- **Changed by kind**, judge half before ADR-0080 → after it → the end state: period 50 → 24 → 19, credit 20 → 14 → 13, figure 15 → 3 → 3, scope 15 → 7 → 4, flag and other 10 → 13 → 25. Tune half, after ADR-0080 → rules at `none` → rules at `low` → longer own article: period 30 → 22 → 15 → 21, credit 15 → 10 → 13 → 24, strength 3 → 0 → 2 → 3, figure 6 → 6 → 5 → 2, scope 5 → 8 → 3 → 5, flag 5 → 5 → 2 → 4, other 33 → 28 → 17 → 20.
- **The drift judge's prompt changed with the rendering**, so "before ADR-0080" and "after" compare the two renderings as a whole, not one judge on two inputs.

### The figure check

| Half, state | Planted figure errors caught | Faithful figures removed | Kept figures the judge finds not given | Removed figures the judge finds given |
|---|---|---|---|---|
| judge, after ADR-0080 | 95.2% | 0.4% | 5.4% of 242 | 10.3% of 58 |
| tune, rules at `none` | 94.7% | 1.8% | 9.9% of 181 | 3.4% of 119 |
| tune, rules at `low` | 91.8% | 3.8% | 8.4% of 202 | 8.8% of 80 |
| tune, end state (46ab57b2) | 95.8% | 0.5% | 9.2% of 228 | 9.7% of 72 |
| judge, end state (46ab57b2) | 92.8% | 0.4% | 4.2% of 263 | 18.9% of 37 |

### Cost

- **A first research pass:** $0.025 a story on the judged half before ADR-0080; $0.0110 a story on the tune half with the rules at `none`, $0.0115 at `low` and $0.0120 with the longer own article; $0.0127 on the judged half in the end state. All with the coverage searches answered from the cache, so a real run costs more (about $0.03 with its searches).
- **An extraction call:** $0.00047 at `none`, $0.00063 at `low` (743 and 1,039 output tokens, 209 of them reasoning); about 5 calls a story.
- **The whole step replayed:** $1.27 for 201 stories.
- **Spent on these two days:** about $21.50 across `DOCS/2026-11-19_review-eval`, `DOCS/2026-11-19_upkeep-eval` and `DOCS/2026-11-19_upkeep-tune`, each inside its `--budget`.

### Commands

From the repository root, each after `npm run eval:overviews --prefix server --`; the local Docker database must be running.

| What | Flags |
|---|---|
| Step 3 | `--out ../DOCS/2026-11-19_review-eval --steps review --half judge --repeat 3 --budget 2` |
| Step 3b | `--out ../DOCS/2026-11-19_review-eval --steps recenter --half judge --budget 6` |
| Step 5 | `--out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,stands,fact-check --facts stands --half judge --repeat 3 --budget 13` |
| Step 6 | `--out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,replay --half judge --budget 18` |
| Research facts, judge | `--out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,fact-check,figure-check --facts pool --half judge --budget 18` |
| Research facts, tune | `--out ../DOCS/2026-11-19_upkeep-tune --steps pass-pool,fact-check,figure-check --facts pool --half tune --budget 15` |

A report's file name does not carry the extraction effort or the commit: copy a report under another name before a run that would overwrite it.
