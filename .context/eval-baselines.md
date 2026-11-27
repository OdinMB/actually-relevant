# Eval baselines

The measured results a later change is compared against. One section per baseline, newest first; a section is replaced only by a newer run of the same command, and says which commit it was measured on. How the evals work, their flags and bars: `model-eval.md`. The reports and the caches that make reruns free are not in the repository: they live in `DOCS/` on the machine that ran them, so on another machine every run is paid in full.

## Research passes' `update` gate, 2026-11-27

Run in a cloud session on branch `claude/project-thread-egeer5` at commit 15289bf2 (the update eval's fixture, scorer and note-judge fixes; production code unchanged since 2026-11-26) against the 11-month stories-only eval copy exported 2026-11-27 (`database-migrations.md`, "A Stories-Only Copy for Cloud Evals"), under the task cap `gate-update-2026-11-27` ($5). Command: `eval:overviews -- --out ../DOCS/2026-11-27_update-gate --steps pass-pool,update --half judge --repeat 3 --budget 5 --cap gate-update-2026-11-27`. Cases: 6 key, 13 wrong-number, 3 wrong-year, 13 benign from 13 stories (4 of 17 had no first-pass version; 49 planted values refused by the sanity check). Replaces the `update` table of 2026-11-26 below.

| Measure | Bar | 2026-11-26 | 2026-11-27 | Verdict |
|---|---|---|---|---|
| Expected changes flagged on the right section | ≥ 90% | 68.8% | 85.1% (82.8–86.2%) | missed |
| False rewrites | ≤ 10% | 4.5% | 2.9% | met |
| Unchanged sections byte-identical | 100% | 100% | 100% | met |
| Planted contradictions demoted | ≥ 90% | 48.3% | 91.7% (87.5–93.8%) | met |
| False demotions | ≤ 5% | 1.0% | 1.0% | met |
| Notes accurate and complete | ≥ 90% | 61.7% | 63.2% | missed |
| Notes the fact check found unsupported | none | 2.3 a run | 2.7 a run | missed |
| Notes' copying share less the sections' | ≤ 0 | +2.7 points | −3.0 points | met |

- **Flagged:** every miss is a `key` case, the same four in every run (a later development the pass does not write into the story: DRC cases top 4,000; UN warns on fossil fuels; Iran facility struck; UN on strikes in southern Lebanon). Production's later-pass judgment, or a turning point another story's key names that this story need not carry; not yet told apart.
- **Notes:** production. Most short notes call a correction a rise ("rose to 6,080 from 4,053") although the planted fact holds the same as-of as the one it corrects; the rest omit a removed or added paragraph, or credit a claim to the wrong source.
- **Cost:** $2.43 (1,375 model calls, 110 Tavily searches), the whole run paid since no cache was here.

## Research passes' gate, 2026-11-26

Run on branch `claude/project-thread-egeer5` at commit eb07a5f0 (production code as at 46ab57b2: nothing under `prompts/`, `schemas/`, `services/` or `config.ts` changed since but DB tests) against the local copy of production of 2026-11-19. First runs of the `context` step against gap keys (drafted and checked the same day, a6a73f8d) and of `update` on the eval's own first passes (eb07a5f0). **No bar of the research-pass gate is met yet**: `research_pass` stays disabled.

### `eval:research` (30 newest published stories, 1 run)

No comparison is possible: the 2026-11-13 own-words baseline was never recorded (its commits say "Not run"), so these numbers are the first baseline of the first pass's article path. Kept 13 of 30, the draft used in 20 (research-rating 6, stale 1), fallbacks 10 (failed check 9: Story paragraph 1 six times, five of them copying flags; no usable source 1). Repair round on 27 of 29 drafts. First-draft flags over 305 items: fact/judge 77, close rendering 37 (12%), statement 21 (7%), follows 15, wording 7. Longest shared run at 12+ words: wording 2%, statement 7%. Model cost $0.0160 a story (research steps $0.0109, card steps $0.0052), 3.9 Tavily credits a story; $1.42 in all. Verdict: **for the owner** (no baseline to regress against; a third of stories falling back is the number to judge).

### `context` (13 judged gap keys × 3 runs) and the fact check on its facts

| Measure | Bar | Result | Verdict |
|---|---|---|---|
| Must needs not in the story met by kept cards | ≥ 60% | 3.7% | missed |
| Wasted searches a story | ≤ 1 | 1.67 | missed |
| Response card where findable | ≥ 70% | 33% (one findable story) | missed (n = 1) |
| Box items found unsupported | none | 4.3 a run | missed |
| Notes `model` places that add to the text | ≥ 85% | 97.8% | met |
| Cost a story, the whole first pass at flex | ≤ $0.20 | $0.043 | met |
| Figure facts with every structured field right | ≥ 95% | 57.7% (wrong: place 44, asOf 36, value 29, counted 28, credited 28 of 300) | missed |
| Invented numbers the fact check passed | none | 19 | missed |
| Planted errors caught / correct facts rejected | ≥ 90% / ≤ 5% | 93.4% / 7.5% | caught met, rejection missed |
| Faithful to the source, with / without a figure | report only | 82.0% / 72.7% | report only |

- **The main cause is in production:** context searches use Tavily's general topic, whose results carry no date (430 of 430 undated), the structure step gives a definition an empty as-of, so `isCurrent` reads every such fact as expired and the write prompt allows it only as a dated past value. Explainer facts found (NATO's Article 5, Bundibugyo, AMR) never reach a card: every key-term must need and most wasted searches. Next: the gap list marks slots covered that the story only touches, with generic queries; the fact check rejects facts whose structure-step place or credit was invented.
- **Judge strictness is secondary:** flipping every near-miss verdict lifts needs met to about 10%. About 9 of the 13 unsupported box items are a qualifier the card or story supplies; about 3 are real.
- The response bar rests on one findable story; the needs judge sees no box headings and is not told cards show their sources.

### `update` (17 judged stories, up to 59 cases × 3 runs)

| Measure | Bar | Result | Verdict |
|---|---|---|---|
| Expected changes flagged on the right section | ≥ 90% | 68.8% (58.1–77.4%) | missed |
| False rewrites | ≤ 10% | 4.5% | met |
| Unchanged sections byte-identical | 100% | 100% | met |
| Planted contradictions demoted | ≥ 90% | 48.3% | missed |
| False demotions | ≤ 5% | 1.0% | met |
| Notes accurate and complete | ≥ 90% | 61.7% | missed |
| Notes the fact check found unsupported | none | 2.3 a run | missed |
| Notes' copying share less the sections' | ≤ 0 | +2.7 points | missed |

- **Mostly the fixtures and the scorer:** `wrong-number` plants on rising counts (cases 3,000 → 4,500) are, by the judge prompt's own rule, a newer value that supersedes, and the planted fact carries no as-of the judge can see, so it flags without demoting (wrong-number demoted 10 of 33, wrong-year 19 of 27); other plants are nonsense ("March 33", "100% → 150%", "2015–16 → 2015–24"). A `key` case requires the turning point's own fact in a rewrite even when newer facts of the same window found it or the story already states it (13 of 29 misses). The note judge is not shown the note's own facts or the contradicting ones, and marks the fixed line incomplete by design; the wire source's only text is the planted statement, so a faithful note copies it.
- **Real production issues:** rewrites state a publication day as a figure's as-of ("on July 22"), which drives most `update_failed`; one judge decision flips between runs (the Philippines' wrong year, 8 misses). Rough recount without the scorer's turning-point rule and the malformed plants: flagged about 87%.

### Cost

$10.85 in all: `eval:research` $1.42, gap-key drafts $1.24, `context` folder $5.72 (smoke and gate), `update` folder $2.47.

### Commands

From the repository root, each after its `npm run … --prefix server --`.

| What | Command |
|---|---|
| Research | `eval:research -- --out ../DOCS/2026-11-26_research-eval --budget 3.5` |
| Gap-key drafts | `eval:overviews -- --out ../DOCS/2026-11-26_gap-drafts --steps gap-draft --budget 2.3` |
| Context gate | `eval:overviews -- --out ../DOCS/2026-11-26_story-context-eval --steps context,fact-check --facts context --half judge --repeat 3 --budget 10` |
| Update gate | `eval:overviews -- --out ../DOCS/2026-11-26_update-eval --steps pass-pool,update --half judge --repeat 3 --budget 10` |

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
