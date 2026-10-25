---
id: ADR-0040
title: Serve story pages through the backend, which injects each story's preview tags into the client's own index.html
status: accepted
date: 2026-10-19
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [seo, deployment]
---

# ADR-0040 · Serve story pages through the backend, which injects each story's preview tags into the client's own index.html

## Context

Story pages are rendered client-side and not prerendered, so link-preview crawlers that do not run JavaScript saw the homepage's fallback tags for every shared story link (find-opps report, 2026-10-18, item 2). The owner asked for item 2 to be built; the run's coordinator picked the proxy option from the report as the default, with a share URL on the API host as the fallback if Render's rewrite could not proxy.

## Decision

A static-site rewrite sends `/stories/*` to `https://api.actuallyrelevant.news/api/story-page/*`. That route returns the built client's `index.html`, fetched from the static site and reused for 60 seconds, with the story's title, description, canonical, og:* and twitter:* tags in place of the shell's own Helmet-owned tags. For a missing story or any failure it returns the shell unchanged with 200. A per-story 1200x630 image (`/api/stories/:slug/og.png`, the carousel renderer at another size) is the og:image and the Bluesky thumbnail.

## Consequences

Every story link previews as that story, including links copied from the address bar. Every story page view now depends on the API instance and adds a hop; if the static site cannot be reached and no shell was ever fetched since boot, story pages answer 503 until it can. For up to a minute after a client deploy, story pages may name the previous build's assets. Undo by deleting the rewrite: story pages then fall back to the catch-all, exactly as before.

## Alternatives considered

- **A share URL on the API host** (`/s/<slug>` with the tags and a redirect): story pages stay static, but links copied from the address bar keep the generic preview, and every share button and social post must use the new URL.
- **Bundle `index.html` into the server build**: the services build separately, in no fixed order, so the copy would name another build's hashed assets.
- **Prerender every story**: thousands of pages per build, stale as soon as a story is published.
