---
status: implemented
type: feature
complexity: complex
---

# Feed changesets (upload a prepared set of feed changes), full article text from RSS, and the source policy on AI opt-outs

> Written in the main session from the 2026-11-01 feed-coverage research (`/mnt/project-files/feed-coverage/2026-11-01_feed-coverage-and-replacements.md`). The handbook's `plan-decisions` skill is not loaded here, so decisions live in `## Approach`. Owner decisions, 2026-11-01: adopt the "middle line" AI opt-out policy and document it, including on the public site; admit Substack newsletters by reading their full text from the feed; add a changeset upload with an info icon that shows agent instructions.

## Problem

Feed changes are one-by-one admin form edits. An agent that researched 40 changes (moved feed URLs, policy-based removals, additions) can't hand them over in a form the owner just uploads. Some publishers (Substack-hosted newsletters) forbid crawling article pages but put the full article in the RSS item, which the crawler ignores. And the rule for which sources may be crawled with respect to publishers' AI opt-outs exists nowhere.

## Approach

### 1. Source policy ("middle line"): documentation only, no enforcement in code

A source is admissible unless the publisher has made a reservation that applies to us:
- **Honored:** a general machine-readable reservation (TDMRep `tdm-reservation: 1` in `/.well-known/tdmrep.json` or HTTP headers; a Cloudflare-style `Content-Signal` with `ai-input=no`; a robots.txt rule that disallows `*` or our own user agent `ActuallyRelevant`), and terms of use that forbid AI processing, summarizing or text-and-data mining of their content.
- **Not treated as applying to us:** robots.txt rules that block *named* AI-company crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended, …) and terms that forbid only AI *training*. We do not train models, we identify ourselves, we fetch one page per article and every story links to the original.
- Reason in law (EU DSM Directive Art. 4): text-and-data mining is permitted unless the rightsholder reserved it in machine-readable form; the general reservations are that form.
- Where it lives: a new section in `.context/feed-management.md` ("Source policy: publishers' AI opt-outs"), an ADR (next number, e.g. `0050-source-policy-ai-opt-outs.md`, plus the index line in `.context/decisions.md`), and a short public section on the Methodology page (`client/src/pages/MethodologyPage.tsx`, under "Our Sources"), plain American English, at most one em dash per paragraph. Not AI-label copy, so the owner-approved label files are untouched.
- Known gap, documented, not built: the crawler does not read robots.txt or TDM markers itself, and the Diffbot fallback can fetch pages of publishers that block Diffbot. Note it in the context file as open work (BACKLOG.md entry).

### 2. Full article text from RSS (`contentSource` on the feed)

- New Feed column `content_source` (`contentSource`), a string enum `'page' | 'rss'`, default `'page'`. Migration via `db:migrate:create`; review SQL. Zod: optional on create and update, `z.enum(['page','rss'])`. OpenAPI only if feeds are in the public spec (they are admin; check `openapi.ts`). Add to the admin `FeedForm` as a select ("Article text: Fetch the article page / Use the full text in the RSS item"), with a one-line hint that the second is for publishers whose terms forbid fetching pages, e.g. Substack.
- `rssParser.ts`: `RSSItem` gains `contentHtml: string | null`, from `item['content:encoded']` (configure rss-parser `customFields.item` if needed) falling back to `item.content`.
- Crawler: when `feed.contentSource === 'rss'`, no page fetch and no API tier for that feed. Text = the item's HTML converted to plain text the same way the stored content looks for Readability results (paragraph breaks preserved; cheerio is available). If the text is at least `config.crawl.minContentLength`, create the story with `crawlMethod: 'rss'` and `accessTier: 'unknown'`; a new `ExtractionMethod` member `'rss'` (or a separate type if that member would leak into the extraction chain; implementer's call). Shorter (a paid Substack post shows only a preview): skip the item, count it in `skipped`, log at info, never an error and never a fallback to the page (fallback would break the publisher's terms). Apply the feed's `paywallTitleMarker` to the item title if set (locked → rejected, as today). The quality-metrics method breakdown and the admin table must show `rss` as a method.
- `crawlUrl()` (manual single-URL crawl) on an `rss` feed: refuse with a `BadRequestError` ("This feed takes article text from its RSS feed; single URLs can't be crawled") rather than fetch the page.
- Docs: `.context/content-extraction.md` (new section and the crawl-flow diagram), `.context/feed-management.md` field list, `.context/ai-transparency.md` only if it inventories inputs (check).

### 3. Feed changesets: upload a JSON file of feed changes

Format (versioned, owned by a Zod schema in `server/src/schemas/feedChangeset.ts`):

```json
{
  "format": "actually-relevant/feed-changeset",
  "version": 1,
  "title": "Fix moved feeds and remove sources excluded by the AI opt-out policy",
  "createdAt": "2026-11-01",
  "changes": [
    { "action": "update", "match": { "title": "SIPRI" }, "set": { "rssUrl": "https://www.sipri.org/rss/combined.xml" }, "reason": "Feed moved" },
    { "action": "delete", "match": { "title": "The Lancet" }, "reason": "Elsevier TDM reservation; article pages refuse bots" },
    { "action": "create", "feed": { "title": "ECDC", "rssUrl": "https://…", "url": "https://www.ecdc.europa.eu/", "issue": "pandemics", "language": "en", "region": "western_europe", "contentSource": "page" }, "reason": "Pandemics gap" }
  ]
}
```

- `match`: exactly one of `id`, `rssUrl`, `title` (exact, case-sensitive; must match exactly one feed, active or not). `set`: the fields of `updateFeedSchema`, except `issueId` is replaced by `issue` (an issue **slug**) so files never need database ids. `create.feed`: `createFeedSchema` fields with `issue` slug instead of `issueId`. `delete`: same semantics as `DELETE /api/admin/feeds/:id` (hard delete without stories, deactivate with stories). `reason` required, max 500 chars. At most 200 changes.
- Endpoints (admin router, before `/:id`): `POST /api/admin/feeds/changesets/preview` validates the file and resolves every change against the database without writing; returns per change `{ index, action, feedTitle, status: 'ok' | 'error' | 'noop', message, diff? }` where `diff` lists field `from → to` for updates. Errors: unknown slug, no or several matches, rssUrl already used by another feed (including another create in the same file), invalid field. `POST /api/admin/feeds/changesets/apply` re-runs the same validation and applies **only if every change is ok or noop**, all in one Prisma transaction (all or nothing); else 400 with the preview. Returns the per-change results and counts.
- Client (admin `FeedsPage`): an "Import changes" button opens a side panel or dialog: choose a `.json` file → shows the preview list (action badge, feed, reason, diff, error text) → "Apply N changes" enabled only when there are no errors → toast and feeds list refresh. Beside the button, an info icon (accessible: `aria-label="How to prepare a changeset"`) opens a modal with **agent instructions**: a ready-to-copy text block (copy button) telling an AI agent how to research and write a changeset: the JSON format with every field and allowed value, issue slugs (fetched from the issues list, rendered live), region values, the source policy checks (feed parses with recent items; three article pages fetch with the crawler's user agent; robots.txt, TDMRep, Content-Signal, terms), when to use `contentSource: "rss"`, "reason is required", and "never invent feed URLs; verify each". Instruction text lives in one client module (e.g. `client/src/components/admin/feedChangesetInstructions.ts`) built from the shared constants so slugs and regions don't drift.
- Docs: `.context/feed-management.md` section "Changesets" (format, endpoints, all-or-nothing rule) and `.context/admin-dashboard.md` if it lists page features.

### Tests (TDD)

- Server unit: changeset schema (good file, each bad shape); preview resolution (title/rssUrl/id matches, ambiguous title, unknown slug, duplicate rssUrl within file and against DB, noop update); apply refuses when any error and writes nothing; route tests with supertest + `authHeader()`. Crawler: `rss` feed creates a story from `contentHtml` without calling `extractContent`; short content is skipped not errored; title marker locks; `crawlUrl` refuses. rssParser exposes `content:encoded`.
- DB test (`*.db.test.ts`) for apply's transaction if `TEST_DATABASE_URL` is available; otherwise say so.
- Client: import panel shows preview and disables apply on errors; info modal opens and shows slugs; FeedForm saves `contentSource`.

### Out of scope

Crawler-side robots.txt/TDM enforcement; Diffbot opt-out handling; any change to feed data (the changeset files are delivered separately for the owner to upload).
