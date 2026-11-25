# What the longer own-article read does to research facts (hand-read, 2026-11-25)

A record, not a plan: the hand-read the owner asked for on 2026-11-25 ("so we can have data on what the longer text is really doing, for future reference"). Summarized in `.context/eval-baselines.md`. Read by agents (one reader per half-report, a second trying to overturn each verdict), no paid call.

**Runs.** A = tune half, own article cut at 4,000 characters, 8 facts (57 changed). B = tune half, read to 12,000, 12 facts (79 changed). C = judged half, read to 12,000, 12 facts (64 changed), commit 46ab57b2. Each sample is 300 facts. All 200 changed facts were located (130 own-article supports found exactly in the uncut article, 2 after levelling whitespace and quotes) and read against the article where it was at hand.

**In short.**
- **The rise is mostly not error:** of the 22 extra changed facts in B, 4 are real errors, 6 are right by the article and 12 are the judge calling an omission a change.
- **The deep text is not the source:** only 3 of B's 79 changed facts have a support starting at or beyond character 4,000, and none of the 13 such facts read in B and C (37 deep facts sampled in all) is a real error.
- **The longer read can ship as is.** The errors worth fixing are the same in A, B and C and do not depend on article length: a reporter's own words credited to a named speaker, and record fields holding figures or marks the source does not give.

## 1. Verdicts per run

| Verdict | A | B | C |
|---|---|---|---|
| Real error | 11 (3.7%) | 15 (5.0%) | 11 (3.7%) |
| Right by the article | 14 (4.7%) | 20 (6.7%) | 9 (3.0%) |
| Judge too strict | 29 (9.7%) | 41 (13.7%) | 41 (13.7%) |
| Unclear | 3 (1.0%) | 3 (1.0%) | 3 (1.0%) |
| Changed, total | 57 (19.0%) | 79 (26.3%) | 64 (21.3%) |

Shares are of the 300 sampled facts. Real errors that would mislead a reader: A 0, B 1, C 0 (minor: 8, 11, 10). The one (B29) credits Trump with the reporter's phrase that the blockade "would test an already fragile ceasefire", from a 3,115-character article, so the longer read plays no part.

## 2. A against B

| | A | B | Change |
|---|---|---|---|
| Real error | 11 | 15 | +4 |
| Right by the article | 14 | 20 | +6 |
| Judge too strict | 29 | 41 | +12 |
| Unclear | 3 | 3 | 0 |

| Source | Verdict | A | B |
|---|---|---|---|
| Own article (27, then 52 changed) | Real error | 4 | 11 |
| | Right by the article | 7 | 17 |
| | Judge too strict | 16 | 24 |
| Other sources (30, then 27 changed) | Real error | 7 | 4 |
| | Right by the article | 7 | 3 |
| | Judge too strict | 13 | 17 |
| | Unclear | 3 | 3 |

Confirmed real errors as a share of sampled facts (a floor: only flagged facts were read):

| Group | A | B | C |
|---|---|---|---|
| Own, support starts before 4,000 | 4 of 150 (2.7%) | 11 of 182 (6.0%) | 10 of 213 (4.7%) |
| Own, support starts at 4,000 or beyond | none sampled | 0 of 13 | 0 of 24 |
| Other sources | 7 of 150 (4.7%) | 4 of 105 (3.8%) | 1 of 63 (1.6%) |
| All | 11 of 300 (3.7%) | 15 of 300 (5.0%) | 11 of 300 (3.7%) |

- **Own-article real errors rose in early text, 4 to 11.** Seven facts; the cause cannot be told apart: the change redid every extraction call (schema renamed, `<REQUEST>` block added) and raised the limit from 8 to 12 at once. By extraction order, 9 of B's 11 are facts 1 to 8 (C: 9 of 10), so the extra slots explain little. C's 10 of 213 sits between A and B. Separating it would need a paid run: 12,000 characters with 8 facts, or the old text with the new prompt.
- **The judge's one-sentence blind spot grew, not through deep text:** own-article "right by the article" went from 7 to 17, all with support before 4,000; 16 of the 17 are credit flags where the speaker is named a sentence or two earlier, or the article is an organization's own text. 13 of them come from four articles: more facts per article means more hits on the same blind spot.
- **The sample shifted toward own articles:** 150, 195 and 237 of 300 in A, B and C. Pools: own-article facts 193, 252 and 360; own facts starting at or beyond 4,000: 0, 16 and 41.

## 3. What deep-article facts get wrong

Nothing confirmed. The 13 changed facts with support at or beyond 4,000 (3 in B, 10 in C) are 12 judge-too-strict and 1 right by the article; what the judge flags there is omission (a clause left out, when something was said dropped).

All 37 real errors across the three runs, by kind:

| Kind | Origin | A | B | C | Total |
|---|---|---|---|---|---|
| Credit: the outlet's own words given to a named speaker, or the wrong body | statement 9, credited-to field 4 | 1 | 7 | 5 | 13 |
| Figure the source does not give ("1 deal", "2 rounds", "7 continents", a range for "hundreds of thousands") | record figure or counts | 3 | 3 | 2 | 8 |
| Statement shifts strength or timing (hedge dropped, modal weakened, a date moved) | statement | 5 | 2 | 1 | 8 |
| "Estimate" or "provisional" mark unwarranted | record flag | 1 | 1 | 2 | 4 |
| Place names a country the fact is not about | record place | 0 | 2 | 0 | 2 |
| As-of wrong by the field's own rule | record as-of | 1 | 0 | 1 | 2 |

Statement 17, record fields 20.

## 4. The judged half

The same picture on other stories: deep facts are flagged more often (10 of 24 against 43 of 213) but none is wrong; real errors at A's level (11 of 300); the same kinds (credit 5 of 11, four of them the outlet's background credited to a body); judge too strict 41 of 64.

## 5. What follows for research, ranked by what it would fix here

1. **Credit only what the source attributes.** A named speaker gets, in the statement and the credited-to field, only the words the article gives them; the outlet's asides and characterizations are stated plainly. 13 of 37, including the only misleading one.
2. **A figure only where the source prints a quantity for the stated claim.** No "a deal" as 1, no ordinals, no worked-out counts or invented ranges. 8. (The figure check should catch these and did not at `low`: worth reading why.)
3. **Settle "estimate" and "provisional" in one place.** The extraction schema sets the flag for planned figures, the rendering prints "estimate", and the drift judge counts that as changed. Align the three; a figure the source states plainly gets no mark. 4, and a group of false flags.
4. **Stop the drift judge counting omission as change.** 111 of 200 flagged facts are "too strict", nearly all a clause left out. One line in the judge's prompt (a fact may take one claim of a sentence) would cut the changed count by about half and make the measure usable. It changes the measure, so the baselines need re-running.
5. **Give the judge what one sentence lacks:** the source's outlet and title (an organization's own text has no naming sentence) and its publication date. 43 of 200 flagged facts are right by the article. If production's fact check reads the support alone, it shares the blind spot (not checked).
6. **Let the second support sentence be the naming sentence** where the speaker or the antecedent of "it" is in the sentence before. Makes facts checkable; fixes no real error.
7. **Carrying speaker and date into the statement from earlier paragraphs already happens and is mostly right** (43 times). No new instruction; the risk is the reverse case in 1.
8. **Smaller record rules:** place is where the fact is about, not who requested or hosted it; as-of is empty when the only date belongs to another thing. 4.

## 6. Limits

- Only flagged facts were read; errors the judge passed are not counted (the readers met several such weaknesses).
- Small counts: the A to B difference in real errors is 4 facts. No significance claim.
- A and B differ in more than the text length (every extraction redone, schema renamed, `<REQUEST>` block, fact limit, cluster and neighbour texts ending at a sentence); the other-source difference includes resampling.
- Other-source articles were often not at hand: 9 facts stay unclear, and some right-by-article verdicts rest on a cached page of the same release.
- One reader's verdicts, checked by a second that overturned some both ways; the line between "real error, no harm" and "too strict" is a judgment.
- One B extraction (a search source in the El Fasher UN story) is not in the cache; answered as a failed call, all 79 lines match.
- A and B are the tune half, C the judged half: C confirms the pattern, not the numbers.

Per-fact data (source, offset, verdicts) was kept on the owner's machine in `DOCS/2026-11-25_longer-text-hand-read/`, which is not in the repository.
