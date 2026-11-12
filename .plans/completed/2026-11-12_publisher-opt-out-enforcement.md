# Enforce publishers' AI opt-outs in the crawler

_Owner-approved 2026-11-12 (Odin, project thread "Check crawler respects sources' bot policies")._

## Goal

Today the source policy (`.context/feed-management.md`, "Source Policy: Publishers' AI Opt-Outs") is applied only when people choose sources; the crawler checks nothing, and the Diffbot API tier fetches pages that refused us. After this change the crawler enforces the machine-readable part of that policy on every crawl, the API tier never routes around a publisher's refusal, and every crawler request names us.

## Owner decisions (record as an ADR, next free number in `.context/decisions/`, index in `.context/decisions.md`)

- The crawler checks machine-readable reservations itself, per host, before reading an article.
- The API tier (Diffbot/PipFeed) is a fallback for **technical** failures only (timeout, network error, 5xx, page over `maxParseBytes`, local extraction too short or failed). It never runs for an article whose page fetch was refused (401, 403, 451, 429) or that carries a reservation, and once a host refused us in a crawl, no API call is made for that feed's remaining articles in that crawl. Trade-off accepted: we lose articles from sites that block every bot.
- The planned multi-source research feature will cite only sources that pass the same check (not built here; the check must be reusable by URL, independent of feeds).

## Behavior

### The check (new module, reusable by any caller with a URL)

`isReserved(url)` (name yours) answers for one article URL: reserved or not, plus a human-readable reason. Signals, exactly the "Honored" list of the source policy:

- **robots.txt** at `https://<host>/robots.txt`: the group for our token `ActuallyRelevant` (case-insensitive product-token match) if one exists, else the `*` group; RFC 9309 longest-match Allow/Disallow for the article's path (with `*` and `$` wildcards). A disallowed path is a reservation. Groups naming only other bots (GPTBot, ClaudeBot, CCBot, Google-Extended, …) never apply to us.
  - 404/other 4xx: no robots.txt, everything allowed (RFC 9309).
  - 5xx, timeout, network error: treat as disallow for now (RFC 9309 "unreachable"), cached briefly (e.g. 1 h) so a flaky host is retried soon. The item is **skipped, not stored**, so it is picked up on a later crawl while it stays in the feed.
- **Content-Signal** (Cloudflare style) lines in the applicable robots.txt group, or at top level: `ai-input=no` is a reservation. Other keys (`search`, `ai-train`) are ignored (training-only rules don't apply to us).
- **TDMRep**: `/.well-known/tdmrep.json` (array of `{ location, "tdm-reservation": 0|1 }`, `location` a path pattern with `*`); a matching entry with `tdm-reservation: 1` is a reservation. Missing/invalid file = no reservation. Also, after a page fetch, the response header `tdm-reservation: 1` or `<meta name="tdm-reservation" content="1">` on the page: the fetched text is discarded and the article is treated as reserved.
- Per-host cache of the fetched robots.txt and tdmrep.json, 24 h (config constant in `config.ts`; no new env var needed), in memory. Both fetches go through `crawlLimiter`, `isAllowedUrl()` + `...ssrfGuard`, the crawler user agent, a short timeout and a small size cap (e.g. 512 KB). A robots.txt over the cap: use the first 500 KiB as RFC 9309 allows.

### Crawler

- **`contentSource: 'page'` feeds:** before fetching an article page, run the check. Reserved → skip the item: no page fetch, no extraction, no API call, no story; counted in `skipped` (not attempted, not an error, so it never feeds the local-fail or total-fail counters), logged at info with the reason.
- **`contentSource: 'rss'` feeds:** no page is fetched, so robots.txt path rules don't apply; TDMRep and Content-Signal `ai-input=no` still do (they reserve the use, not the fetch). Reserved → skip the item.
- **Visible to the admin:** when a crawl skipped at least one item for a reservation, the feed shows it: the crawl result/error carries the reason (e.g. "Publisher opted out: robots.txt disallows ActuallyRelevant"), so the feed table makes it noticeable. A feed whose every new item was reserved must not look healthy. Choose the field use so `updateCrawlStatus()`'s table in `feed-management.md` stays coherent; update that table.
- **Single-URL crawl (`crawl-url`)** refuses a reserved URL with 400 and the reason, before any page fetch.
- **API tier gating** as in the owner decisions above; refusal statuses are 401, 403, 451, 429.

### User agent

One shared crawler user agent (today's `ActuallyRelevant/1.0 (news curation bot; +https://actuallyrelevant.news)`) used by article fetches, RSS fetches (today they send axios's default), favicon fetches and the robots/tdmrep fetches. Export it from one place.

## Docs and copy (same change)

- `.context/content-extraction.md`: the check, its signals and failure handling, the API-tier rule, the user agent; "Key Files".
- `.context/feed-management.md`: Source Policy section — replace "the crawler does not enforce it" and the "Known gap" paragraph with what is enforced and what still isn't (terms of use stay a human check); crawl-status table.
- `BACKLOG.md`: delete the "Source policy, enforcement in the crawler" item (finished). Keep a remainder only if something is left undone.
- `client/src/pages/MethodologyPage.tsx`, "Publishers' AI Opt-Outs": the sentence "We check these rules when we add a source and whenever we review our source list." becomes true to the new behavior, e.g. "We check these rules when we add a source and whenever we review our source list, and our crawler checks the machine-readable ones again before it reads each article." American English, at most one em dash per paragraph.
- `CLAUDE.md` context table rows if a description there becomes wrong.

## Tests (first)

- robots.txt parsing and matching: our group beats `*`; named-AI-bot-only groups ignored; longest match; Allow overriding Disallow; wildcards; 4xx allows; 5xx/timeout disallows; Content-Signal `ai-input=no` in the applicable group and top level.
- TDMRep: matching and non-matching locations, `0` vs `1`, invalid JSON; header and meta on a fetched page.
- Cache: one fetch per host within TTL.
- Crawler: reserved item skipped with no page fetch and no API call; counted as skipped; the feed's status shows the reason; rss-source feed honors TDMRep/Content-Signal but not robots path rules; `crawl-url` 400.
- API tier: not called after 401/403/451/429; still called after timeout/5xx/oversize/too-short; not called for the rest of a feed's crawl after a refusal.
- RSS and favicon requests carry the crawler user agent.

## Checks before commit

What CI runs, in both packages where relevant: lint, format (CI runs `format:check`), typecheck, `test:coverage` (raise thresholds if coverage rose, never lower), `check:migrations`, builds. `test:db` needs `TEST_DATABASE_URL`; run it if a local test database is available, otherwise say so. No migration is expected; if one turns out to be needed, flag it instead of adding it.
