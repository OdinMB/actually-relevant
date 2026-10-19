---
id: ADR-0043
title: Re-rank related stories with a small model on the public request path, cached 72 hours in memory and over HTTP, one call per slug at a time
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [cost, ai-risk]
---

# ADR-0043 · Re-rank related stories with a small model on the public request path, cached 72 hours in memory and over HTTP, one call per slug at a time

## Context

`GET /api/stories/:slug/related` takes the 12 cosine-nearest published stories and asks a small-tier model to pick the 4 most related (`getRelatedStories()` in `server/src/services/relatedStories.ts`, `.context/embeddings.md`). The re-rank has run inside that anonymous GET since February 2026, so a visitor's request can cost a model call. The improvement-opportunities report of 2026-10-18 ("Related-stories lists keep showing unpublished stories for days, ...") found that cached lists kept serving unpublished stories for up to six days, that the per-process cache is lost on every deploy, that concurrent misses for one slug each paid for a call, and that anyone walking the sitemap could trigger one call per published story, limited only by the shared `apiLimiter`. It offered three ways forward: filter and evict on the cached path; precompute the re-rank at publish time and store the ids; or keep the model on the request path, coalesce misses and shorten the HTTP lifetime. The commit "Never serve unpublished related stories, coalesce cache misses, one cache class" (2026-10-19) took the first option with the coalescing of the third and kept the HTTP lifetime. This record states that choice; it was made by the agent, and the report's question to the owner, whether an unpublished story must vanish from related lists at once or within a few days, is still open.

## Decision

The re-rank stays on the public request path. Its result, the source id and the ordered related ids, is cached per slug in a per-process `TTLCache` for `relatedStories.cacheHours` (72 h), at most 500 entries. Concurrent misses for one slug share a single computation (`cached()` in `lib/cache.ts`), so a burst of first visitors costs one model call. Every answer, cached or fresh, is re-checked in one query against `status = 'published'`, and a story leaving `published` or being deleted through the story service drops its own entry. The route keeps `Cache-Control: public, max-age=259200` (`relatedStories.httpCacheSeconds`, 72 h). A failed or empty model answer falls back to cosine order, so the endpoint never fails on the model.

## Consequences

Related lists refresh on their own as new stories are published, and no migration, backfill or recompute job is needed. The cost is bounded by distinct slugs per process per 72 hours rather than by visits, but every deploy or restart empties the cache, after which the first visit to each story page pays a model call again; a crawler walking the sitemap after a deploy costs up to one call per published story, slowed only by `apiLimiter`. On a cold cache the related list waits for the model; the client fetches it in a request of its own, apart from the story. The server never returns an unpublished story, but a browser or CDN that cached a response can show its link, which leads to a 404, for up to 72 hours; shortening `httpCacheSeconds` trades that for more re-rank calls.

Revisit this if model spend on `/related` shows up in the bills, if crawler traffic after deploys becomes noticeable, if the owner answers that unpublished stories must vanish from related lists at once (shorten the HTTP lifetime, or precompute), or if instances scale out, which multiplies the per-process caches.

## Alternatives considered

- **Precompute the re-rank at publish time and store the ids** on the story or in a small table: no model call on the public path and nothing lost on deploy, but it needs a migration and a backfill, and lists go stale as newer stories arrive unless a job recomputes them.
- **Cosine order only, no model**: no cost and no latency, but noisier lists; the re-rank was added in February 2026 because embeddings alone picked loosely related stories.
- **A short HTTP lifetime**: unpublished links disappear from clients sooner, but repeat visits come back to the server and, after each cache loss, to the model.
- **A shared cache (database or Redis)** surviving deploys: removes the post-deploy cold start, at the price of a new store or table for a small, rebuildable result.
