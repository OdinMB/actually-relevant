# GPT-6 migration, phase 1: batch-drop fix, effort plumbing, model eval harness

- **Date**: 2026-09-24
- **Status**: implemented (code and harness); the paid eval run and rating deliverable are still to do (see Implementation notes)
- **Type**: feature
- **Complexity**: complex

## Problem

The gpt-5-nano and gpt-5-mini snapshots behind the small and medium tiers shut down on 2026-12-11. Three things block moving those tiers to gpt-6-luna and deciding whether the large tier moves to gpt-6-sol:

1. **Articles are silently dropped from classification batches.** `formatArticlesBlock` (`server/src/prompts/shared.ts`) starts `capacity` at the batch size (10) and decrements it *before* the `capacity > 0` check, so the 10th article of a full batch brings it to 0 and never reaches the prompt. Han-script articles cost 1.5, so any batch containing Chinese text loses one or more trailing articles as well. Batches are already cut by count upstream (`runBatchClassification`, `backfill-emotion-tag.ts`), so the counter can only discard, never re-batch. Pre-assess re-sends the dropped story on the next run and pays twice. Reclassify and emotion-tagging leave it unprocessed and report only a generic "not returned" failure.
2. **Reasoning effort never reaches gpt-6-\* models, and cannot be configured.** `@langchain/openai` (1.2.3 installed, 1.5.13 latest) forwards `reasoning: {effort}` only for `/^o\d/` and `gpt-5*` IDs (`dist/utils/misc.js` `isReasoningModel`). Effort is also hardcoded `medium` for every tier. Once small and medium both run Luna, effort is the only difference between the tiers.
3. **No model choice has ever been measured.** Every LLM test mocks the model. There is no golden set and no token logging. The owner wants automated checks to decide the classification and extraction call sites, and small blind-rated sets for the call sites that are a matter of taste. The large tier is included: nothing shows gpt-5.2 beats gpt-6-sol. The earlier "stay" argument cited a regression measured against GPT-5.6 Sol, not against 5.2.

## Approach

Three commits in this order. **Production defaults do not change.** Every tier keeps today's model and `medium` effort unless an env var overrides it. Phase 2 (not this plan) flips the defaults after the owner has rated the sets.

**A. Fix the drop at its cause (commit 1).** `formatArticlesBlock` renders every story it receives. The capacity counter and the Han-script 1.5 weighting go. The callers already control batch size (`config.preassess.batchSize`). The worst case is 10 Han-script articles at 1,200 chars each, roughly 12–15K input tokens. That fits every tier's context window and costs under $0.002 per batch at Luna prices. `containsChineseCharacters` stays exported because the eval uses it for stratification.

**B. Effort plumbing (commit 2).**
- `config.ts` exports a `ReasoningEffort` type and a small `parseEffort(value, fallback)` helper. Each tier's `reasoningEffort` is `parseEffort(process.env.OPENAI_EFFORT_<TIER>, 'medium')`. **Do not use the bare-cast pattern (`extractionApi`) here**: a typo such as `OPENAI_EFFORT_SMALL=lo` would reach the API and 400 every call on that tier. `parseEffort` returns the fallback for unset/empty and throws at startup for anything outside the `ReasoningEffort` list, naming the variable.
- `llm.ts` gets one exported factory, `createChatModel(spec)`, which returns `new ChatOpenAI({ model, modelKwargs: { reasoning_effort }, maxRetries: 3 })`.
  - The three tier getters use it, and the `reasoning` option is removed.
  - It throws for combinations the API is documented to reject: `minimal` on any non-`gpt-5*` ID (GPT-6 rejects it), `none` on `gpt-5-mini`/`gpt-5-nano`. Fails loudly at construction instead of as a fire-and-forget log line.
  - Verified in `dist/chat_models/completions.js`: `modelKwargs` is spread into the request params. `_getReasoningParams` returns nothing when `reasoning` is unset, so gpt-5 models get the same request parameters as today (`reasoning_effort: "medium"`; only the JSON key order differs).
  - Verified in `dist/chat_models/index.js`: `withStructuredOutput` goes through `withConfig`, which rebuilds the model with `new ChatOpenAI(this.fields)`, so constructor `modelKwargs` survive it. A test pins this (see Tests), because it is the path every call site actually uses.
  - The doc comment states the GPT-6 rules: never add `temperature`/`topP`/`maxTokens`, because GPT-6 rejects sampling params above effort `none` and LangChain would send `max_tokens` for gpt-6-\*. `minimal` is rejected by GPT-6. Never use `method: 'functionCalling'`, because GPT-6 Chat Completions tools only work at effort `none`; `withStructuredOutput` defaults to `response_format` json_schema, which is fine.
- The four backfill scripts replace their own `new ChatOpenAI(...)` with the tier getters (`getMediumLLM()` for title-label and relevance-summary, `getSmallLLM()` for quote-attribution and emotion-tag). Add `import 'dotenv/config'` as each script's **first** import (the `seed-jobs.ts` pattern). Reason: `config.ts` reads `OPENAI_MODEL_*` and the new `OPENAI_EFFORT_*` when it is *imported*, not when the getter runs, so these scripts currently rely on whatever loads `.env` as a side effect of importing `@prisma/client` first. An explicit first import makes the new effort variables apply deterministically.
- `server/package.json` declares `"openai": "^6.17.0"`, the lockfile-resolved version already used by `embedding.ts` (6.17.0 is installed). Sync the lockfile with `npm install --package-lock-only --ignore-scripts --prefix server`: it does not touch `node_modules`, so it cannot trip the Prisma engine DLL lock while the dev server runs. Then `git diff server/package-lock.json` must show only the root `dependencies` entry gaining `openai`; if npm rewrote anything else, `git checkout -- server/package-lock.json` and add the one line by hand with Edit.

**C. Eval harness (commit 3).** A module family under `server/src/scripts/eval/`, run with `npm run eval:models --prefix server -- ...`.
- It samples stored data through a **read-only DB session**.
- It calls the app's **prompt builders, Zod schemas and `createChatModel`** directly. That means the eval exercises the exact production wire format, including the new modelKwargs path. It never calls a service function that persists.
- It writes `results.md`, `rating-sets.json` and `rating-key.json` into `--out`. The run step passes `../DOCS/2026-09-24_gpt6-eval` (resolves to `D:/projects/actually-relevant/DOCS/2026-09-24_gpt6-eval/`, gitignored). A response cache and spend ledger go in `<out>/.cache/`.
- **This phase ends with the owner's rating deliverable on disk.** Phase 1 builds everything up to the owner's blind rating, so the sequence is dry run → smoke run (under $0.01) → full live run (budget-guarded, ≈ $7–10, hard stop at $18) → deliverable validation → fabricated-number spot check written into `results.md`. Only the production-default flip waits for Phase 2.

**Alternatives considered**
- *A:* Fix only the off-by-one. Rejected: batches containing Chinese text would still drop their last articles, and in a 5-language corpus that is most batches. Move weighted capacity into batch formation. Rejected: it needs article content before batches are formed (they are loaded lazily per batch for memory) and restructures `runBatchClassification` for a guard nothing needs at today's context sizes.
- *B:* Keep `reasoning` and add `modelKwargs` only for non-gpt-5 IDs. Rejected: two code paths for one setting. Upgrade `@langchain/openai`. Rejected: 1.5.13 has the same `isReasoningModel`. Patch `isReasoningModel`. Rejected: it breaks silently on the next upgrade. Per-call-site effort keys. Rejected: more config surface for about $1/month of savings. Phase 2 can add them if the eval shows pre-assess and assessment need different efforts on the same tier.
- *C:* A single script file. Rejected: it becomes a god file and the metric logic cannot be tested. Refactor the eight services so prompt-input shaping is separate from persistence, and inject the model so the eval runs real service code. Rejected: strongest fidelity, but it touches production code in a phase that must not change production behaviour, and it relies on a "don't write" mode inside persisting functions, which is exactly what the eval rules forbid.

**Named tension (Simplicity vs Architecture).** The harness re-implements thin prompt-input shaping for each call site: DB row → builder input, a few lines each, commented with the production function it mirrors. That duplication is the price of not touching the services. It is acceptable here because both arms always receive the *identical* prompt, so the comparison stays fair even if shaping drifts slightly from production. The debt and the trigger for paying it are listed under Out of Scope. Two pure helpers that encode business rules are exported instead of copied: `calcMaxBlurbChars` in `bluesky.ts` and `mastodon.ts`.

### Eval design

**Arms** are `model@effort` pairs. Candidate and baseline model IDs are constants in `models.ts`, not read from `config`, so an env override on the machine running the eval cannot silently change the baseline. GPT-6 rejects `minimal`, and gpt-5-mini/nano reject `none`. The arms respect both rules.

| Suite | Call sites covered | Fixture (read-only, deterministic) | Arms | Automated metrics | Outcome |
|---|---|---|---|---|---|
| `preassess` | pre-assessment; reclassify and emotion-tag by proxy (same classification task) | 300 stories with `relevance_pre` set, crawled on or after 2026-03-01. Stratified by `feed.language` across all languages present; ≥50 Han-script; ≥60 with status `published`. Chunked into 30 batches of 10 | gpt-5-mini@medium (rerun), gpt-6-luna@medium, gpt-6-luna@low | agreement with the stored issue slug, emotion and ≥5 gate, per arm and for the mini rerun (noise floor); recall of published stories at the gate; ≥5 pass rate; omitted/unknown article IDs per batch; invalid slugs; failures; foreign-script junk | automated |
| `assess` | full assessment | 50 assessed stories crawled on or after 2026-03-01: ≥25 with stored relevance 4–6, ≥10 non-English, ≥5 Han-script, the rest spread across issues | gpt-5-mini@medium, gpt-6-luna@medium, gpt-6-luna@high | format checks (below); rating vs the mini rerun (mean absolute difference, mean shift, ≥5-split agreement); mini rerun vs stored (noise floor); unsupported numbers; junk; failures | automated gates, then taste set (12) |
| `dedup` | dedup confirmation | 120 source sets: 50 sources that are cluster members, 50 unclustered sources with the closest top-1 neighbour (hard negatives), 20 random unclustered. Candidates are the 6 nearest by embedding among assessed stories (statuses analyzed/selected/published/rejected, so auto-rejected duplicates stay in) crawled in the 14 days before the source. About 700 pairs | gpt-5-nano@medium, gpt-6-luna@low, gpt-6-luna@medium; judges gpt-5.2@high and gpt-6-sol@high on disputed sets only | FP rate, recall, per-pair agreement, missing or out-of-range candidate numbers, failures; agreement with cluster membership (secondary) | automated |
| `related` | related-stories re-rank | 30 published stories with embeddings; the production query (12 nearest published) | gpt-5-nano@medium, gpt-6-luna@low, gpt-6-luna@medium; **concurrency 1** | exact-4 compliance (valid, unique), overlap with nano's picks, p50/p95 latency | automated |
| `social` | social pick; social post text | *Pick:* the last 10 days with a published Bluesky or Mastodon post. Candidates are stories published in the 25 h before the post and not yet posted at that time; the stored pick is the posted story. If no posts exist, use 10 synthetic daily windows with no stored pick. *Post:* 20 published stories, 10 Bluesky and 10 Mastodon | gpt-5-mini@medium (rerun), gpt-6-luna@medium | pick: valid-ID rate, agreement with the stored pick and between arms. Post: raw drafts over `maxChars` **before** the ellipsis trim, URL/hashtag/@mention violations, title repeated verbatim, em dashes, junk | pick automated; post → taste set (10) |
| `large` | editorial selection, newsletter selection, newsletter intro, podcast script (all share `OPENAI_MODEL_LARGE`) | 20 historical selection groups (below); the 4 most recent newsletters with a longlist and a selection; the same 4 for intros (stored selected stories, one intro style drawn once per newsletter with `pickIntroStyle()` and stored in the fixture); the latest podcast's story list, or failing that published/selected stories from the last 7 days | gpt-5.2@medium (rerun), gpt-6-sol@medium | selection: exact count, valid/unique IDs, empty or declined responses, overlap (Sol↔5.2 rerun, each↔stored), uplifting share. Newsletter selection: per-issue counts, uplifting share, overlap. Intro: under 60 words, 2–3 sentences, banned phrases ("this week", "in this edition", "you", "dear reader"), em dashes, markdown. Podcast: share of sentences over 12 words, publisher coverage, markup. All: failures, junk | automated compliance gate, then taste sets: selection (the 5 groups with the most disagreement), intros (4), podcast (1) |

**Selection groups.** Eligible stories:
- relevance ≥ `config.selection.relevanceMin`;
- status `selected`, `published` or `rejected`;
- not a non-primary cluster member;
- crawled in the last 90 days.

Bucket them by UTC crawl date, keep days with at least 8 eligible stories, and apply `splitIntoGroups(bucket, config.selection.maxGroupSize)` from `lib/utils.ts`. Take 20 groups deterministically, with `toSelect = ceil(n × config.selection.ratio)`. The stored decision (selected/published = picked) is approximate, because admin edits and later dedup rejections blur it. `results.md` says so.

**Assessment format checks** (from the verified recommendation):
- exactly 4 factors, 1–4 limiting factors, 3–5 calculation bullets;
- summary 40–70 words; relevance summary 20–25 words;
- title ≤10 words, with no leading "Label: headline" colon;
- label 1–3 words, with no "and";
- no shared non-stopword between label and title;
- blurb ≤230 chars;
- factors start with `- **...:**`;
- `publicationDate` matches `YYYY-MM-DD 00:00:00`.

**Junk scan.** Flag any character outside the Latin, Common and Inherited scripts in any string output field, except fields that echo IDs. Outputs are English by contract, and the quote must be translated.

**Unsupported numbers.** Extract numeric tokens from summary, factors, limiting factors, relevance summary and blurb, normalising `1,200`/`1200`, `%` and `$`. Report those absent from the article text the model saw, as a rate per arm, and list them in `results.md` for the run step's 10-output spot check.

**Decision rules.** "Noise floor" means the baseline model's own rerun measured against stored values. An absolute bar is relaxed to *noise floor − 5 points* only when the baseline rerun itself misses that bar. For each call site, the winner is the lowest-effort candidate arm that passes. If none passes, `results.md` reports "no automated winner" with the failing checks.
- *Pre-assess:*
  - issue, emotion and gate agreement with stored values ≥ 85% / 80% / 85%, or the relaxed bar;
  - ≥95% of published stories still pass the gate;
  - ≥5 pass rate within ±20% (relative) of stored;
  - omissions and failures ≤ the mini rerun's;
  - zero junk.
- *Assess (automated gate before rating):*
  - per-check format compliance ≥ the mini rerun's − 5 points;
  - mean absolute rating difference vs the mini rerun ≤ 1.0;
  - mean shift within ±0.5;
  - ≥5-split agreement ≥ 85% (relaxed bars apply);
  - unsupported-number rate ≤ 1.5× mini's;
  - zero junk; failures ≤ mini's.
  - The taste set shows mini vs the lowest passing Luna effort. If neither Luna arm passes, it shows Luna@high and `results.md` flags this.
- *Dedup:* FP rate ≤ nano's, and recall ≥ nano's − 5 points.
- *Related:* exact-4 compliance ≥ nano's, and mean overlap with nano's picks ≥ 50%. p95 latency is reported next to the result.
- *Social pick:* valid-ID rate 100%. Agreement is reported as information only.
- *Social post:* raw over-limit count ≤ mini's and zero forbidden-content violations, then the owner rates.
- *Large tier:*
  - Sol exact-count compliance is 100% on editorial selection (or ≥ the gpt-5.2 rerun's, if the rerun itself misses 100%; same noise-floor principle as elsewhere) and ≥ gpt-5.2's on newsletter selection, with zero failures and zero empty/declined responses beyond gpt-5.2's. Sol's known risk is declining more often on "pick exactly N" prompts, so compliance is the gate. Intro hard rules (under 60 words, 2–3 sentences, banned phrases, em dashes, markdown) and the podcast >12-word-sentence share must each be ≤ gpt-5.2's violation count.
  - The owner then rates the selection disagreements, intros and podcast.
  - `results.md` answers the owner's question "is 5.2 better in any way?" directly: a short list of every automated metric on which the gpt-5.2 rerun beats Sol (or "none"), next to the cost difference.
- *Per-tier recommendation* (for Phase 2):
  - small effort = the lowest effort that passes dedup, related and pre-assess at that effort (the proxy for reclassify);
  - medium effort = the lowest effort that passes pre-assess, the assess gates and social pick;
  - large = gpt-6-sol@medium if its gate passes, pending ratings.

**Dedup labels.** A pair's label is the unanimous verdict of the three arms. Where the arms disagree on any pair in a set, both judges assess the whole set with the unchanged `buildDedupPrompt`. The judges' verdict labels the disputed pairs. Pairs the judges split on are excluded and counted.

**Rating deliverable.** Written to `DOCS/2026-09-24_gpt6-eval/` in this phase. `rating-sets.json` has exactly this shape and nothing else:

```json
{"project":"actually-relevant","sets":[{"id":"<project>-<slug>","title":"<plain title>","instructions":"<one or two sentences>","items":[{"id":"<set id>-01","context_md":"<markdown>","options":[{"label":"A","type":"text","content_md":"<markdown>"},{"label":"B","type":"text","content_md":"<markdown>"}]}]}]}
```

All options in this project are `"type":"text"` (no image call sites). Set IDs, caps equal to the owner's budget, and the item-picking rule (deterministic, by `sha256(itemId)` within each stratum):

| Set ID | Title / instructions (gist) | Max items | Which items |
|---|---|---|---|
| `actually-relevant-full-assessment` | "Story assessments": which analysis is more accurate, better supported by the article, and closer to the house format? | 12 | Prefer stories where the two arms' ratings differ; at least 3 non-English and 1 Han-script if available; the rest from the 4–6 band |
| `actually-relevant-social-post` | "Social post text": which post would you rather publish unedited? | 10 (5 Bluesky, 5 Mastodon) | Prefer drafts where either arm broke a hard rule, then the rest |
| `actually-relevant-newsletter-intro` | "Newsletter intros": which opening is better for this edition? | 4 | The 4 fixture newsletters |
| `actually-relevant-podcast-script` | "Podcast script": which script would you rather record? | 1 | The one fixture |
| `actually-relevant-story-selection` | "Story selection": which set of picks is the better editorial choice for this group? | 5 | Only groups where Sol and the 5.2 rerun differ, lowest Jaccard first; fewer than 5 if fewer differ |

Items are numbered `<set id>-01`, and so on. Every item has 2 options: baseline and candidate.
- **Label order.** Labels are assigned by sorting arms on `sha256(itemId + ':' + armKey)`.
- **Output rendering.** Text outputs are reproduced verbatim, and JSON outputs are rendered as markdown:
  - assessments: label and headline, summary, quote with attribution, factor, limiting-factor and calculation bullets, "Rating N/10", relevance summary, blurb;
  - selections: the chosen titles in candidate order.
- **Context shown to the rater.** `context_md` holds the input the rater needs:
  - assessment: title, publisher, URL, and the ≤4,000-char article text the model saw;
  - social post: platform, character limit, title, summary, "why it matters";
  - intro: the style line and the selected stories;
  - podcast: the story list;
  - selection: "pick N of M" plus the numbered candidates with title, emotion, rating and summary.
- **No model names.** `rating-sets.json` contains no model names anywhere. A build-time check scans set titles, instructions, item IDs and option content for every model ID in `MODELS` plus the words `gpt-`, `Luna`, `Sol`, `nano` (case-insensitive, word-bounded), and fails the build on any hit, except where the same token also appears in that item's `context_md` (news stories may legitimately mention GPT models, and "sol" is Spanish).
- **Answer key.** `rating-key.json` maps `{"<item id>": {"A": "<model>@<effort>", "B": "..."}}`.
- **Images.** This project has no image call sites, so `images/` is not created. `results.md` says so.

**Cost and budget.** Estimates use the inventory's per-call token assumptions: +25% output for Luna, and effort scaling of low ×0.4 and high ×1.5.

| Suite | Estimate |
|---|---|
| preassess | ≈ $0.27 |
| assess | ≈ $0.75 |
| dedup arms | ≈ $0.35 |
| dedup judges (assuming 15–40% of sets disputed) | ≈ $1.5–3.7 |
| related | ≈ $0.06 |
| social | ≈ $0.14 |
| large tier | ≈ $4.0 |
| **Total** | **≈ $7–10**, cap $20 |

Guards:
- `--dry-run` prints a per-suite estimate (input tokens ≈ Latin chars/4 plus Han chars/1) without calling the API.
- A live run refuses to start a suite whose estimate exceeds the remaining budget.
- A live run stops live calls once the ledger total reaches `--budget`. The default is 18, and values above 20 are refused.

**Prices** (per 1M tokens: input / cached / output) live in `models.ts`.

| Model | Price | Source |
|---|---|---|
| gpt-5-nano | 0.05 / 0.005 / 0.40 | brief |
| gpt-5-mini | 0.25 / 0.025 / 2.00 | brief |
| gpt-5.2 | 1.75 / 0.175 / 14.00 | **from memory, not in the brief**; `results.md` marks it unverified |
| gpt-6-luna | 0.10 / 0.01 / 0.50 | brief |
| gpt-6-sol | 2 / 0.20 / 10 | brief |

GPT-6 bills cache writes at 1.25× input. The harness bills uncached GPT-6 input at that rate, a conservative upper bound, because Chat Completions usage does not report cache writes separately.

**Monthly projection.** Measured mean $/call × the inventory's monthly volumes, stored as `VOLUMES` in `resultsReport.ts` with the source noted:

| Call site | Calls/month |
|---|---|
| preassess | 700–1,700 |
| assess | 1,200–4,500 |
| dedup | 1,200–4,500 |
| related | 300–3,000 |
| social pick | 30 |
| social post | 30–60 |
| editorial selection | 30–90 |
| newsletter selection | 4–5 |
| newsletter intro | 4–5 |
| podcast | 0–4 |
| embeddings | unchanged, $0.01–0.02 |

`results.md` gives current vs proposed per call site and in total.

**`results.md` contents** (plain language, one section per call site): the arms tested; automated metrics (quality checks, agreement with baseline and with stored values, failure / parse-failure / empty-or-declined / truncated / junk rates); p50/p95 latency for every call site, not only related stories; mean input, cached, output and reasoning tokens and $ per call, and $ per month at the inventory volumes; the automated verdict for non-taste call sites (winner arm plus the evidence) or "no automated winner" with the failing checks; which call sites await the owner's rating and in which set; the per-tier Phase 2 recommendation; the DB used (reported only as `local` or `remote` plus the fixture anchor date, never the URL); fixture shortfalls; the gpt-5.2 price marked unverified; and the eval's total API spend from the ledger.

**Metering and caching.** `ctx.call()` in `models.ts`:
1. Builds the model with `createChatModel`, applies `.withStructuredOutput(schema, { includeRaw: true })`, and invokes a single `HumanMessage`, as production does.
2. Records wall-clock latency, `usage_metadata` (input, cached `cache_read`, output, and `reasoning` tokens), `response_metadata.finish_reason` and the cost.
3. Classifies the outcome: `ok` | `parse_failure` (content present, `parsed` null) | `empty` (no content: refusal or decline) | `truncated` (finish_reason `length`) | `error` (thrown).

Transport retries come from ChatOpenAI `maxRetries: 3`. The call is deliberately **not** wrapped in `withRetry`, contrary to the project's usual rule for LLM calls. Parse failures and declines are the metric being measured, and production retries them at only one call site (newsletter).

Responses are cached in `<out>/.cache/calls.jsonl`, keyed by `sha256(armKey + schemaName + prompt)`. The same file is the spend ledger: re-runs and resumes never pay twice, and cached calls reuse their recorded latency. Fixtures are written once to `<out>/.cache/fixtures.json` and reused unless `--refresh-fixtures` is passed. That keeps prompts, and therefore cache keys, stable while the DB changes daily.

**Read-only DB guard.** `fixtures.ts` is the only module that touches the database, through its own client from `openReadOnlyDb()`:
1. Create `new PrismaClient({ datasourceUrl })` from `DATABASE_URL`, appending (with `?` or `&` as the URL requires) `connection_limit=1` and the URL-encoded `options=-c%20default_transaction_read_only%3Don`. If connecting with `options` fails (poolers can reject it), reconnect without it.
2. Assert that `SHOW transaction_read_only` returns `on`, and abort before any query if it doesn't.
3. **Fallback path (no `options`):** a session-level `SET` would be lost silently if Prisma reconnects mid-run, so instead run *all* fixture reads inside one interactive `$transaction(fn, { timeout: 300_000 })` whose first statement is `SET TRANSACTION READ ONLY`, followed by the same `SHOW transaction_read_only` assertion. Fixtures are loaded once and cached, so one long read transaction is fine.

After that, the module issues only `findMany`/`findFirst`/`$queryRaw` SELECTs. Deterministic sampling orders by `md5(id || 'gpt6-eval')`. Han-script stratification in SQL uses `substring(source_content, 1, 1200) ~ '[\u4e00-\u9fff]'` on an ID-only pool query, and content is loaded only for the chosen rows. `run.ts` has `import 'dotenv/config'` as its **first** import (like `seed-jobs.ts`; `config.ts` reads env at import time), and never prints `DATABASE_URL`, its host, or any other env value. It prints only whether the host is `local` (localhost/127.0.0.1) or `remote`.

**Time windows are anchored on the data, not the clock.** `DATABASE_URL` may point at a local copy that is weeks old. Every "last N days" window (90-day selection pool, 10 social days, 7-day podcast fallback) counts back from `anchor = max(date_crawled)` of assessed stories, read once and stored in `fixtures.json`. The fixed 2026-03-01 floor stays as is. If the anchor is more than 14 days before today, the dry run says so.

**No second write path.** The eval imports prompt builders, schemas, `config`, `lib/utils.ts` and exactly three service symbols: `createChatModel` (`services/llm.ts`) and `calcMaxBlurbChars` (`services/bluesky.ts`, `services/mastodon.ts`). Importing those two service modules constructs the app's read-write Prisma singleton (`lib/prisma.ts`) as a side effect, but nothing in the eval may use it. A static test enforces this (see Tests).

## Decisions

### DECISION: Pass reasoning effort to OpenAI through modelKwargs in one client factory
- **Affects**: model, architecture
- **Chosen**: `createChatModel` in `server/src/services/llm.ts` builds every ChatOpenAI (tier getters, backfill scripts, eval harness) and sends effort as `modelKwargs: { reasoning_effort }`; the `reasoning` constructor option is no longer used.
- **Alternatives**: keep `reasoning` and add modelKwargs only for non-gpt-5 IDs — two code paths for one setting; upgrade @langchain/openai — 1.5.13 still recognises only gpt-5* and o* IDs; patch `isReasoningModel` — breaks silently on the next upgrade.
- **Why**: @langchain/openai silently drops `reasoning` for gpt-6-* IDs, while modelKwargs reaches the request for every model ID and yields the identical request for today's gpt-5 models.

### DECISION: Reasoning effort is configured per tier by environment variable
- **Affects**: model, operations
- **Chosen**: `OPENAI_EFFORT_SMALL`, `OPENAI_EFFORT_MEDIUM` and `OPENAI_EFFORT_LARGE`, each defaulting to `medium` (today's value), alongside the existing `OPENAI_MODEL_*` variables.
- **Alternatives**: per-call-site effort keys — more configuration surface for roughly $1/month of savings; hardcoded effort — cannot express low effort for dedup and related stories once small and medium run the same model.
- **Why**: once small and medium both run gpt-6-luna, effort is the only difference between tiers, and each call site already chooses a tier.

### DECISION: The classification article block renders every article it is given
- **Affects**: architecture
- **Chosen**: `formatArticlesBlock` drops its capacity counter and the 1.5 weighting for Han-script articles; batch size is controlled only by the callers.
- **Alternatives**: fix only the off-by-one — batches containing Chinese text still lose their last articles; move weighted capacity into batch formation — needs article content before batches are formed and restructures `runBatchClassification`.
- **Why**: batches are already cut by count upstream, so the counter could only discard articles, and the worst-case prompt growth is a few thousand tokens.

### DECISION: Model evaluation runs as an in-repo harness with a read-only database session
- **Affects**: operations, architecture
- **Chosen**: `server/src/scripts/eval/` (npm `eval:models`) samples stored data through a session that Postgres enforces as read-only, calls prompt builders and `createChatModel` directly, and writes reports plus a response cache and spend ledger to a gitignored `DOCS/` folder.
- **Alternatives**: run the real service functions with an injected model — they persist results; a throwaway session script — lost afterwards and unusable as a regression check when an undated model alias drifts.
- **Why**: evals must never write to the database, and the same harness should re-run whenever the models change.

### DECISION: Eval baselines are regenerated, with stored values as the noise floor
- **Affects**: model, operations
- **Chosen**: every suite re-runs today's model on the same prompts; agreement with stored production values is reported for the baseline rerun and the candidates alike, and a bar is relaxed only where the baseline's own rerun misses it.
- **Alternatives**: compare candidates with stored values only — stored values include admin edits and reclassify runs and carry the incumbent's own run-to-run variance.
- **Why**: separates "the candidate behaves differently" from "the task is noisy".

### DECISION: Dedup ground truth comes from arm consensus plus a two-judge panel
- **Affects**: model, operations
- **Chosen**: a pair's label is the unanimous verdict of the three arms; where arms disagree, gpt-5.2 and gpt-6-sol at high effort judge the set, and pairs the judges split on are excluded and counted.
- **Alternatives**: admin labels — outside the owner's rating budget; existing clusters as labels — gpt-5-nano created them, so the baseline would grade itself.
- **Why**: the false-positive and recall comparison between arms depends only on the pairs where arms disagree, and judging just those keeps labels independent of any single arm at a few dollars.

## Changes

| File | Change |
|------|--------|
| `server/src/prompts/shared.ts` | `formatArticlesBlock`: remove the capacity counter, the Han weighting and the `batchSize` parameter; render every story. The doc comment says the caller controls batch size. All four callers pass only `stories`. |
| `server/src/prompts/shared.test.ts` | New: tests for `formatArticlesBlock` (see Tests). |
| `server/src/config.ts` | Export `type ReasoningEffort = 'none' \| 'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` and `parseEffort(value, fallback)` (throws on unknown values, naming the variable). Each tier's `reasoningEffort` is `parseEffort(process.env.OPENAI_EFFORT_<TIER>, 'medium')`. Model defaults are unchanged. |
| `server/src/services/llm.ts` | New exported `createChatModel(spec: { name: string; reasoningEffort: ReasoningEffort })`, with the GPT-6 rules in its doc comment; throws on `minimal` for non-`gpt-5*` IDs and on `none` for `gpt-5-mini`/`gpt-5-nano`. `getSmallLLM`/`getMediumLLM`/`getLargeLLM` call it with `config.llm.models.<tier>`. The `reasoning` option is removed. `getLLMByTier` and `rateLimitDelay` are unchanged. |
| `server/src/services/llm.test.ts` | New: effort reaches `invocationParams()` (see Tests). |
| `server/src/scripts/migrations/backfill-title-label.ts`, `backfill-relevance-summary.ts` | Add `import 'dotenv/config'` as the first import. Replace `new ChatOpenAI({...})` with `getMediumLLM()`. Drop the `ChatOpenAI` import. |
| `server/src/scripts/migrations/backfill-quote-attribution.ts`, `backfill-emotion-tag.ts` | Same, with `getSmallLLM()`. The emotion-tag script picks up fix A through `formatArticlesBlock`. |
| `server/package.json` | Commit 2: add `"openai": "^6.17.0"` to dependencies. Commit 3: add script `"eval:models": "tsx src/scripts/eval/run.ts"`. |
| `server/package-lock.json` | Synced by `npm install --package-lock-only --ignore-scripts --prefix server`; the root `dependencies` entry only, same resolved version (verify with `git diff`). |
| `server/src/services/bluesky.ts`, `server/src/services/mastodon.ts` | Add `export` to the existing pure `calcMaxBlurbChars` so the eval computes the same limit as production. No behaviour change. |
| `server/src/scripts/eval/run.ts` | New CLI entry. Parses `--out` (required), `--suites` (default: all), `--limit N`, `--dry-run`, `--budget` (default 18, max 20), `--concurrency` (default 4) and `--refresh-fixtures`. `import 'dotenv/config'` first, opens the read-only DB, loads or caches fixtures, prints estimates, runs suites, then writes `results.md`, `rating-sets.json` and `rating-key.json`. After writing, it re-reads `rating-sets.json` and runs `validateRatingDeliverable` (shape, caps, 2–4 options, key coverage, leak check) and exits non-zero on any failure. |
| `server/src/scripts/eval/types.ts` | New: shared type declarations. |
| `server/src/scripts/eval/models.ts` | New: arms, price table, metered/cached/budget-guarded calls. |
| `server/src/scripts/eval/fixtures.ts` | New: the read-only DB session and all sampling queries. |
| `server/src/scripts/eval/checks.ts` | New: pure metric helpers. |
| `server/src/scripts/eval/suites/preassess.ts`, `assess.ts`, `dedup.ts`, `related.ts`, `social.ts`, `largeTier.ts` | New: one `Suite` per file (per the table above). |
| `server/src/scripts/eval/ratingSets.ts` | New: the blind-rating deliverable. |
| `server/src/scripts/eval/resultsReport.ts` | New: `results.md` rendering, monthly projection and per-tier recommendation. |
| `server/src/scripts/eval/*.test.ts`, `server/src/scripts/eval/suites/*.test.ts` | New: logic tests (see Tests). |
| `.context/llm-analysis.md` | Commit 1: the pre-assessment paragraph no longer says "fewer for Chinese text", and its stale ">= 3" threshold becomes `fullAssessmentThreshold` (5). Commit 2: rewrite Model Configuration. The tier table shows actual usage (small: dedup, related stories, reclassify/emotion tagging; medium: pre-assessment, full assessment, social pick and post; large: selection, newsletter selection and intro, podcast). Add the `OPENAI_EFFORT_*` variables, correct `LLM_DELAY_MS` (default 500), and add a short "GPT-6 and LangChain" note (the modelKwargs reason plus the never-set-sampling/maxTokens rule). Add a pointer to `model-eval.md` in commit 3. |
| `.context/model-eval.md` | New: how to run the harness (flags, suites, outputs, read-only guard, budget, cache and ledger, how to add a suite). |
| `CLAUDE.md` | One row in the Context Files table: `model-eval.md`, the model-comparison eval harness. |

New-file responsibilities and exports:
- `run.ts`: *Responsibility:* orchestrate one eval run from CLI flags. *Exports:* none.
- `types.ts`: *Responsibility:* declare the types shared by suites, runner and reports. *Exports:* `Arm`, `CallRecord`, `Suite`, `SuiteContext`, `CallSiteResult`, `RatingItemDraft`.
- `models.ts`: *Responsibility:* make one metered, cached, budget-guarded structured-output call for an arm. *Exports:* `MODELS`, `arm`, `createEvalContext`, `costOf`, `classifyOutcome`.
- `fixtures.ts`: *Responsibility:* the only database access, a Postgres-enforced read-only session that samples every suite's inputs. *Exports:* `openReadOnlyDb`, `loadFixtures`, `Fixtures`.
- `checks.ts`: *Responsibility:* pure output-quality and statistics helpers. *Exports:* `findForeignScript`, `checkAssessFormat`, `findUnsupportedNumbers`, `percentile`, `jaccard`, `countWords`, `splitSentences`.
- `suites/*.ts`: *Responsibility:* for one call site (or one coupled group), build prompts from fixtures, run arms, compute metrics, apply the decision rule, and draft rating items. *Exports:* the suite object and its pure `decide*` function (for tests).
- `ratingSets.ts`: *Responsibility:* turn drafted items into the exact `rating-sets.json` / `rating-key.json` shape, with caps, deterministic item picking and label order, and the model-name leak check; validate a written deliverable. *Exports:* `buildRatingDeliverable`, `validateRatingDeliverable`, `RATING_BUDGET`.
- `resultsReport.ts`: *Responsibility:* render the plain-language `results.md`, including the monthly cost projection and per-tier settings. *Exports:* `renderResults`, `VOLUMES`, `recommendTierSettings`.

## Tests

Follow the existing Vitest patterns: colocated `*.test.ts`, `vi.stubEnv`/`vi.unstubAllEnvs` for env, and `vi.resetModules()` plus dynamic import where config is read at import time.

1. `prompts/shared.test.ts`:
   - 10 Latin-script stories: all 10 `Article ID:` lines are present (the regression).
   - 10 stories including 4 Han-script: all 10 are present.
   - Content is truncated to `contentMaxLength`.
   - Input order is preserved.
2. `services/llm.test.ts`:
   - `createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' }).invocationParams()` has `reasoning_effort: 'low'` and leaves `temperature`, `top_p`, `max_tokens` and `max_completion_tokens` undefined.
   - Same for `gpt-5-mini`/`medium`, so today's models keep the same request.
   - With `OPENAI_MODEL_SMALL=gpt-6-luna` and `OPENAI_EFFORT_SMALL=low` stubbed, `getSmallLLM().invocationParams()` carries both values.
   - With nothing stubbed, the three tiers resolve to gpt-5-nano, gpt-5-mini and gpt-5.2, all `medium`.
   - The structured-output path keeps the effort: `(createChatModel({ name: 'gpt-6-luna', reasoningEffort: 'low' }).withConfig({}) as ChatOpenAI).invocationParams()` still has `reasoning_effort: 'low'` (`withStructuredOutput` rebuilds the model through `withConfig`).
   - `createChatModel` throws for `gpt-6-luna`/`minimal` and for `gpt-5-nano`/`none`.
   - `parseEffort`: unset or empty → fallback; every listed value passes; `'lo'` throws with the variable name in the message.
   - Verified: the constructor does not throw without an API key.
3. `scripts/eval/checks.test.ts`:
   - The foreign-script scan flags Han, Cyrillic and Arabic inside English text, and ignores accented Latin, em dashes, digits, currency and emoji.
   - `checkAssessFormat`: a compliant fixture passes, and each rule (3 factors, 71-word summary, 11-word title, "Label: headline" title, 4-word label, 231-char blurb, label/title word overlap, bad date) is detected on its own.
   - `findUnsupportedNumbers` normalises `1,200`/`1200` and `$4.5 billion`, and ignores numbers present in the source.
   - `percentile` handles small arrays and returns `null` on an empty one.
   - `jaccard`.
4. `scripts/eval/models.test.ts`:
   - `costOf` covers uncached vs cached input, output including reasoning tokens, and the GPT-6 cache-write surcharge; an unknown model ID throws.
   - `classifyOutcome` maps each case: parsed → `ok`; null with content → `parse_failure`; null without content → `empty`; `finish_reason: length` → `truncated`; thrown → `error`.
5. `scripts/eval/ratingSets.test.ts`:
   - Exact key sets at every level of the output.
   - Item IDs are `<set id>-NN`.
   - Per-set caps are enforced, and every item has 2–4 options.
   - Label assignment is deterministic, and across 20 items both arms appear as `A`.
   - The key maps labels to arm keys.
   - The leak check fails when an option's content, a set title or instructions contain a model ID or family word absent from `context_md`, and passes when the context contains it.
   - Item picking is deterministic and honours the strata (e.g. the selection set only takes groups where the arms differ, and returns fewer than 5 when fewer differ).
   - `validateRatingDeliverable` rejects: an extra or missing key, a non-`text`/`image` option type, a cap overrun, a key entry for a non-existent item, an item missing from the key.
5b. `scripts/eval/imports.test.ts` (static, reads source files as text):
   - No file under `scripts/eval/` except `fixtures.ts` imports `@prisma/client`, and none imports `lib/prisma`.
   - Imports from `services/` are limited to `{ createChatModel }` from `llm.js` and `{ calcMaxBlurbChars }` from `bluesky.js` / `mastodon.js`.
   - No eval file calls `rateLimitDelay`, `withRetry`, or any `prisma.` / `.create(` / `.update(` / `.delete(` / `$executeRaw` except the `SET TRANSACTION READ ONLY` statement in `fixtures.ts`.
6. `scripts/eval/suites/{preassess,assess,dedup,related}.test.ts`, testing each suite's `decide*`:
   - The lowest passing effort wins.
   - With no passing arm, the result is "no automated winner" with reasons.
   - The noise-floor relaxation applies only when the baseline rerun misses the absolute bar.
   - Dedup FP rate and recall are computed only over labelled, non-contested pairs.
7. `scripts/eval/resultsReport.test.ts`:
   - `recommendTierSettings` picks the small-tier effort that passes all three small-tier suites and the medium-tier effort that passes all medium-tier suites.
   - The monthly projection equals mean $/call × volume low/high.

The fixture SQL gets no unit tests; the dry run verifies it against the database.

## Implementation order and verification

0. From `D:/projects`, run `git -C actually-relevant pull --ff-only` before changing any file.
1. **Commit 1: fix A.** Run `npm run test --prefix server` and `npm run typecheck --prefix server`. The known `clusters.test.ts` failure and Windows `kill EPERM` teardown noise are pre-existing.
2. **Commit 2: plumbing B.** Run `npm install --package-lock-only --ignore-scripts --prefix server` and check `git diff server/package-lock.json` (root entry only), then typecheck, tests, and `npm run build --prefix server`.
3. **Commit 3: harness C.** Typecheck, tests and build, then:
   1. **Dry run:** `npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --dry-run`. It must:
      - print `read-only session: on`, the DB class (`local`/`remote`), the fixture anchor date, and `OPENAI_API_KEY: present|missing` (a boolean only, never the value);
      - print fixture counts against their targets (≥50 Han-script in preassess, ≥5 in assess, 20 selection groups, etc.);
      - print per-suite call counts and $ estimates, and the total against the $18 budget;
      - write only `.cache/fixtures.json`, with no API calls.
      Shortfalls against the targets are reported, not padded. If the total estimate exceeds $18, cut `--limit` on the dedup judges first, then assess, and re-run the dry run; never raise `--budget` above 20.
   2. **Smoke run:** the same command with `--suites related --limit 2` instead of `--dry-run`. That is 6 calls, under $0.01. It confirms the API accepts `reasoning_effort` for gpt-6-luna on Chat Completions (a 400 here means stop and report, not work around), that `usage_metadata` is captured, and that the ledger is written.
   3. **Full run:** the same command without `--dry-run`/`--suites`/`--limit` (default `--budget 18`). Run it in the background and poll; cached calls from the smoke run are reused. If it stops at the budget, report which suites finished rather than raising the budget.
   4. **Validate the deliverable:** `run.ts` validates on write; additionally open `rating-sets.json` and confirm by eye that item counts are ≤ 12 / 10 / 4 / 1 / 5, that no option is empty, and that JSON outputs are rendered as markdown.
   5. **Fabricated-number spot check:** read 10 Luna assessment outputs flagged by `findUnsupportedNumbers` (or the first 10 if fewer are flagged) against their article text and append the verdicts to `results.md` with Edit.
   6. Report the ledger total and the full paths of `results.md`, `rating-sets.json` and `rating-key.json`.
4. **Commits.** Stage explicit paths with `git add <paths>`, then commit with a pathspec, `git commit -m "..." -- <paths>`. Never use `git add -A`/`commit -a`, and never commit anything under `DOCS/`. Leave any other run's uncommitted `.gitignore` line alone. Every message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. **Never push.**
   - Commit 1: `server/src/prompts/shared.ts server/src/prompts/shared.test.ts .context/llm-analysis.md`
   - Commit 2: `server/src/config.ts server/src/services/llm.ts server/src/services/llm.test.ts server/src/scripts/migrations/backfill-title-label.ts server/src/scripts/migrations/backfill-relevance-summary.ts server/src/scripts/migrations/backfill-quote-attribution.ts server/src/scripts/migrations/backfill-emotion-tag.ts server/package.json server/package-lock.json .context/llm-analysis.md`
   - Commit 3: `server/src/scripts/eval server/src/services/bluesky.ts server/src/services/mastodon.ts server/package.json .context/model-eval.md .context/llm-analysis.md CLAUDE.md .plans/2026-09-24_gpt6-migration-eval.md`

## Out of Scope

- **Flipping production defaults** (model IDs, efforts, documented env values). That is Phase 2, after the owner's ratings.
- **Production token and cost telemetry**, for example a `usage_metadata` logging callback in `createChatModel`. It is worth adding before Phase 2 so that a silent repoint of an undated alias shows up before the invoice, but this task scopes usage logging to the eval.
- **Per-call-site effort.** The dead `config.preassess.modelTier`, which `preAssessStories` ignores, and the hardcoded tier getters in reclassify, emotion-tag and podcast are also left alone.
- **Debt: extracting prompt-input shaping from the services** (`newsletter.ts`, `podcast.ts`, `bluesky.ts`, `mastodon.ts`, `socialMedia.ts`, `analysis.ts`, `dedup.ts`, `story.ts`) into pure functions shared with the eval. Pay it if the harness becomes a standing regression check or if shaping drift ever changes an eval verdict.
- **GPT-6-specific prompt changes** and updating `.context/prompting.md` for GPT-6.
- **Token-aware (weighted) batching** for Han-script articles.
- **Stale docs and specs not touched by this change:**
  - `.specs/newsletter-and-podcast.allium` `select_model_tier` (says medium; the code uses large);
  - `.specs/search.allium` `related_model_tier` (says medium; the code uses small);
  - `.context/dedup.md` `maxCandidates` (says 10; the code uses 6);
  - `.context/story-pipeline.md`'s separate issue-assignment step.
- **Env template.** `server/.env.sample` still uses the dotted name, which agents cannot read or edit. It should be renamed to `env.example` and the `OPENAI_EFFORT_*` variables documented there.
- **Upgrading `@langchain/openai`, and embeddings.** Embeddings stay on text-embedding-3-small.

## Implementation notes

- **Not run in this pass:** the dry run, smoke run, full run, deliverable check and fabricated-number spot check (steps 3.1-3.6). The caller for this pass asked for no paid eval beyond a smoke call of at most $0.10. The local PostgreSQL service was stopped, so the dry run could not sample fixtures (P1001).
- **Added `--api-check`:** one trivial structured-output call per eval arm, through `createChatModel`, needing no database. On 2026-09-24 all 9 arms (gpt-5-nano/mini/5.2, gpt-6-luna low/medium/high, gpt-6-sol medium/high) returned `ok` on Chat Completions with `reasoning_effort`, and usage was metered, for $0.0016 in total. That answers the step 3.2 question (does the API accept `reasoning_effort` for gpt-6-*?) without the database.
- **Module layout differs from the Changes table:**
  - The read-only session is in `readOnlyDb.ts`, split from `fixtures.ts` because the security control and the sampling queries change for different reasons.
  - Deterministic picking is in `sampling.ts`.
  - Decision rules are in `decide.ts`.
  - CLI flags are in `options.ts`, so the $20 cap can be tested without importing `run.ts`, which loads `.env`.
  - Fan-out helpers are in `suites/shared.ts`.
  - `imports.test.ts` allows `@prisma/client` in both `readOnlyDb.ts` and `fixtures.ts`.
- **Leaking rating drafts are dropped at build time,** and the count is reported, instead of failing the whole build. The written files are still validated, and any leak fails the run.
- **Dedup candidates** come from ±14 days around the source, not only the 14 days before it. A later-crawled duplicate of an earlier source then still appears, so recall can be measured.
- **Full-assessment MAD bar:** 1.0, relaxed to the gpt-5-mini rerun's own MAD against stored ratings when that is above 1.0. The noise-floor principle, applied to a lower-is-better bar.
