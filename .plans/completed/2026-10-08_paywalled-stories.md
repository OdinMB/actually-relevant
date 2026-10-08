---
plan-id: 2026-10-08-paywalled-stories
title: Reject paywalled teasers at crawl, before any model call, with a per-feed paywall setting
status: implemented
created: 2026-10-08
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: []
decisions:
  - ref: .context/decisions/0030-classify-access-tier-at-extraction.md
  - ref: .context/decisions/0031-reject-locked-stories-at-crawl.md
  - ref: .context/decisions/0032-per-feed-paywall-setting.md
type: feature
complexity: complex
---

# Paywalled stories

The owner chose the direction on 2026-10-08 (decisions relayed in session, listed under "Decisions taken"); the agent settled the design details within it, flagged below. Facts come from a code read and a live probe of publisher pages on 2026-10-08 (dev machine, desktop user agent). The owner was shown the per-feed setting's shape and the design calls (crawl-time rejection, teaser rows, no second gate at selection) and approved the plan in session.

Confirmed by Odin Mühlenbein on 2026-10-08: ADR-0030, ADR-0031, ADR-0032

(Reserved as ADR-0025 to ADR-0027; they gave way at promotion to ADR-0030 to ADR-0032, because the log's last entry was ADR-0029.)

Related plans: none. No active or completed plan touches paywalls, extraction quality gates or newsletter story filtering.

## Problem

A SPIEGEL+ article reached the newsletter's top stories although its analysis noted that only the headline was accessible (reader feedback, October 2026; BACKLOG.md line 20).

**How it slipped through.**
1. `extractContent()` (`server/src/services/extractor.ts`) accepts any text of at least `config.crawl.minContentLength` (300). That check is the only quality gate in the crawl path. A SPIEGEL+ teaser is longer than 300 characters.
2. The fetched HTML is never inspected (no JSON-LD or meta parsing anywhere) and is discarded after extraction. Only `sourceContent` and `crawlMethod` are stored.
3. The assess prompt tells the model to fill gaps from its own knowledge and never mention them (`prompts/assess.ts:153-154`). A teaser therefore gets a confident rating built on the headline.
4. Selection and publishing run automatically. The site-selection model sees `antifactors` and `relevanceCalculation` but its prompt says nothing about content completeness. The newsletter longlist is every story published in the last 7 days, and the newsletter selector never sees caveats.

**Timing.** The newsletter job is off while the Plunk account is suspended (BACKLOG.md line 18). This should land before that job is switched back on.

**Exposed surfaces** (each reads only `status = published`): newsletter, podcast, social auto-post, site/RSS/search/related stories. A story that never reaches `published` reaches none of them, so one gate before the pipeline covers all of them.

## Detection signals

| Signal | Reliability | Coverage / limits |
|---|---|---|
| JSON-LD `isAccessibleForFree` = false | Very high for "publisher restricts it". Only moderate for "we got a teaser": metered sites (The Diplomat, STAT) mark every article false but serve the full text | SPIEGEL (8/8 S+ false, 20/20 free true), ZEIT, SZ, FT, STAT, Diplomat. The value is often the string `"False"`/`"True"`, and appears at top level, in `@graph` or in `hasPart`. Missing means unknown (BBC), never paid |
| `article:content_tier` meta (free/metered/locked) | Best semantics | Low coverage (SZ, Heise) |
| JSON-LD `wordCount` vs extracted words | Strong teaser signal below about 0.3 (ZEIT Z+ ~90/7008, SZ Plus ~75/2277) | ZEIT, SZ, STAT. Not SPIEGEL |
| Extracted text length | Good corroboration. Alone, false positives on short agency briefs and liveblog stubs | Every path |
| Publisher title markers (SPIEGEL `og:title` "(S+) ", Z+, F+) | High per publisher, brittle (redesigns) | Per feed: this is what `paywallTitleMarker` carries |
| CSS class names ("paywall", "premium"), URL patterns | Useless: present on 100% of probed pages / absent at SPIEGEL, ZEIT, SZ; FAZ `/premium/` is not F+ | — |

No HTML is available when the fetch fails (bot-blocked publishers: NYT 403, WSJ 401, Economist 403, FAZ challenge), when the page exceeds `maxParseBytes` (2 MB), or once `crawlFeed` has set `skipLocal` for the rest of that crawl run (after `localFailThreshold` = 3 items that did not come from a local tier). Then only a feed's title marker can classify the story, tested on the API tier's title. Paywall status is a snapshot: SPIEGEL unlocks some S+ pieces later, and a story rejected as locked stays rejected. The probe used a desktop user agent; whether publishers serve the same markup to the crawler's `ActuallyRelevant/1.0 (news curation bot; …)` agent is checked before building (below).

**The locked rule:** with automatic detection on, `isAccessibleForFree` is false (normalized) **and** at least one of `content_tier = locked`, extracted words < `minWordRatio` (0.3) × `wordCount`, or extracted text < `lockedMaxChars` (1,500; teasers run 300-700, the Diplomat's metered body ~5,300; check against fixtures). SPIEGEL has neither `wordCount` nor `content_tier`, so its S+ pieces are caught by the length clause. False with a long body = `metered` (left alone). No flag = `unknown` (left alone). A matching title marker = `locked`, whatever the markup says.

## Decisions taken

Owner decisions, 2026-10-08 (Odin Mühlenbein; relayed to the planning agent in session):

1. **Locked stories are removed everywhere** (option C). No reader-facing label.
2. **Locked stories are not analyzed.** They are rejected right after crawl, before any pre-assess or assess call (variant C2): no point analyzing what we will not publish. Manual publish from admin stays possible, but such a story has no analysis (no AI title, summary or rating) unless an editor re-assesses it first.
3. **No newsletter short-content filter (E1) now.** Revisit after about four weeks of `accessTier` data. Exception: if the pre-build re-fetch shows the crawler gets no HTML for the SPIEGEL+ URL, raise E1 with the owner again before building.
4. **Per-feed paywall setting (D): build now**, in the same change. Shape settled by the agent (ADR-0032), see Approach.
5. **Small-model sufficiency check (E2): acceptable in phase 2** if the four weeks of data show teasers getting through. Not built now.

Also kept: the one-off scan of already-published analyses for teasers (E4), and the pre-build re-fetch.

Options not taken, for context: **B** (keep locked stories on the site with a "Subscriber-only source" label, off the distribution channels) leaves a headline-based rating competing for homepage slots. **C1** (gate at site selection after a full assessment) spends an assess call per locked story on something that will not publish. **E3** (a completeness field in the assess schema) needs a recalibration and conflicts with the no-gap-talk rule. **E5** (a selection-prompt rule) catches only cases where the assess model broke its own rule, and needs a recalibration.

**Phase-2 triggers** (after about four weeks of `accessTier` data, BACKLOG.md):
- E1 (newsletter short-content filter) if published stories with `accessTier` `unknown`/null and a short `sourceContent` turn out to be teasers.
- E2 (small-model sufficiency check on short or `unknown`/API-path stories) on the same evidence, if E1's false positives on short free briefs are too costly.
- A feed setting change where the data shows a metered feed rejected as locked, or a subscriber feed reaching us without markup.

## Pre-build checks

Run by the owner or a session with production access, before the implementation starts:

1. **Re-fetch the SPIEGEL+ URL with the crawler's user agent** (`ActuallyRelevant/1.0 (news curation bot; +https://actuallyrelevant.news)`, as in `extractor.ts`). Confirm that the response is HTML, that it carries `isAccessibleForFree: false`, and that Readability yields the teaser. **If the crawler gets no HTML** (403, bot challenge), the markup rule cannot catch SPIEGEL+ for us: raise E1 with the owner before building, and consider a SPIEGEL title marker (works on the API tier's title only if Diffbot returns the "(S+)" prefix).
   **Result (implementation session, 2026-10-08, without production access):** in place of the production URL, two current SPIEGEL+ articles from the spiegel.de RSS feed (found by their `isAccessibleForFree: false`; the RSS titles carry no "(S+)") were fetched with the crawler's user agent through the project's own extractor. Both returned HTTP 200 HTML with `isAccessibleForFree: false` and an `og:title` starting "(S+) "; Readability yielded the teaser (about 1,400 and 3,100 characters, the latter including SPIEGEL's subscription offer). The markup is served, so E1 was not raised. The 3,100-character international teaser is above `lockedMaxChars` and is caught only with the SPIEGEL feed's title marker `^\(S\+\)`.
2. The SPIEGEL+ story's `crawlMethod` and `sourceContent` length, and the active feed list (`SELECT title, url FROM feeds WHERE active`). A `crawlMethod` of `diffbot`/`pipfeed` is not conclusive: if the page was fetched and the local tiers merely came up short, the HTML is still classified.

## Approach

**ADR-0030 (agent, proposed; the owner's choice of option C builds on it): classify at extraction from markup and store the result.** A new `server/src/lib/paywall.ts` parses the raw HTML with cheerio (already a dependency): every `script[type="application/ld+json"]` (arrays, `@graph`, `hasPart`; malformed JSON ignored), `meta[property="article:content_tier"]`, `wordCount`, `og:title` and the page description. It applies the locked rule, then the feed's setting. `extractContent()` runs it whenever HTML was fetched and is under `maxParseBytes`, against whichever tier's text succeeded, **the API tier included** (a teaser under 300 characters falls through to Diffbot/PipFeed; the HTML is still in hand). With no parseable HTML the tier is `unknown`, unless the title marker matches the API tier's title. Rejected alternatives: refusing locked pages at crawl time with no stored row (no override, no data, and the `null` result trips `skipLocal`, see below); a model field in assess (recalibration, non-deterministic); a per-feed setting alone (drops free stories from mixed feeds: for SPIEGEL ~70% free, 20 of 28 probed). The truncation clause exists because `isAccessibleForFree: false` alone would remove metered feeds.

**ADR-0031 (the owner's decision 2 on top of 1; the agent placed it): reject at crawl, in `createStory`.** `createStory` takes `accessTier` and creates the row with `status: rejected` when it is `locked`, `fetched` otherwise. Placing it in `createStory` gives both crawl paths (`crawlFeed`, admin `crawlUrl`) one rule; the admin's manual create (`POST /api/admin/stories`) never passes `accessTier`, so it is unaffected. What the rejected-at-crawl story bypasses, verified against the code:
- **Pre-assess and assess** pick only `fetched` and `pre_analyzed` stories: no model call is ever made for it. No issue is assigned (`issueId` stays null; the feed's issue is the fallback everywhere).
- **Embeddings** are generated only at assess (`assessStory`) or at publish (`ensureEmbedding`): it gets none.
- **Dedup** runs only after an assessment commits, and `findNearestCandidates` takes only `analyzed`/`selected`/`published` stories with an embedding: a locked story never joins or seeds a cluster. A free duplicate of the same event therefore stays unclustered and goes through selection on its own merits. **This makes the earlier "not locked beats locked" dedup comparator rule unnecessary; it is dropped.**
- **Selection, publishing, newsletter, podcast, social** all start from statuses it never has.

**The `skipLocal` hazard is avoided by storing, not returning `null`.** A locked page whose teaser passes the 300-character minimum comes back from Readability as an ordinary local success and is stored. The remaining case is a locked page where every tier, the API tier included, produces under 300 characters: today that is a `null` result, counted toward `skipLocal` and `skipAll`, never stored, and retried (with a fresh API call) on every crawl while it stays in the RSS feed. **Design call:** when the HTML classifies as locked and every tier failed, `extractContent()` returns a result instead of `null`: `method: 'teaser'`, the page's `og:title`/`<title>` as title, its `og:description`/meta description (or empty) as content, `accessTier: 'locked'`. The crawler counts `teaser` as a local success (the HTML was fetched and parsed), so it resets `localFailCount` and `totalFailCount`. The API tier is still tried first, so a metered page whose local tiers fail for unrelated reasons (JavaScript rendering) still gets its full text from the API and is classified `metered`, not rejected. `teaser` shows up in the feed quality breakdown as its own method, which is informative.

**After rejection, any editor action is the override.** Re-assessing a locked story sets it `analyzed` with a full analysis, after which the normal pipeline (dedup, the select job, the publish job) treats it like any other story. There is deliberately no second gate at selection: it would also re-reject stories an editor re-queued on purpose, for example after switching a misclassified feed's detection off. Consequences, stated for the editor: re-assessing to look at an analysis can lead to an automatic publish unless the editor rejects the story again; and a re-assessed locked story enters dedup on its (inflated) rating, so it can win a cluster over a free duplicate. Publishing straight from `rejected` without re-assessing publishes a story with no AI title, summary or rating (the slug falls back to the source title); the plan leaves that to editorial judgement and adds no guard.

**ADR-0032 (owner decision 4 to build; the agent chose the shape): a per-feed paywall setting.** Two feed fields, shown in the feed form as a checkbox and a text field:
- **"Detect paywalled articles automatically"** (`paywallDetection`, default on). Off, the markup rule never produces `locked`; what would have been locked is stored as `metered` (publisher marks it paid, but we were told the feed serves full text). For a metered feed the locked rule gets wrong.
- **"Subscriber-article title marker"** (`paywallTitleMarker`, optional regex, e.g. `^\(S\+\)` for SPIEGEL). When it matches the article's `og:title` (or, with no HTML, the title the API tier returned), the article is `locked` regardless of markup, length or the checkbox. For publishers without the schema.org tag, and for bot-blocked feeds that reach us only through Diffbot, provided Diffbot keeps the prefix.

There is no "always locked" mode: that is the same as deactivating the feed. The marker is validated as a compilable regex of at most 200 characters by Zod on create and update; at crawl time a regex that still fails to compile is logged and ignored. Matching runs against a single short title, so catastrophic backtracking is bounded. Changing either field affects future crawls only; already-rejected stories stay as they are (an editor can re-queue them by filtering on the feed and "Paywall: Locked"). The field follows the five-place `htmlSelector` path: Prisma, Zod create/update, the feed service's input types, shared types, `FeedForm`/`FeedEditPanel`, crawler pass-through.

**Admin visibility (design call).** There is no reject-reason column, so `accessTier` is the reason. Editors get a "Paywall" badge in the story list (locked) and the access tier in the edit panel's Source section, plus a "Paywall" filter in the story list (Locked / Metered) so the rejected-at-crawl stories can be found in bulk among all rejected stories. Locked and metered only: `free` and `unknown` are not editorial questions, and the four-week review is a database query.

**E4, one-off scan.** A small read-only script lists published stories whose analysis talks about missing content (a few teaser-specific patterns: headline only, paywall, subscriber, teaser, truncated) or whose `sourceContent` is under `lockedMaxChars`, with slug, feed, length and the matching phrase. It is committed so the owner can run it against production, and reused at the four-week review. Its report goes to `DOCS/YYYY-MM-DD_teaser-scan.md`; unpublishing anything it finds is an admin decision, not part of this change.

## Changes

| File | Change |
|------|--------|
| `server/src/lib/paywall.ts` (new) | `classifyAccess({ html, extractedText, title, policy })` returns `{ accessTier, ogTitle, description }`. Parses JSON-LD (arrays, `@graph`, `hasPart`; malformed blocks ignored), normalizes `true`/`"True"`/`"false"`, reads `article:content_tier`, `wordCount`, `og:title`, `og:description`/meta description; applies the locked rule, then `policy.detection` (off: locked becomes metered) and `policy.titleMarker` (match on `ogTitle ?? title`: locked). `html: null` gives `unknown` unless the marker matches `title`. |
| | *Responsibility:* turning publisher access markup and a feed's paywall setting into an access tier. *Exports:* `classifyAccess`, `AccessTier`, `PaywallPolicy`. |
| `server/src/config.ts` | `paywall: { lockedMaxChars (1500), minWordRatio (0.3) }` with env overrides. |
| `server/src/services/extractor.ts` | `extractContent()` takes `options.paywall` (the feed's policy) beside `htmlSelector`, and calls `classifyAccess` with the fetched HTML (when parseable) and the winning tier's text and title, the API tier included. `ExtractionResult` gains `accessTier`; `method` gains `'teaser'`. New branch at the end of `extractContent()`: when every tier failed and the HTML classified as locked, return the teaser result instead of `null` (see Approach). `shouldAbort` bail-outs still return `null`. |
| `server/src/services/crawler.ts` | `crawlFeed` and `crawlUrl` pass `paywall: { detection: feed.paywallDetection, titleMarker: feed.paywallTitleMarker }` and pass `accessTier` into `createStory`. `crawlFeed` counts `teaser` as a local method when resetting `localFailCount`, and logs one info line per locked story stored as rejected. |
| `server/prisma/schema.prisma` + migration | `Story.accessTier String? @map("access_tier")` (same style as `crawlMethod`); `Feed.paywallDetection Boolean @default(true) @map("paywall_detection")`, `Feed.paywallTitleMarker String? @map("paywall_title_marker")`. One migration, `npm run db:migrate:create --prefix server -- --name paywall_access_tier`; delete any `DROP INDEX "stories_embedding_idx"`. Old stories stay null (= unknown), no backfill (the HTML is gone); existing feeds get detection on. |
| `server/src/services/story.ts` | `createStory` accepts `accessTier` and `crawlMethod` `'teaser'`, persists `accessTier`, and sets `status: 'rejected'` when it is `locked`. `ADMIN_LIST_SELECT` gains `accessTier`. `StoryFilters` and `buildWhereClause` gain `accessTier` (`locked` / `metered`). |
| `server/src/schemas/story.ts` | `storyQuerySchema` gains `accessTier: z.enum(['locked', 'metered']).optional()`. |
| `server/src/schemas/feed.ts` | `paywallDetection: z.boolean().optional()` and `paywallTitleMarker` (string, max 200, refined to a compilable regex; nullable on update) on create and update. |
| `server/src/services/feed.ts` | `createFeed`/`updateFeed` input types gain both fields. |
| `shared/types/index.ts` | `Story.accessTier: string \| null`; `Feed.paywallDetection: boolean`, `Feed.paywallTitleMarker: string \| null`; the admin `StoryFilters` gains `accessTier`. |
| `client/src/components/admin/FeedForm.tsx`, `FeedEditPanel.tsx` | Checkbox "Detect paywalled articles automatically" and input "Subscriber-article title marker (regex, optional)" with a short hint; both in the form state, `buildFormState` and the submit payload, like `htmlSelector`. |
| `client/src/components/admin/StoryTable.tsx` | "Paywall" `Badge` next to `ClusterBadge` when `accessTier === 'locked'`, with `title`/`aria-label` "Rejected at crawl: subscriber-only article". |
| `client/src/components/admin/StoryEditForm.tsx` | Access tier shown in the read-only Source section. |
| `client/src/components/admin/StoryFiltersBar.tsx`, `client/src/pages/admin/StoriesPage.tsx` | "Paywall" select (Locked / Metered) read from and written to `?accessTier=`, counted in `activeCount`. |
| `server/src/test/helpers.ts`, `client/src/test/stories.ts`, `crawler.test.ts` `sampleFeed` | New fields on the story and feed fixtures. |
| `server/src/scripts/scan-teaser-analyses.ts` (new) + `package.json` script `scan:teasers` | E4: read-only scan of published stories, Markdown report to stdout for `DOCS/`. |
| | *Responsibility:* finding published stories that were probably rated on a teaser. *Exports:* none (script); its pattern check is a pure function exported for its test. |
| `.context/content-extraction.md` | New section "Access classification": the locked rule, the feed setting, the teaser result and why it exists (`skipLocal`), the API-path and snapshot limits, the extra cheerio parse in the CPU/memory budget. Crawl Flow and "Story Fields from the RSS Fallback": locked stories are created `rejected`, not `fetched`. Method tracking lists `teaser`. |
| `.context/story-pipeline.md` | Status flow: `rejected` (crawl, paywall) beside `fetched`; status table "Set By" adds the crawler; `accessTier` under Source data; the override behavior (re-assess re-enters the pipeline; publishing from `rejected` publishes without analysis). |
| `.context/feed-management.md` | The two optional feed fields; quality metrics: locked stories count in `totalCrawled` and lower `publishRate`, `teaser` appears in `extractionMethods`. |
| `.context/newsletter-podcast.md` | One line: locked stories never reach the pool because they are rejected at crawl. |
| `.context/ai-transparency.md` | No inventory row changes: no model, output, label or destination changes, and the dedup row is untouched now that the comparator rule is gone. One sentence under the §2 table: a deterministic, non-AI rule rejects paywall-locked stories at crawl (`content-extraction.md`), so they never reach rows 1-3. If E2 is adopted later, it adds its own row. |
| `BACKLOG.md` | Replace line 20 with the phase-2 remainder: "Paywalled stories, phase 2: after about four weeks of `accessTier` data (from the deploy of the crawl-time paywall rejection), decide on the newsletter short-content filter (E1) and the small-model sufficiency check (E2) for `unknown`/API-path stories, and adjust feed paywall settings; plan `.plans/completed/…paywalled-stories.md`." |
| `.context/decisions/` | Promote ADR-0030, ADR-0031 (owner's decision) and ADR-0032 via the `adr` skill at implementation. |

## Tests

- `server/src/lib/paywall.test.ts`, with short inline JSON-LD/meta snippets (no full publisher pages committed):
  - SPIEGEL-style boolean false + short body → locked; boolean true → free.
  - ZEIT-style `"False"` string in `hasPart` with `wordCount` 7008 vs ~90 words → locked.
  - `content_tier=locked` → locked.
  - Diplomat-style `"False"` + ~5,300-character body → metered.
  - No markup (BBC) → unknown, including when the body is short.
  - Short free brief with `true` → free.
  - `@graph` array; malformed JSON-LD block ignored.
  - Detection off: the locked SPIEGEL case → metered.
  - Title marker matching `og:title` → locked on a page marked free and with no markup; matching the API title with `html: null` → locked; not matching → the markup result; an uncompilable marker → ignored.
- `extractor.test.ts`: `accessTier` from the local tiers; classified from the fetched HTML when tiers 1-2 fail and the API tier supplies the text; `unknown` with `skipLocalExtraction`, a failed fetch, and a page over `maxParseBytes`; every tier failing on a locked page returns the `teaser` result, while on an unlocked or unknown page it still returns `null`.
- `crawler.test.ts`: a locked result reaches `createStory` with `accessTier: 'locked'`; a `teaser` result resets the local-fail counter (three locked teasers in a row do not set `skipLocal`); the feed's policy is passed to `extractContent`.
- `story.test.ts`: `locked` creates the row `rejected`; `metered`/`unknown`/absent create it `fetched`. `buildWhereClause` with `accessTier`.
- `routes/admin/feeds.test.ts`: create and update refuse an uncompilable or over-long marker (400) and persist a valid one.
- The E4 pattern check: a teaser remark matches, an ordinary antifactor does not.

## Out of Scope

- Unpublishing the SPIEGEL+ story already live, or anything the E4 scan finds (admin actions), and backfilling `accessTier` for stored rows.
- Reader-facing labels (option B, not chosen).
- The newsletter short-content filter (E1) and any model-based check (E2): phase 2, BACKLOG.md.
- A gate at selection or in the consumer queries, and the dedup "not locked beats locked" rule: unnecessary once locked stories never enter the pipeline.
- Re-evaluating stored stories when a feed's paywall setting changes.
- Reading Diffbot's response for a paywall field (unverified that one exists).
- Changing `minContentLength`.
