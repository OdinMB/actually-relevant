# Fix Crawl Job Render OOM + Surface Crashed Jobs

- **Date**: 2026-06-20
- **Status**: completed
- **Type**: bugfix
- **Complexity**: simple

## Problem

The `crawl_feeds` job (cron `0 1 * * *`) OOM-restarts the Render instance mid-crawl. Logs from 2026-06-19 show the extractor processing the first ~7 of 79 feeds (≈01:00:54–01:01:43), then the process is killed and Render restarts it (server back up 01:02:06). The admin Jobs table showed **Crawl Feeds** last succeeded "Jun 17" while every other job ran fine — because a hard kill bypasses the `lastCompletedAt` write, so a crashed run reads as a stale "OK" and the job looked stuck for ~2 days.

**Root cause (after correcting an initial wrong hypothesis):** Production already runs `CONCURRENCY_CRAWL_FEEDS=2 / CONCURRENCY_CRAWL_ARTICLES=1` (product 2 — the documented CPU ceiling in `.context/content-extraction.md`), so the shipped `3/3` code default was never active and concurrency is *not* the cause. Peak local extraction is 2 concurrent JSDOM parses, and the crawl path accumulates nothing per-article (`createStory` is a lean insert; `crawlAllDueFeeds` keeps only small count objects), so total article volume doesn't grow peak memory either — consistent with the crash hitting ~1 minute in rather than after a backlog.

The kill is **RSS-based** (Render's ~512 MiB cgroup limit), driven by JSDOM's native/CSSOM allocations (note the "Could not parse CSS stylesheet" log lines). A multi-MB HTML string expands ~10–20× as a DOM, and that native memory counts against RSS but **not** the V8 heap — so `--max-old-space-size=384` (a heap cap) does nothing to prevent it. Two such parses near the 5 MB fetch ceiling, on top of baseline RSS, can cross 512 MiB even at the documented-safe concurrency of 2.

The exact onset trigger (succeeded Jun 17, failing since) is not determinable from code alone — most likely day-to-day variation in page sizes/baseline finally crossing the limit. The fix does not depend on knowing it: it lowers crawl's peak memory so there is real margin.

## Approach

Bound the per-parse peak (the concurrency-independent driver) and make a hard kill visible:

1. **Pre-parse size guard (the real deployed fix)** — in `extractContent`, compute the fetched HTML's byte size and, when it exceeds `config.crawl.maxParseBytes` (default 2 MB, env `MAX_PARSE_BYTES`), skip local tiers 1–2 (selector + Readability) and fall through to the API tier (Diffbot/PipFeed extract server-side without loading the DOM into our heap). This caps each parse's DOM memory regardless of concurrency, so a single oversized page can't OOM the crawl. The HTTP fetch is separately capped at 5 MB; this bounds what we hand to the parser.

2. **Default hygiene** — change the `crawlFeeds`/`crawlArticles` defaults from `3/3` to `2/1` so the shipped default matches production and the documented `product ≤ 2` ceiling (removes a footgun; production env overrides are unchanged).

3. **Crash visibility** — `JobStatusBadge` now shows **Incomplete** (red) when `lastStartedAt > lastCompletedAt` (or completion is null) and the job isn't running. `lastStartedAt` was already persisted at run start, so this is read-side only — no migration. A hard OOM-kill no longer reads as a stale "OK".

## Changes

| File | Change |
|------|--------|
| `server/src/services/extractor.ts` | In `extractContent`, after `fetchPage`, compute `Buffer.byteLength(html)`; if it exceeds `config.crawl.maxParseBytes`, log a warning and skip tiers 1–2 (defer to the API tier). Tier guards become `html && !tooLargeToParse`. |
| `server/src/config.ts` | Add `crawl.maxParseBytes` (default `2 * 1024 * 1024`, env `MAX_PARSE_BYTES`). Change `concurrency.crawlFeeds` default `3 → 2` and `crawlArticles` `3 → 1`; update the comment to explain the CPU *and* RSS-memory axes. |
| `client/src/components/admin/JobStatusBadge.tsx` | Add `lastStartedAt` to the `Pick`; `getStatus` returns `Incomplete` (red) when `lastStartedAt && (!lastCompletedAt || lastStartedAt > lastCompletedAt)`, ranked after `Error`/`Running`. |
| `server/src/services/extractor.test.ts` | New `maxParseBytes guard` suite: oversized → defers to API (Readability never called); oversized + no API key → null; under-limit → parses locally. |
| `client/src/components/admin/JobStatusBadge.test.tsx` | **New.** Covers OK / Incomplete (older completion) / Incomplete (no completion) / Error-precedence / Running-precedence / Never-run. |
| `.context/content-extraction.md` | Document the `maxParseBytes` guard; rename "CPU Budget" → "CPU & Memory Budget" and explain the RSS-vs-heap distinction; correct concurrency defaults to `2/1`. |
| `.context/scheduler.md` | Document that a hard kill leaves `lastStartedAt > lastCompletedAt` and surfaces as the **Incomplete** status. |
| `.specs/crawl-and-extraction.allium` | Add `max_parse_bytes` to config; note the oversized-page local-skip rule in `ExtractAndCreate` and Resource Limits; align crawl concurrency defaults with the code. |

## Tests

Logic-bearing tests only:

- **`maxParseBytes` guard** (`extractor.test.ts`) — over-limit HTML defers to the API tier with Readability never invoked; over-limit with no API key returns null; at/under the limit still parses locally. Verified the guard fires (`htmlBytes 2097179 > maxParseBytes 2097152`).
- **`JobStatusBadge` status** (`JobStatusBadge.test.tsx`) — the new Incomplete branch and its precedence vs Error/Running, plus OK/Never-run.
- Regression: `crawler.test.ts` (reads `crawlArticles` dynamically — passes with the new default of 1), `scheduler.test.ts`, `routes/admin/jobs.test.ts`, `DashboardPage.test.tsx` all pass. Server + client `typecheck` clean.

## Operational follow-up (Render, not code)

- Deploy this; once live, the 2 MB guard makes product-2 concurrency safe again.
- Optional immediate relief before the deploy lands: set `CONCURRENCY_CRAWL_FEEDS=1` so only one parse runs at a time; revert to `2` afterward.
- The next crawl will show **Incomplete** in the admin table if it dies again, instead of a frozen "OK".

## Out of Scope

- **Pinning the exact Jun-17 onset trigger** — not determinable from code; the fix reduces peak memory robustly regardless.
- **Replacing JSDOM with a lighter DOM (e.g. `linkedom`)** — a larger change that would cut parse memory/CPU further; deferred.
- **A heap/RSS backpressure guard in the crawl loop** — considered; rejected as leaky (gates only new tasks, and `heapUsed` misses JSDOM native memory). The byte guard + concurrency bound is the more reliable lever.
- **Pre-existing `.context`/spec config drift** unrelated to this change (e.g. `rss_item_limit`, `min_content_length` numbers) — left as-is.
